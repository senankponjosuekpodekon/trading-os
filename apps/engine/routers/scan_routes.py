from fastapi import APIRouter
from typing import Optional
from collections import defaultdict
import json
import asyncio
import time
import pandas as pd
import atexit
from concurrent.futures import ThreadPoolExecutor

from routers.regime import detect_regime
from routers import ws as ws_module
from routers.news import get_news_sentiment, NewsRequest
from routers.news_scraper import scrape_all_sources, aggregate_sentiment
from routers.brvm import is_brvm_symbol, analyze_brvm_symbols
from routers.forex_context import get_dxy_momentum
from routers.gold_specialist import is_gold_symbol
from routers.news_filter import should_suspend_signal
from routers.portfolio_risk import analyze_portfolio_risk, get_cluster
from routers.onchain import is_crypto_symbol, onchain_context
from routers.onchain_advanced import (
    get_advanced_onchain_context,
)
from routers.tokenomics import fetch_tokenomics
from routers.social_sentiment import fetch_social_metrics
from routers.macro import fear_greed
import config
from utils.cache import get_cached, set_cached, cache
from utils.logger import get_logger
from utils.market_context import get_signal_context
from utils.metrics import inc, observe
from risk.engine import get_risk_engine
from risk.market_cap import fetch_market_cap_tier, get_market_cap_tier_sync
from risk.liquidity import compute_liquidity_score
from risk.red_flags import check_red_flags
from utils.asset_config import (
    load_asset_config,
    is_market_active,
)
from routers.scan_persistence import (
    _persist_scan,
)
from routers.scan_hysteresis import _signal_state, apply_hysteresis_and_persistence
from routers.scan_asset import get_asset_type
from routers.scan_timeframes import _TF_HIERARCHY, _BIAS_TF
from routers.scan_models import ScanRequest
from routers.symbol_mappings import (
    TF_MAP,
)
from routers.scan_fetchers import (
    fetch_twelvedata_klines,
    fetch_deriv_klines,
    fetch_yfinance_klines,
    fetch_binance_klines,
)
from routers.scan_analysis import analyze_candles

logger = get_logger(__name__)
_executor = ThreadPoolExecutor(max_workers=4)  # Match CPU cores to avoid context-switch overhead
atexit.register(lambda: _executor.shutdown(wait=False))



# TTL for scan cache (legacy constant used outside warmup loops)
WARMUP_TTL_SECONDS = 240

router = APIRouter()

@router.post("/multi")
async def scan_multi(req: ScanRequest):
    t0  = time.monotonic()
    tf  = TF_MAP.get(req.timeframe, "1h")
    loop = asyncio.get_event_loop()
    inc("scan:requests_total")

    # 0. Charger config marchés et filtrer les désactivés
    await load_asset_config()
    req.symbols = [s for s in req.symbols if is_market_active(get_asset_type(s))]
    if not req.symbols:
        return []

    # 0. Séparer BRVM des autres marchés
    brvm_symbols = [s for s in req.symbols if is_brvm_symbol(s)]
    other_symbols = [s for s in req.symbols if s not in brvm_symbols]

    # 0b. Cache lookup rapide pour les actifs non-BRVM
    cached_results = []
    missing_symbols = []
    provider_failures: dict[str, list[str]] = defaultdict(list)
    if req.strategies:
        missing_symbols = other_symbols
    else:
        for sym in other_symbols:
            cached = await get_cached(f"scan:{sym}:{req.timeframe}")
            if cached:
                cached_results.append({**cached, "cached": True})
            else:
                missing_symbols.append(sym)

    async def _fetch(sym: str) -> Optional[pd.DataFrame]:
        # Essai Binance en premier (crypto)
        df = await fetch_binance_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("binance")
        # Fallback Deriv pour indices synthétiques
        df = await fetch_deriv_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("deriv")
        # Fallback yfinance pour forex/commodities (gratuit, illimité, proxy volume)
        df = await fetch_yfinance_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("yfinance")
        # Fallback Twelve Data (quota free: 8 req/min, 800/jour) — dernier recours
        df = await fetch_twelvedata_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("twelvedata")
        return None

    # 1a. Fetch régimes MTF + HTF en parallèle selon la hiérarchie 3-TF
    # 5m  -> MTF=1h,  HTF=4h
    # 15m -> MTF=1h,  HTF=4h
    # 1h  -> MTF=4h,  HTF=1d
    # 4h  -> MTF=1d,  HTF=1d  (fallback)
    mtf_regimes: dict[str, Optional[dict]] = {}   # TF intermédiaire (décision)
    htf_regimes: dict[str, Optional[dict]] = {}   # TF supérieur (contexte macro)

    if missing_symbols:
        mtf_tf, htf_tf = _TF_HIERARCHY.get(req.timeframe, ("4h", "1d"))

        async def _fetch_regime(sym: str, interval: str) -> tuple[str, str, Optional[dict]]:
            try:
                df_htf = await asyncio.wait_for(
                    fetch_binance_klines(sym, interval, limit=100),
                    timeout=3.0,
                )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_deriv_klines(sym, interval, limit=100),
                        timeout=5.0,
                    )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_yfinance_klines(sym, interval, limit=100),
                        timeout=6.0,
                    )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_twelvedata_klines(sym, interval, limit=100),
                        timeout=3.0,
                    )
                if df_htf is not None and len(df_htf) >= 50:
                    r = detect_regime(df_htf["high"], df_htf["low"], df_htf["close"])
                    return sym, interval, r
            except Exception as exc:
                logger.warning(
                    "regime_fetch_failed",
                    symbol=sym,
                    interval=interval,
                    error=str(exc),
                )
            return sym, interval, None

        # Fetch MTF et HTF simultanément — si MTF == HTF (cas 4h) on ne déduplique pas
        regime_tasks = (
            [_fetch_regime(sym, mtf_tf) for sym in missing_symbols] +
            ([_fetch_regime(sym, htf_tf) for sym in missing_symbols] if htf_tf != mtf_tf else [])
        )
        regime_results = await asyncio.gather(*regime_tasks, return_exceptions=True)
        for item in regime_results:
            if not isinstance(item, Exception):
                sym, interval, reg = item
                if interval == mtf_tf:
                    mtf_regimes[sym] = reg
                elif interval == htf_tf:
                    htf_regimes[sym] = reg
        # Cas MTF == HTF : copier MTF dans HTF
        if htf_tf == mtf_tf:
            htf_regimes = dict(mtf_regimes)

    # 1a-bis. Fetch régimes D1 + Weekly pour le bias général (toujours, quel que soit le TF)
    # Ces regimes sont utilisés comme couche de bias non bloquante dans analyze_candles.
    bias_regimes_by_sym: dict[str, dict[str, dict]] = {}  # sym -> {"1d": regime, "1w": regime}
    if missing_symbols:
        d1_tf, w1_tf = _BIAS_TF

        async def _fetch_bias_regime(sym: str, interval: str) -> tuple[str, str, Optional[dict]]:
            try:
                df_b = await asyncio.wait_for(
                    fetch_binance_klines(sym, interval, limit=100),
                    timeout=3.0,
                )
                if df_b is None:
                    df_b = await asyncio.wait_for(
                        fetch_deriv_klines(sym, interval, limit=100),
                        timeout=5.0,
                    )
                if df_b is None:
                    df_b = await asyncio.wait_for(
                        fetch_yfinance_klines(sym, interval, limit=100),
                        timeout=6.0,
                    )
                if df_b is None:
                    df_b = await asyncio.wait_for(
                        fetch_twelvedata_klines(sym, interval, limit=100),
                        timeout=3.0,
                    )
                if df_b is not None and len(df_b) >= 50:
                    r = detect_regime(df_b["high"], df_b["low"], df_b["close"])
                    return sym, interval, r
            except Exception as exc:
                logger.warning("bias_regime_fetch_failed", symbol=sym, interval=interval, error=str(exc))
            return sym, interval, None

        # Ne pas re-fetch D1 si c'est déjà le HTF (évite les appels dupliqués)
        bias_tfs_to_fetch = []
        if d1_tf != htf_tf or not missing_symbols:
            bias_tfs_to_fetch.append(d1_tf)
        if w1_tf != htf_tf and w1_tf != d1_tf:
            bias_tfs_to_fetch.append(w1_tf)

        if bias_tfs_to_fetch:
            bias_tasks = []
            for interval in bias_tfs_to_fetch:
                for sym in missing_symbols:
                    bias_tasks.append(_fetch_bias_regime(sym, interval))
            # Si D1 est déjà le HTF, réutiliser les regimes déjà fetchés
            bias_results = await asyncio.gather(*bias_tasks, return_exceptions=True)
            for item in bias_results:
                if not isinstance(item, Exception):
                    sym, interval, reg = item
                    bias_regimes_by_sym.setdefault(sym, {})[interval] = reg
            # Réutiliser D1 du HTF si applicable
            if d1_tf == htf_tf and htf_regimes:
                for sym, reg in htf_regimes.items():
                    bias_regimes_by_sym.setdefault(sym, {})[d1_tf] = reg

    # 1b. Fetch toutes les klines LTF en parallèle — Binance + Deriv + yfinance + TwelveData fallback, timeout 15s
    fetch_coros = [asyncio.wait_for(_fetch(sym), timeout=15.0) for sym in missing_symbols]
    dfs_raw = await asyncio.gather(*fetch_coros, return_exceptions=True)
    dfs = [None if isinstance(d, Exception) else d for d in dfs_raw]

    async def _no_data(s: str):
        payload = {"symbol": s, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}
        if provider_failures.get(s):
            payload["missing_sources"] = provider_failures[s]
        return payload

    # 1c. Contexte on-chain (crypto uniquement) : Fear&Greed partagé + funding/OI par symbole
    onchain_contexts: dict[str, dict] = {}
    tokenomics_contexts: dict[str, dict] = {}
    social_contexts: dict[str, dict] = {}
    crypto_symbols = [s for s in missing_symbols if is_crypto_symbol(s)]
    fg_value = None
    if crypto_symbols:
        try:
            fg = await asyncio.wait_for(fear_greed(), timeout=3.0)
            fg_value = fg.get("value") if isinstance(fg, dict) else None
        except Exception as exc:
            logger.warning("fear_greed_failed", error=str(exc))
            fg_value = None

        async def _fetch_onchain(sym: str):
            try:
                ctx = await asyncio.wait_for(onchain_context(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("onchain_context_failed", symbol=sym, error=str(exc))
                ctx = {}
            return sym, ctx

        onchain_results = await asyncio.gather(
            *[_fetch_onchain(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in onchain_results:
            if not isinstance(item, Exception):
                sym, ctx = item
                onchain_contexts[sym] = {"context": ctx, "fear_greed": fg_value}

        # 1c-bis. Advanced on-chain context (exchange netflow, MVRV, dev, TVL)
        async def _fetch_advanced(sym: str):
            try:
                adv = await asyncio.wait_for(get_advanced_onchain_context(sym), timeout=4.0)
            except Exception as exc:
                logger.warning("advanced_onchain_failed", symbol=sym, error=str(exc))
                adv = {}
            return sym, adv

        advanced_results = await asyncio.gather(
            *[_fetch_advanced(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in advanced_results:
            if not isinstance(item, Exception):
                sym, adv = item
                onchain_contexts.setdefault(sym, {})
                onchain_contexts[sym]["advanced"] = adv

        # 1c-ter. Tokenomics context (unlock schedule + concentration)
        tokenomics_contexts: dict[str, dict] = {}

        async def _fetch_tokenomics(sym: str):
            try:
                tctx = await asyncio.wait_for(fetch_tokenomics(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("tokenomics_batch_failed", symbol=sym, error=str(exc))
                tctx = {}
            return sym, tctx

        tokenomics_results = await asyncio.gather(
            *[_fetch_tokenomics(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in tokenomics_results:
            if not isinstance(item, Exception):
                sym, tctx = item
                tokenomics_contexts[sym] = tctx

        # 1c-quater. Social sentiment context (LunarCrush)
        social_contexts: dict[str, dict] = {}

        async def _fetch_social(sym: str):
            try:
                sctx = await asyncio.wait_for(fetch_social_metrics(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("social_batch_failed", symbol=sym, error=str(exc))
                sctx = {}
            return sym, sctx

        social_results = await asyncio.gather(
            *[_fetch_social(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in social_results:
            if not isinstance(item, Exception):
                sym, sctx = item
                social_contexts[sym] = sctx

    # 1c-quinquies. Phase 0++ batch pre-fetch: market_cap_tier, liquidity, red_flags, news_context, gold_dxy
    mcap_tiers: dict[str, str] = {}
    liquidity_data: dict[str, dict] = {}
    red_flags_data: dict[str, dict] = {}
    news_contexts: dict[str, dict] = {}
    gold_dxy_data: dict[str, dict] = {}

    if missing_symbols:
        # Fear & Greed already fetched above as fg_value — reuse it
        # Market cap tier + liquidity (crypto only)
        async def _fetch_mcap_liq(sym: str):
            _mcap, _liq = None, None
            if is_crypto_symbol(sym):
                try:
                    _mcap = await asyncio.wait_for(fetch_market_cap_tier(sym), timeout=5.0)
                except Exception:
                    _mcap = get_market_cap_tier_sync(sym, "CRYPTO")
                try:
                    _liq = await asyncio.wait_for(compute_liquidity_score(sym, "CRYPTO"), timeout=5.0)
                except Exception:
                    _liq = None
            return sym, _mcap, _liq

        ml_results = await asyncio.gather(
            *[_fetch_mcap_liq(sym) for sym in missing_symbols], return_exceptions=True
        )
        for item in ml_results:
            if not isinstance(item, Exception):
                sym, _mcap, _liq = item
                if _mcap:
                    mcap_tiers[sym] = _mcap
                if _liq:
                    liquidity_data[sym] = _liq

        # Red flags for MICRO/SMALL cap crypto
        micro_syms = [s for s in missing_symbols if mcap_tiers.get(s) in ("MICRO", "SMALL")]
        if micro_syms:
            async def _fetch_red_flags(sym: str):
                try:
                    _rf = await asyncio.wait_for(check_red_flags(sym, mcap_tiers[sym]), timeout=8.0)
                except Exception:
                    _rf = {"red_flags": [], "red_flag_count": 0, "danger": False, "warning": None}
                return sym, _rf

            rf_results = await asyncio.gather(
                *[_fetch_red_flags(sym) for sym in micro_syms], return_exceptions=True
            )
            for item in rf_results:
                if not isinstance(item, Exception):
                    sym, _rf = item
                    red_flags_data[sym] = _rf

        # News context for COMMODITY/CRYPTO
        news_syms = [s for s in missing_symbols if get_asset_type(s) in ("COMMODITY", "CRYPTO")]
        if news_syms:
            async def _fetch_news_ctx(sym: str):
                try:
                    _suspend, _nctx = await asyncio.wait_for(
                        should_suspend_signal(sym, get_asset_type(sym)), timeout=10.0
                    )
                except Exception:
                    _nctx = None
                return sym, _nctx

            nc_results = await asyncio.gather(
                *[_fetch_news_ctx(sym) for sym in news_syms], return_exceptions=True
            )
            for item in nc_results:
                if not isinstance(item, Exception):
                    sym, _nctx = item
                    if _nctx:
                        news_contexts[sym] = _nctx

        # Gold DXY for gold symbols
        gold_syms = [s for s in missing_symbols if is_gold_symbol(s)]
        if gold_syms:
            try:
                _shared_dxy = await asyncio.wait_for(get_dxy_momentum(days=5), timeout=5.0)
                for sym in gold_syms:
                    gold_dxy_data[sym] = _shared_dxy
            except Exception:
                pass

    # 1d. Scheduler différencié analysis_timeframe/entry_timeframe (Sprint 3) — dernière
    # clôture sur le(s) entry_timeframe(s) distincts déclarés par les stratégies actives.
    entry_contexts: dict[tuple[str, str], dict] = {}   # (symbol, entry_timeframe) -> {"close": float}
    entry_tfs_needed = {
        strat.get("entryTimeframe") or strat.get("entry_timeframe")
        for strat in (req.strategies or [])
        if (strat.get("entryTimeframe") or strat.get("entry_timeframe"))
        and (strat.get("entryTimeframe") or strat.get("entry_timeframe")) != req.timeframe
    }
    if entry_tfs_needed and missing_symbols:
        async def _fetch_entry_close(sym: str, etf: str):
            etf_mapped = TF_MAP.get(etf, etf)
            try:
                df_e = await fetch_binance_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_deriv_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_yfinance_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_twelvedata_klines(sym, etf_mapped, limit=5)
                if df_e is not None and len(df_e) > 0:
                    return sym, etf, {"close": float(df_e["close"].iloc[-1])}
            except Exception as exc:
                logger.warning("entry_close_fetch_failed", symbol=sym, entry_tf=etf, error=str(exc))
            return sym, etf, None

        entry_tasks = [
            _fetch_entry_close(sym, etf) for sym in missing_symbols for etf in entry_tfs_needed
        ]
        entry_results = await asyncio.gather(*entry_tasks, return_exceptions=True)
        for item in entry_results:
            if not isinstance(item, Exception) and item[2] is not None:
                sym, etf, ctx = item
                entry_contexts[(sym, etf)] = ctx

    # 2. Analyse CPU dans un thread pool pour ne pas bloquer l'event loop
    # Feed price history to CorrelationManager for correlation detection
    try:
        _risk_engine = get_risk_engine()
        for sym, df in zip(missing_symbols, dfs):
            if df is not None and len(df) >= 10 and "close" in df:
                _risk_engine.correlation.update_price_history(sym, df["close"])
    except Exception:
        pass

    analyze_tasks = []
    for sym, df in zip(missing_symbols, dfs):
        if df is None or len(df) < 50:
            analyze_tasks.append(_no_data(sym))
        else:
            htf_r = htf_regimes.get(sym)
            mtf_r = mtf_regimes.get(sym)
            onchain_ctx = onchain_contexts.get(sym)
            tokenomics_ctx = tokenomics_contexts.get(sym)
            social_ctx = social_contexts.get(sym)
            bias_r = bias_regimes_by_sym.get(sym)
            _nc = news_contexts.get(sym)
            _gd = gold_dxy_data.get(sym)
            _mct = mcap_tiers.get(sym)
            _ld = liquidity_data.get(sym)
            _rfd = red_flags_data.get(sym)
            if req.strategies:
                for strat in req.strategies:
                    etf = strat.get("entryTimeframe") or strat.get("entry_timeframe")
                    entry_ctx = entry_contexts.get((sym, etf)) if etf else None
                    analyze_tasks.append(
                        loop.run_in_executor(
                            _executor,
                            lambda s=sym, tf=req.timeframe, d=df, h=htf_r, m=mtf_r, st=strat,
                                   oc=onchain_ctx, ec=entry_ctx, fc=None, tc=tokenomics_ctx,
                                   sc=social_ctx, br=bias_r,
                                   nc=_nc, gd=_gd, mct=_mct, ld=_ld, rfd=_rfd, fg=fg_value:
                                analyze_candles(s, tf, d, h, m, st, oc, ec, fc, tc, sc,
                                    bias_regimes=br, news_context=nc, gold_dxy=gd,
                                    market_cap_tier=mct, liquidity_data=ld,
                                    red_flags_data=rfd, fear_greed_value=fg),
                        )
                    )
            else:
                analyze_tasks.append(
                    loop.run_in_executor(
                        _executor,
                        lambda s=sym, tf=req.timeframe, d=df, h=htf_r, m=mtf_r, st=None,
                               oc=onchain_ctx, ec=None, fc=None, tc=tokenomics_ctx,
                               sc=social_ctx, br=bias_r,
                               nc=_nc, gd=_gd, mct=_mct, ld=_ld, rfd=_rfd, fg=fg_value:
                            analyze_candles(s, tf, d, h, m, st, oc, ec, fc, tc, sc,
                                bias_regimes=br, news_context=nc, gold_dxy=gd,
                                market_cap_tier=mct, liquidity_data=ld,
                                red_flags_data=rfd, fear_greed_value=fg),
                    )
                )

    # Launch BRVM analysis in parallel with crypto analysis
    brvm_task = None
    if brvm_symbols:
        brvm_task = asyncio.wait_for(
            analyze_brvm_symbols(brvm_symbols),
            timeout=20.0,
        )

    computed_results = list(await asyncio.gather(*analyze_tasks))
    for r in computed_results:
        cache_key = f"scan:{r['symbol']}:{req.timeframe}"
        if r.get("strategy_id"):
            cache_key = f"{cache_key}:{r['strategy_id']}"
        await set_cached(cache_key, r, ttl=WARMUP_TTL_SECONDS)

    brvm_results = []
    if brvm_task:
        try:
            brvm_results = await brvm_task
        except asyncio.TimeoutError:
            logger.warning("brvm_scan_timeout", symbols=len(brvm_symbols))
            brvm_results = [
                {"symbol": s, "signal": "NEUTRAL", "confidence": 0, "reason": "BRVM data timeout"}
                for s in brvm_symbols
            ]
        except Exception as e:
            logger.warning("brvm_scan_failed", error=str(e))
            brvm_results = []

    results = cached_results + computed_results + brvm_results

    # 3. Enrichissement sentiment news (en parallèle, timeout 2s max)
    if config.settings.news_api_key:
        sentiment_tasks = [
            get_news_sentiment(NewsRequest(symbol=r["symbol"], limit=5, analyze=True))
            for r in results if r.get("signal") in ("BUY", "SELL")
        ]
        if sentiment_tasks:
            try:
                sentiments = await asyncio.wait_for(
                    asyncio.gather(*sentiment_tasks, return_exceptions=True),
                    timeout=2.0,
                )
            except asyncio.TimeoutError:
                sentiments = []
                logger.warning("news_sentiment_timeout", symbols=len(sentiment_tasks))
            sent_map = {}
            for s in sentiments:
                if not isinstance(s, Exception):
                    sent_map[s.symbol] = s

            for r in results:
                s = sent_map.get(r["symbol"])
                if s:
                    bonus = s.confidence_bonus
                    # Bonus aligné avec la direction du signal
                    if r.get("signal") == "BUY" and s.sentiment == "bearish":
                        bonus = -abs(bonus)
                    elif r.get("signal") == "SELL" and s.sentiment == "bullish":
                        bonus = -abs(bonus)

                    r["confidence"]     = max(0, min(95, r.get("confidence", 0) + bonus))
                    r["news_sentiment"] = {
                        "label":   s.sentiment,
                        "score":   s.score,
                        "bonus":   bonus,
                        "articles": [
                            {"title": a.title, "source": a.source, "url": a.url, "published_at": a.published_at}
                            for a in s.articles[:3]
                        ],
                    }

    # 4. Enrichissement sentiment scraper propriétaire (RSS + Reddit + Nitter)
    # Stratégie non-bloquante : si cache chaud → enrichit immédiatement,
    # sinon → fire-and-forget (le prochain appel bénéficiera du cache 15min).
    active_signals = [r for r in results if r.get("signal") in ("BUY", "SELL")]
    symbols_missing_cache: list[str] = []

    for r in active_signals:
        from routers.news_scraper import _cache_get as _sc_get
        cached_articles = _sc_get(f"scraper:{r['symbol']}")
        if cached_articles is not None:
            # Cache chaud → enrichissement immédiat sans réseau
            agg = aggregate_sentiment(cached_articles)
            bonus = agg["bonus"]
            if r.get("signal") == "BUY" and agg["label"] == "bearish":
                bonus = -abs(bonus)
            elif r.get("signal") == "SELL" and agg["label"] == "bullish":
                bonus = -abs(bonus)
            r["confidence"] = max(0, min(95, r.get("confidence", 0) + bonus))
            r["scraper_sentiment"] = {
                "label":   agg["label"],
                "score":   agg["score"],
                "bonus":   bonus,
                "bullish": agg["bullish"],
                "bearish": agg["bearish"],
                "sources": list({a.source for a in cached_articles[:5]}),
                "cached":  True,
            }
        else:
            symbols_missing_cache.append(r["symbol"])

    # Fire-and-forget pour les symboles sans cache — le résultat sera dispo au prochain scan
    # Skip BRVM: les sources RSS africaines sont lentes et le sentiment est peu pertinent
    if symbols_missing_cache:
        scraper_syms = [s for s in symbols_missing_cache if not is_brvm_symbol(s)]
        if scraper_syms:
            async def _warm_scraper_cache(syms: list[str]):
                tasks = [scrape_all_sources(s) for s in syms]
                await asyncio.gather(*tasks, return_exceptions=True)
            asyncio.create_task(_warm_scraper_cache(scraper_syms))

    # 4b. Contexte macro + on-chain pour les signaux actifs
    active_symbols = [r["symbol"] for r in results if r.get("signal") in ("BUY", "SELL")]
    if active_symbols:
        try:
            context_tasks = [get_signal_context(sym) for sym in active_symbols]
            context_results = await asyncio.wait_for(
                asyncio.gather(*context_tasks, return_exceptions=True),
                timeout=3.0,
            )
            context_map = {sym: ctx for sym, ctx in zip(active_symbols, context_results) if not isinstance(ctx, Exception)}
            for r in results:
                if r["symbol"] in context_map and context_map[r["symbol"]]:
                    r["context"] = context_map[r["symbol"]]
        except asyncio.TimeoutError:
            logger.warning("market_context_timeout", symbols=len(active_symbols))

    # 5. Hystérésis flip-flop + persistence_score — évite BUY→NEUTRAL→BUY sur scans successifs
    apply_hysteresis_and_persistence(results, req.timeframe, _signal_state, time.monotonic())

    # 6. Analyse du risque portefeuille — clustering signaux corrélés
    portfolio_risk = analyze_portfolio_risk(results)
    if portfolio_risk["alerts"]:
        logger.warning(
            "portfolio_risk_alert",
            risk_level=portfolio_risk["risk_level"],
            alerts=len(portfolio_risk["alerts"]),
            summary=portfolio_risk["summary"],
        )

    # Annoter chaque résultat avec son cluster
    for r in results:
        r["cluster"] = get_cluster(r["symbol"])

    # Persist scan results to Redis + DB batch queue
    for r in results:
        await _persist_scan(r, req.timeframe)

    ws_module.set_latest_signals(results)

    elapsed_ms = (time.monotonic() - t0) * 1000
    inc("scan:signals_total", len(results))
    inc("scan:buy_signals", sum(1 for r in results if r.get("signal") == "BUY"))
    inc("scan:sell_signals", sum(1 for r in results if r.get("signal") == "SELL"))
    observe("scan:duration_ms", elapsed_ms)

    data_gaps = [
        {"symbol": sym, "providers": providers}
        for sym, providers in provider_failures.items()
        if providers
    ]

    return {
        "scanned":        len(results),
        "timeframe":      req.timeframe,
        "elapsed_ms":     round(elapsed_ms, 2),
        "results":        results,
        "portfolio_risk": portfolio_risk,
        "data_gaps":      data_gaps,
    }


@router.get("/history")
async def scan_history(limit: int = 50, strategy: str | None = None, signal: str | None = None):
    """Retourne les derniers scans depuis Redis (temps réel, TTL 1h)."""
    try:
        r = await cache.client()
        raw_entries = await r.lrange("scan_history:recent", 0, min(limit * 4, 499))
        entries = []
        for raw in raw_entries:
            try:
                entry = json.loads(raw)
            except Exception:
                continue
            if strategy and entry.get("strategy_name") != strategy:
                continue
            if signal and entry.get("signal") != signal:
                continue
            entries.append(entry)
            if len(entries) >= limit:
                break
        return {"count": len(entries), "entries": entries}
    except Exception as e:
        return {"count": 0, "entries": [], "error": str(e)}

