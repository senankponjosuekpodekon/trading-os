from fastapi import APIRouter
from typing import List, Optional
from collections import defaultdict
import json
import asyncio
import time
import random
import pandas as pd
import atexit
from concurrent.futures import ThreadPoolExecutor

from routers.price_action import detect_market_structure, price_action_bonus
from routers.synthetic_engine import analyze_synthetic, evaluate_synthetic_strategy, SYMBOL_TO_DERIV as SYNTHETIC_SYMBOLS
from routers.boom_crash_model import analyze_boom_crash
from routers.sr_zones import get_sr_zones, sr_bonus
from routers.patterns import scan_last_patterns, patterns_bonus
from patterns.detector import detect_all as detect_chart_patterns
from patterns.confluence import score_pattern_confluence
from routers.regime import detect_regime, regime_bonus, regime_filter
from routers.smc import analyze_smc, smc_bonus
from routers import ws as ws_module
from routers.news import get_news_sentiment, NewsRequest
from routers.news_scraper import scrape_all_sources, aggregate_sentiment
from routers.brvm import is_brvm_symbol, analyze_brvm_symbols
from routers.forex_context import get_dxy_momentum
from routers.gold_specialist import is_gold_symbol, gold_specialist_bonus, gold_atr_adjustment, get_session_info as gold_session_info
from routers.news_filter import should_suspend_signal
from routers.portfolio_risk import analyze_portfolio_risk, get_cluster
from routers.strategy_eval import parse_rules, evaluate_strategy, derive_profile_suitability
from routers.onchain import is_crypto_symbol, onchain_context, onchain_bonus
from routers.onchain_advanced import (
    get_advanced_onchain_context,
    advanced_onchain_bonus,
)
from routers.tokenomics import fetch_tokenomics, tokenomics_penalty
from routers.social_sentiment import fetch_social_metrics, social_bonus
from routers.macro import fear_greed
from features.market_concept_layer import compute_market_concept_vector
from features.market_embedding import build_market_embedding
from ml.feature_factory import build_feature_vector
import config
from utils.cache import get_cached, set_cached, cache, mem_cached
from utils.logger import get_logger
from utils.circuit_breaker import BREAKERS, State as BreakerState
from utils.market_context import get_signal_context
from utils.metrics import inc, observe
from utils.session import get_session_info
from risk.engine import get_risk_engine
from risk.discipline_controller import TradeDecision
from risk.market_cap import fetch_market_cap_tier, get_market_cap_tier_sync
from risk.liquidity import compute_liquidity_score, estimate_liquidity_score_sync
from risk.signal_quality_filter import apply_quality_gate, get_quality_size_multiplier
from risk.risk_level import compute_risk_level, get_max_position_pct
from risk.red_flags import check_red_flags
from risk.dca_tranches import compute_dca_tranches, compute_scale_out
from utils.correlation import set_correlation_id, clear_correlation_id
from utils.asset_config import (
    load_asset_config,
    is_market_active,
    is_warmup_enabled,
    get_max_strategies,
    get_scan_interval,
    get_timeframes as get_config_timeframes,
)
from routers.scan_persistence import (
    _persist_scan,
    _scan_batch_flusher,
    _try_ingest_signal,
    _get_scan_pool,
)
from routers.scan_symbols import (
    BINANCE_PRIORITY_SYMBOLS,
    DERIV_SYMBOLS,
    BRVM_SYMBOLS,
    FOREX_COMMODITY_SYMBOLS,
    ACTIVE_SYMBOLS,
)
from routers.scan_strategies import _load_active_strategies, DEFAULT_STRATEGY
from routers.scan_hysteresis import _signal_state, apply_hysteresis_and_persistence
from routers.scan_asset import get_asset_type
from routers.scan_ta import ema, rsi, atr, macd, bollinger
from routers.scan_timeframes import _TF_HIERARCHY, _BIAS_TF
from routers.scan_synthetic import _analyze_synthetic_candles
from routers.scan_moonshot import _compute_moonshot_tp
from routers.scan_models import ScanRequest
from routers.symbol_mappings import (
    SYMBOL_TO_BINANCE, US_STOCK_SYMBOLS, FOREX_SYMBOLS, COMMODITY_SYMBOLS,
    TF_MAP,
)
from routers.scan_fetchers import (
    fetch_twelvedata_klines,
    fetch_deriv_klines,
    fetch_yfinance_klines,
    fetch_binance_klines,
    fetch_klines_fallback,
)
from routers.scan_market_hours import _is_brvm_open, _is_nyse_open

logger = get_logger(__name__)
_executor = ThreadPoolExecutor(max_workers=4)  # Match CPU cores to avoid context-switch overhead
atexit.register(lambda: _executor.shutdown(wait=False))





# TTL for scan cache (legacy constant used outside warmup loops)
WARMUP_TTL_SECONDS = 240

router = APIRouter()








def analyze_candles(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    htf_regime: Optional[dict] = None,   # régime TF supérieur (HTF2 = top)
    mtf_regime: Optional[dict] = None,   # régime TF intermédiaire (HTF1)
    strategy: Optional[dict] = None,
    onchain: Optional[dict] = None,      # contexte on-chain crypto (funding, fear&greed)
    entry_context: Optional[dict] = None,  # dernière clôture sur l'entry_timeframe (Sprint 3)
    forex_context: Optional[dict] = None,  # macro calendrier + DXY momentum
    tokenomics_context: Optional[dict] = None,  # token unlocks / concentration risk
    social_context: Optional[dict] = None,  # LunarCrush social sentiment
    bias_regimes: Optional[dict[str, dict]] = None,  # D1/Weekly bias regimes
    news_context: Optional[dict] = None,  # macro news for COMMODITY/CRYPTO
    gold_dxy: Optional[dict] = None,  # DXY momentum for gold specialist
    market_cap_tier: Optional[str] = None,  # MICRO/SMALL/MID/LARGE
    liquidity_data: Optional[dict] = None,  # liquidity score dict
    red_flags_data: Optional[dict] = None,  # red flags checklist result
    fear_greed_value: Optional[int] = None,  # Fear & Greed index value
) -> dict:
    # ── Correlation ID for end-to-end tracing ──
    corr_id = set_correlation_id()
    logger.info("analyze_candles.start", correlation_id=corr_id, symbol=symbol, timeframe=timeframe)

    if len(df) < 50:
        clear_correlation_id()
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "not enough data", "correlation_id": corr_id}

    asset_type = get_asset_type(symbol)
    session_info = get_session_info()

    # Synthetic assets (Deriv indices) use a dedicated statistical engine
    # — no EMA/RSI/MACD trend-following, only spike/mean-reversion stats
    if asset_type == "SYNTHETIC":
        _syn_result = _analyze_synthetic_candles(symbol, timeframe, df, strategy=strategy)
        # Apply quality gate (14-layer filter) for synthetics
        _syn_qg_asset_type = "GOLD" if is_gold_symbol(symbol) else "SYNTHETIC"
        _syn_gate = apply_quality_gate(
            signal=_syn_result.get("signal", "NEUTRAL"),
            asset_type=_syn_qg_asset_type,
            symbol=symbol,
            entry=_syn_result.get("entry_price"),
            tp1=_syn_result.get("take_profit_1"),
            df=df,
            session_info=session_info,
            liquidity_data=estimate_liquidity_score_sync(symbol, "SYNTHETIC", df),
            regime=None,
            atr_value=_syn_result.get("indicators", {}).get("atr"),
            onchain_context=None,
            dxy_data=None,
        )
        _syn_result["quality_score"] = _syn_gate.get("quality_score", 0)
        _syn_result["quality_flags"] = _syn_gate.get("quality_flags", [])
        _syn_result["quality_size_multiplier"] = get_quality_size_multiplier(_syn_gate.get("quality_score", 0)) if _syn_result.get("signal") != "NEUTRAL" else 0
        if not _syn_gate["passed"]:
            _syn_result["signal"] = "NEUTRAL"
            _syn_result["confidence"] = 0
            _syn_result["stop_loss"] = None
            _syn_result["take_profit_1"] = None
            _syn_result["take_profit_2"] = None
            _syn_result["risk_reward"] = None
        return _syn_result

    # Synthetic assets: compute statistical bonus alongside standard indicators
    synthetic_stats = None
    if asset_type == "SYNTHETIC":
        deriv_sym = SYNTHETIC_SYMBOLS.get(symbol)
        _syn_category = "volatility"
        if deriv_sym:
            from routers.synthetic_engine import DERIV_SYMBOLS as _DERIV_CATS
            _syn_category = _DERIV_CATS.get(deriv_sym, "volatility")
        _syn_close = df["close"].astype(float)
        if _syn_category == "boom_crash":
            _syn_dir = "boom" if "BOOM" in symbol.upper() else "crash"
            synthetic_stats = analyze_boom_crash(_syn_close, direction=_syn_dir)
        else:
            synthetic_stats = analyze_synthetic(_syn_close, category=_syn_category)

    close    = df["close"]
    high     = df["high"]
    low      = df["low"]
    open_col = df["open"]
    last     = len(df) - 1

    # ── Default strategy fallback ──
    # When no strategy is provided, use the default strategy so all signals
    # go through evaluate_strategy with proper filters instead of the
    # legacy hardcoded pipeline.
    _using_default = False
    if strategy is None:
        strategy = DEFAULT_STRATEGY
        _using_default = True
        logger.info("analyze_candles.default_strategy", symbol=symbol, timeframe=timeframe)

    # Dynamic indicator periods from strategy rules (defaults: 20/50/200/14)
    _rules_raw = strategy.get("rules", {}) if strategy else {}
    _ema_fast = int(_rules_raw.get("ema_fast", 20))
    _ema_slow = int(_rules_raw.get("ema_slow", 50))
    _ema_trend = int(_rules_raw.get("ema_trend", 200))
    _rsi_period = int(_rules_raw.get("rsi_period", 14))

    e20  = ema(close, _ema_fast)
    e50  = ema(close, _ema_slow)
    e200 = ema(close, _ema_trend) if len(df) >= _ema_trend else None
    r14  = rsi(close, _rsi_period)
    a14  = atr(high, low, close, 14)
    vs   = df["volume"].rolling(20).mean()
    macd_line, macd_sig, macd_hist = macd(close)
    bb_upper, bb_mid, bb_lower, bb_bw = bollinger(close)

    def safe(s, i=last):
        if s is None: return None
        v = s.iloc[i]
        return None if pd.isna(v) else round(float(v), 6)

    c_val      = float(close.iloc[last])
    e20_v      = safe(e20)
    e50_v      = safe(e50)
    e200_v     = safe(e200)
    rsi_v      = safe(r14)
    atr_v      = safe(a14)
    vol_avg    = safe(vs)
    vol_cur    = float(df["volume"].iloc[last])
    vol_r      = round(vol_cur / vol_avg, 3) if vol_avg and vol_avg > 0 else None
    macd_v     = safe(macd_line)
    macd_sig_v = safe(macd_sig)
    macd_hist_v = safe(macd_hist)
    macd_prev_hist = safe(macd_hist, last - 1) if last > 0 else None
    bb_upper_v = safe(bb_upper)
    bb_mid_v   = safe(bb_mid)
    bb_lower_v = safe(bb_lower)
    bb_bw_v    = safe(bb_bw)

    score = 0
    reasons = []

    # Sub-scores for ML feature store (score_trend, score_pa, etc.)
    _sub_trend = 0
    _sub_pa = 0
    _sub_sr = 0
    _sub_patterns = 0
    _sub_regime = 0
    _sub_smc = 0
    _sub_mtf = 0
    _sub_sentiment = 0
    _sub_bias = 0

    # ── Couche 1 : Momentum/Trend (EMA + RSI + MACD groupés, plafond ±50) ──
    # Les trois mesurent la même dimension (momentum directionnel).
    # On les regroupe pour éviter qu'une tendance simple sature le score avant
    # d'atteindre les couches Price Action / SMC qui apportent une info différente.
    trend_raw = 0.0
    trend_reasons: list[str] = []

    # EMA : signal structurel fort (alignement long terme)
    if e20_v and e50_v and e200_v:
        if e20_v > e50_v > e200_v and c_val > e200_v:
            trend_raw += 2.0
            trend_reasons.append("EMA bullish alignment + above 200")
        elif e20_v < e50_v < e200_v and c_val < e200_v:
            trend_raw -= 2.0
            trend_reasons.append("EMA bearish alignment + below 200")
        elif e20_v > e50_v:
            trend_raw += 1.0
            trend_reasons.append("EMA20 > EMA50 bullish")
        elif e20_v < e50_v:
            trend_raw -= 1.0
            trend_reasons.append("EMA20 < EMA50 bearish")
    elif e20_v and e50_v:
        if e20_v > e50_v:
            trend_raw += 1.0
            trend_reasons.append("EMA20 > EMA50 bullish")
        elif e20_v < e50_v:
            trend_raw -= 1.0
            trend_reasons.append("EMA20 < EMA50 bearish")

    # RSI : confirmation momentum
    if rsi_v:
        if 50 <= rsi_v <= 65:
            trend_raw += 1.0
            trend_reasons.append(f"RSI bullish zone ({rsi_v:.1f})")
        elif 35 <= rsi_v <= 50:
            trend_raw -= 1.0
            trend_reasons.append(f"RSI bearish zone ({rsi_v:.1f})")
        elif rsi_v > 70:
            trend_raw -= 0.5
            trend_reasons.append(f"RSI overbought ({rsi_v:.1f})")
        elif rsi_v < 30:
            trend_raw += 0.5
            trend_reasons.append(f"RSI oversold ({rsi_v:.1f})")

    # MACD : crossover prioritaire, momentum secondaire
    if macd_v is not None and macd_sig_v is not None and macd_hist_v is not None:
        if macd_hist_v > 0 and macd_prev_hist is not None and macd_prev_hist <= 0:
            trend_raw += 1.0
            trend_reasons.append(f"MACD bullish crossover ({macd_v:.4f})")
        elif macd_hist_v < 0 and macd_prev_hist is not None and macd_prev_hist >= 0:
            trend_raw -= 1.0
            trend_reasons.append(f"MACD bearish crossover ({macd_v:.4f})")
        elif macd_hist_v > 0 and macd_v > 0:
            trend_raw += 0.5
            trend_reasons.append("MACD bullish momentum")
        elif macd_hist_v < 0 and macd_v < 0:
            trend_raw -= 0.5
            trend_reasons.append("MACD bearish momentum")

    # Conversion trend_raw → score plafonné à ±50
    trend_contribution = max(-50, min(50, int(trend_raw * 12)))
    score += trend_contribution
    _sub_trend += trend_contribution
    reasons += trend_reasons

    # Volume : amplificateur (indépendant du cluster trend)
    if vol_r and vol_r > 1.3:
        _vol_bonus = 10 if score > 0 else -10
        score += _vol_bonus
        _sub_trend += _vol_bonus
        reasons.append(f"Volume spike x{vol_r:.1f}")

    # ATR : info contextuelle uniquement (pas de score)
    if atr_v and c_val > 0:
        atr_pct = (atr_v / c_val) * 100
        if atr_pct > 0.3:
            reasons.append(f"ATR OK ({atr_pct:.2f}%)")

    # ── Bollinger Bands : signal structurel indépendant ──
    # En tendance forte, le toucher des bandes est interprété comme continuation
    # (breakout), pas comme réversion. En tendance neutre, on garde l'interprétation
    # mean-reversion.
    if bb_upper_v and bb_lower_v and bb_mid_v:
        bb_pos = (c_val - bb_lower_v) / (bb_upper_v - bb_lower_v) if (bb_upper_v - bb_lower_v) > 0 else 0.5
        if trend_raw > 0.5:
            # Tendance haussière → continuation
            if c_val >= bb_upper_v * 0.995:
                score += 15
                reasons.append("Price at BB upper — bullish continuation")
            elif c_val <= bb_lower_v * 1.005:
                score -= 15
                reasons.append("Price at BB lower — pull-back in uptrend")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
        elif trend_raw < -0.5:
            # Tendance baissière → continuation
            if c_val <= bb_lower_v * 1.005:
                score -= 15
                reasons.append("Price at BB lower — bearish continuation")
            elif c_val >= bb_upper_v * 0.995:
                score += 15
                reasons.append("Price at BB upper — pull-back in downtrend")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
        else:
            # Range / direction faible → mean reversion
            if c_val <= bb_lower_v * 1.005:
                score += 15
                reasons.append("Price at BB lower — mean reversion setup")
            elif c_val >= bb_upper_v * 0.995:
                score -= 15
                reasons.append("Price at BB upper — potential reversal")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
        if bb_bw_v and bb_bw_v < 0.02:
            reasons.append(f"BB squeeze (bw={bb_bw_v:.3f}) — breakout imminent")

    # ── Session context (already initialized above) ──

    # ── Price Action Phase 1 : Structure ──
    pa = detect_market_structure(high, low, close, volume=df["volume"])
    temp_signal = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")

    # Session overlap bonus (London/NY = highest probability window)
    if session_info.get("overlap") == "London_New_York" and temp_signal != "NEUTRAL":
        score += 8
        reasons.append("Session: London/NY overlap (+8)")
    elif session_info.get("overlap") and temp_signal != "NEUTRAL":
        score += 3
        reasons.append(f"Session: {session_info['overlap']} (+3)")

    # Low-quality BOS hard block (No Trade Engine)
    if pa.get("bos") and pa.get("bos_dir") == temp_signal and pa.get("bos_score", 0) < 40:
        temp_signal = "NEUTRAL"
        reasons.append(f"PA: BOS quality too low ({pa.get('bos_score')}) → No Trade")
    if temp_signal != "NEUTRAL":
        pa_bonus, pa_reasons = price_action_bonus(pa, temp_signal)
        score += pa_bonus
        _sub_pa += pa_bonus
        reasons += pa_reasons

    # ── Phase 2 : S&R Clustering ──
    sr = get_sr_zones(high, low, close)
    if temp_signal != "NEUTRAL":
        b, r = sr_bonus(sr, temp_signal)
        score += b
        _sub_sr += b
        reasons += r

    # ── Phase 2 : Candlestick Patterns ──
    pats = scan_last_patterns(open_col, high, low, close)
    chart_patterns = detect_chart_patterns(df) if len(df) >= 15 else []
    if chart_patterns:
        reasons.append(f"Pattern chartiste détecté: {chart_patterns[0]['name']} ({chart_patterns[0]['direction']})")
        from routers.ws import broadcast_pattern
        for p in chart_patterns:
            broadcast_pattern({
                "symbol": symbol,
                "timeframe": timeframe,
                "name": p.get("name"),
                "category": p.get("category"),
                "direction": p.get("direction"),
                "confidence": p.get("confidence"),
                "entry": p.get("entry"),
                "stop_loss": p.get("stop_loss"),
                "targets": p.get("targets"),
                "prz": p.get("prz"),
            })
    if temp_signal != "NEUTRAL":
        b, r = patterns_bonus(pats, temp_signal)
        score += b
        _sub_patterns += b
        reasons += r

    # ── Jour 10 : Régime de marché ──
    regime = detect_regime(high, low, close)
    temp_signal2 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal2 != "NEUTRAL":
        b, r = regime_bonus(regime, temp_signal2)
        score += b
        _sub_regime += b
        reasons += r

    # ── Phase 3 : SMC (FVG + Order Blocks + Liquidité) ──
    smc = analyze_smc(open_col, high, low, close, volume=df["volume"])
    temp_signal3 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal3 != "NEUTRAL":
        b, r = smc_bonus(smc["fvg"], smc["ob"], smc["liquidity"], temp_signal3)
        score += b
        _sub_smc += b
        reasons += r

    # ── On-chain (crypto uniquement) : Fear&Greed contrarian + Funding squeeze ──
    advanced_flags = {}
    if onchain and temp_signal3 != "NEUTRAL":
        b, r = onchain_bonus(
            onchain.get("context") or {}, temp_signal3, onchain.get("fear_greed")
        )
        score += b
        _sub_sentiment += b
        reasons += r

        adv_ctx = onchain.get("advanced") or {}
        if adv_ctx:
            b, r, f = advanced_onchain_bonus(adv_ctx, temp_signal3)
            score += b
            reasons += r
            advanced_flags = f

    # ── Tokenomics risk (crypto uniquement) : unlocks + concentration ──
    tokenomics_flags = {}
    if asset_type == "CRYPTO" and tokenomics_context:
        penalty, r, f = tokenomics_penalty(tokenomics_context, temp_signal3)
        if penalty:
            score -= penalty
            reasons += r
        if f.get("danger_flag"):
            tokenomics_flags["danger_flag"] = True
        if f.get("concentration_flag"):
            tokenomics_flags["concentration_flag"] = True

    # ── Social sentiment (crypto uniquement) : LunarCrush momentum ──
    if asset_type == "CRYPTO" and social_context and temp_signal3 != "NEUTRAL":
        b, r = social_bonus(social_context, temp_signal3)
        if b:
            score += b
            reasons += r

    # ── Universal Market Representation (Phase A++) ──
    market_concept_vector = compute_market_concept_vector(
        symbol,
        df,
        asset_type,
        regime=regime,
        htf_regime=htf_regime,
        mtf_regime=mtf_regime,
        pa=pa,
        smc=smc,
        sr=sr,
        onchain_context=onchain if asset_type == "CRYPTO" else None,
        forex_context=forex_context if asset_type == "FOREX" else None,
    )
    market_embedding = build_market_embedding(market_concept_vector, symbol, timeframe)
    feature_vector = build_feature_vector(symbol, timeframe, df)

    # ── Confluence multi-timeframe (3-TF hierarchy) ──
    # Règle : on applique d'abord le TF intermédiaire (MTF, poids fort)
    # puis le TF supérieur (HTF, poids léger car plus éloigné de l'exécution).
    # MTF : même actif, TF juste au-dessus de l'exécution → décision  (+15/-25)
    # HTF : contexte macro → confirme/invalide la tendance générale (+10/-15)
    provisional_dir = "BUY" if score >= 0 else "SELL"
    hierarchy = _TF_HIERARCHY.get(timeframe, ("4h", "1d"))
    mtf_label, htf_label = hierarchy

    if mtf_regime:
        mtf_r = mtf_regime.get("regime", "UNKNOWN")
        if mtf_r == "TRENDING_BULL" and provisional_dir == "BUY":
            score += 15
            _sub_mtf += 15
            reasons.append(f"MTF({mtf_label}): alignement TRENDING_BULL")
        elif mtf_r == "TRENDING_BULL" and provisional_dir == "SELL":
            score -= 25
            _sub_mtf -= 25
            reasons.append(f"MTF({mtf_label}): contre-tendance TRENDING_BULL — pénalité")
        elif mtf_r == "TRENDING_BEAR" and provisional_dir == "SELL":
            score += 15
            _sub_mtf += 15
            reasons.append(f"MTF({mtf_label}): alignement TRENDING_BEAR")
        elif mtf_r == "TRENDING_BEAR" and provisional_dir == "BUY":
            score -= 25
            _sub_mtf -= 25
            reasons.append(f"MTF({mtf_label}): contre-tendance TRENDING_BEAR — pénalité")
        elif mtf_r == "VOLATILE":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"MTF({mtf_label}): VOLATILE — réduction score")

    if htf_regime:
        htf_r = htf_regime.get("regime", "UNKNOWN")
        provisional_dir = "BUY" if score >= 0 else "SELL"  # recalc après MTF
        if htf_r == "TRENDING_BULL" and provisional_dir == "BUY":
            score += 10
            _sub_mtf += 10
            reasons.append(f"HTF({htf_label}): alignement TRENDING_BULL")
        elif htf_r == "TRENDING_BULL" and provisional_dir == "SELL":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"HTF({htf_label}): contre-tendance TRENDING_BULL — pénalité")
        elif htf_r == "TRENDING_BEAR" and provisional_dir == "SELL":
            score += 10
            _sub_mtf += 10
            reasons.append(f"HTF({htf_label}): alignement TRENDING_BEAR")
        elif htf_r == "TRENDING_BEAR" and provisional_dir == "BUY":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"HTF({htf_label}): contre-tendance TRENDING_BEAR — pénalité")
        elif htf_r == "VOLATILE":
            score -= 10
            _sub_mtf -= 10
            reasons.append(f"HTF({htf_label}): VOLATILE — réduction score")

    # ── D1/Weekly Bias (couche générale, non bloquante) ──
    # Le bias D1/Weekly apporte un bonus/malus léger sur le score.
    # Contrairement au MTF/HTF, cette couche ne filtre jamais — elle ajuste seulement.
    # D1 aligné = +10, D1 opposé = -5, Weekly aligné = +8, Weekly opposé = -4.
    # Si D1 et Weekly sont opposés entre eux → pas de bonus (indécision macro).
    if bias_regimes:
        provisional_dir = "BUY" if score >= 0 else "SELL"
        d1_regime = bias_regimes.get("1d")
        w1_regime = bias_regimes.get("1w")

        d1_aligned = False
        d1_opposed = False

        if d1_regime and d1_regime.get("regime") not in ("UNKNOWN", None):
            d1_r = d1_regime["regime"]
            if d1_r == "TRENDING_BULL" and provisional_dir == "BUY":
                score += 10; _sub_bias += 10
                reasons.append("Bias(D1): TRENDING_BULL aligné (+10)")
                d1_aligned = True
            elif d1_r == "TRENDING_BEAR" and provisional_dir == "SELL":
                score += 10; _sub_bias += 10
                reasons.append("Bias(D1): TRENDING_BEAR aligné (+10)")
                d1_aligned = True
            elif d1_r == "TRENDING_BULL" and provisional_dir == "SELL":
                score -= 5; _sub_bias -= 5
                reasons.append("Bias(D1): contre-tendance TRENDING_BULL (-5)")
                d1_opposed = True
            elif d1_r == "TRENDING_BEAR" and provisional_dir == "BUY":
                score -= 5; _sub_bias -= 5
                reasons.append("Bias(D1): contre-tendance TRENDING_BEAR (-5)")
                d1_opposed = True

        if w1_regime and w1_regime.get("regime") not in ("UNKNOWN", None):
            w1_r = w1_regime["regime"]
            # Si D1 et Weekly sont opposés, skip le Weekly (indécision macro)
            if d1_aligned and w1_r in ("TRENDING_BULL", "TRENDING_BEAR"):
                if (w1_r == "TRENDING_BULL" and provisional_dir == "BUY") or \
                   (w1_r == "TRENDING_BEAR" and provisional_dir == "SELL"):
                    score += 8; _sub_bias += 8
                    reasons.append("Bias(1W): aligné avec D1 (+8)")
                else:
                    score -= 4; _sub_bias -= 4
                    reasons.append("Bias(1W): opposé au signal (-4)")
            elif d1_opposed and w1_r in ("TRENDING_BULL", "TRENDING_BEAR"):
                # D1 déjà opposé — Weekly dans le sens du signal = renforcement du doute
                if (w1_r == "TRENDING_BULL" and provisional_dir == "BUY") or \
                   (w1_r == "TRENDING_BEAR" and provisional_dir == "SELL"):
                    score += 4; _sub_bias += 4
                    reasons.append("Bias(1W): aligné avec signal mais D1 opposé (+4)")
                else:
                    score -= 8; _sub_bias -= 8
                    reasons.append("Bias(1W): opposé au signal, D1 aussi opposé (-8)")
            elif not d1_aligned and not d1_opposed:
                # D1 inconnu ou ranging — Weekly seul
                if (w1_r == "TRENDING_BULL" and provisional_dir == "BUY") or \
                   (w1_r == "TRENDING_BEAR" and provisional_dir == "SELL"):
                    score += 5; _sub_bias += 5
                    reasons.append("Bias(1W): aligné (+5)")
                else:
                    score -= 3; _sub_bias -= 3
                    reasons.append("Bias(1W): opposé (-3)")

    # ── Forex macro context : DXY momentum adjustment ──
    if asset_type == "FOREX" and forex_context:
        dxy_adj = forex_context.get("score_adjustment", 0)
        if dxy_adj:
            score += dxy_adj
            reasons.extend(forex_context.get("reasons", []))

    provisional_signal = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")

    # Appliquer le filtre de régime (hard block) — bloque VOLATILE et contre-tendance confirmée
    allowed, filter_reason = regime_filter(regime, provisional_signal)
    if not allowed and provisional_signal != "NEUTRAL":
        signal = "NEUTRAL"
        confidence = 0
        reasons.append(f"[FILTERED] {filter_reason} | score brut={score}")
    else:
        signal = provisional_signal
        confidence = min(abs(score), 95) if signal != "NEUTRAL" else 0

    # ── Forex macro risk : suspend new signals before high-impact news ──
    if asset_type == "FOREX" and forex_context and forex_context.get("macro_risk"):
        signal = "NEUTRAL"
        confidence = 0
        reasons.append("Macro risk: événement HIGH dans <2h — scan forex suspendu")

    # ── Phase F — News filter for COMMODITY and CRYPTO (pre-strategy) ──
    if asset_type in ("COMMODITY", "CRYPTO") and news_context and news_context.get("macro_risk"):
        signal = "NEUTRAL"
        confidence = 0
        _next_ev = news_context.get("next_event", {})
        _ev_title = _next_ev.get("title", "unknown") if isinstance(_next_ev, dict) else "unknown"
        reasons.append(f"Macro risk: événement HIGH dans <2h ({_ev_title}) — signal suspendu")

    # Tokenomics danger : gros unlock imminent → signal désactivé
    if asset_type == "CRYPTO" and tokenomics_flags.get("danger_flag"):
        signal = "NEUTRAL"
        confidence = 0
        reasons.append("Tokenomics: unlock >20% supply <30j — signal désactivé")

    # Price levels — multiplicateurs ATR adaptés au régime
    # Plafond R:R = tp1_mult / sl_mult. Objectif: R:R ≥ 1.5 après ajustement SL.
    # RANGING      : SL serré, TP modéré (range limité)
    # TRENDING     : SL standard, TP élargi (tendance porte plus loin)
    # VOLATILE     : SL élargi pour absorber le bruit, TP suffisamment élargi
    # UNKNOWN/other : valeurs par défaut
    _reg = regime.get("regime", "UNKNOWN")
    if _reg == "RANGING":
        _sl_mult, _tp1_mult, _tp2_mult = 1.2, 2.2, 3.5
    elif _reg in ("TRENDING_BULL", "TRENDING_BEAR"):
        _ts = regime.get("trend_strength", "MODERATE")
        if _ts == "STRONG":
            _sl_mult, _tp1_mult, _tp2_mult = 1.5, 3.5, 5.5
        else:
            _sl_mult, _tp1_mult, _tp2_mult = 1.5, 2.8, 4.5
    elif _reg == "VOLATILE":
        _sl_mult, _tp1_mult, _tp2_mult = 2.0, 3.2, 4.5
    else:
        _sl_mult, _tp1_mult, _tp2_mult = 1.5, 2.8, 4.5

    entry = round(c_val, 6)
    sl  = round(c_val - atr_v * _sl_mult,  6) if atr_v and signal == "BUY"  else (
          round(c_val + atr_v * _sl_mult,  6) if atr_v and signal == "SELL" else None)
    tp1 = round(c_val + atr_v * _tp1_mult, 6) if atr_v and signal == "BUY"  else (
          round(c_val - atr_v * _tp1_mult, 6) if atr_v and signal == "SELL" else None)
    tp2 = round(c_val + atr_v * _tp2_mult, 6) if atr_v and signal == "BUY"  else (
          round(c_val - atr_v * _tp2_mult, 6) if atr_v and signal == "SELL" else None)

    # ── SL liquidity-aware : éviter de poser le SL dans une zone EQL/EQH de stop hunt ──
    if sl is not None and atr_v:
        sl_buffer = atr_v * 0.3
        liq = smc.get("liquidity", {})
        if signal == "BUY":
            eql_zones = [z for z in liq.get("equal_lows", []) if z["price"] <= entry]
            if eql_zones:
                nearest = max(eql_zones, key=lambda z: z["price"])
                cluster_min = nearest["min"]
                if sl >= cluster_min - sl_buffer:
                    sl = round(cluster_min - sl_buffer, 6)
                    reasons.append(f"SL moved below equal-low cluster {cluster_min:.2f}")
        elif signal == "SELL":
            eqh_zones = [z for z in liq.get("equal_highs", []) if z["price"] >= entry]
            if eqh_zones:
                nearest = min(eqh_zones, key=lambda z: z["price"])
                cluster_max = nearest["max"]
                if sl <= cluster_max + sl_buffer:
                    sl = round(cluster_max + sl_buffer, 6)
                    reasons.append(f"SL moved above equal-high cluster {cluster_max:.2f}")

    # ── TP scale-out : utiliser la zone de liquidité comme sortie partielle, pas TP1 ──
    scale_out_tp = None
    if tp1 is not None and atr_v:
        liq = smc.get("liquidity", {})
        if signal == "BUY":
            eqh_zones = [z for z in liq.get("equal_highs", []) if z["price"] > entry]
            if eqh_zones:
                nearest = min(eqh_zones, key=lambda z: z["price"])
                liq_tp = round(nearest["price"], 6)
                liq_rr = abs(liq_tp - entry) / abs(entry - sl) if sl and abs(entry - sl) > 0 else 0
                if liq_rr >= 1.5:
                    tp1 = liq_tp
                    reasons.append(f"TP1 set to next equal-high {tp1:.2f} (R:R {liq_rr:.2f})")
                else:
                    scale_out_tp = liq_tp
                    reasons.append(f"Scale-out TP at equal-high {liq_tp:.2f} (R:R {liq_rr:.2f} < 1.5, keeping ATR TP1)")
        elif signal == "SELL":
            eql_zones = [z for z in liq.get("equal_lows", []) if z["price"] < entry]
            if eql_zones:
                nearest = max(eql_zones, key=lambda z: z["price"])
                liq_tp = round(nearest["price"], 6)
                liq_rr = abs(liq_tp - entry) / abs(entry - sl) if sl and abs(entry - sl) > 0 else 0
                if liq_rr >= 1.5:
                    tp1 = liq_tp
                    reasons.append(f"TP1 set to next equal-low {tp1:.2f} (R:R {liq_rr:.2f})")
                else:
                    scale_out_tp = liq_tp
                    reasons.append(f"Scale-out TP at equal-low {liq_tp:.2f} (R:R {liq_rr:.2f} < 1.5, keeping ATR TP1)")

    rr  = round(abs(tp1 - entry) / abs(entry - sl), 2) if sl and tp1 and abs(entry - sl) > 0 else None

    _mtf_tf, _htf_tf = _TF_HIERARCHY.get(timeframe, ("4h", "1d"))
    # default strategy metadata
    strategy_id = None
    strategy_name = None
    profile_suitability = []
    trigger = None
    signal_pending = None
    invalidation = {}
    dps = None
    tps = None
    success_probability = None
    expected_move = None

    if strategy:
        rules = parse_rules(strategy.get("rules", {}))
        rules.analysis_timeframe = strategy.get("analysisTimeframe") or strategy.get("analysis_timeframe")
        rules.entry_timeframe = strategy.get("entryTimeframe") or strategy.get("entry_timeframe")
        rules._name = strategy.get("name", "unknown")
        ev = evaluate_strategy(
            rules,
            indicators={
                "close": c_val, "ema20": e20_v, "ema50": e50_v, "ema200": e200_v,
                "rsi": rsi_v, "atr": atr_v, "volume_ratio": vol_r,
                "macd": macd_v, "macd_signal": macd_sig_v, "macd_hist": macd_hist_v,
                "bb_upper": bb_upper_v, "bb_mid": bb_mid_v, "bb_lower": bb_lower_v, "bb_bw": bb_bw_v,
            },
            pa=pa,
            sr=sr,
            patterns=pats,
            smc=smc,
            regime=regime,
            timeframe=timeframe,
            market={"COMMODITY": "COMMODITIES", "BRVM": "STOCKS"}.get(asset_type, asset_type),
            onchain=onchain,
            entry_context=entry_context,
        )
        signal = ev["signal"]
        confidence = ev["confidence"]
        score = ev["score"]
        dps = ev["dps"]
        tps = ev["tps"]
        success_probability = ev["success_probability"]
        expected_move = ev["expected_move"]
        reasons = ev["reasons"]
        entry = ev["entry_price"] if ev["entry_price"] is not None else entry
        sl = ev["stop_loss"] if ev["stop_loss"] is not None else sl
        tp1 = ev["take_profit_1"] if ev["take_profit_1"] is not None else tp1
        tp2 = ev["take_profit_2"] if ev["take_profit_2"] is not None else tp2
        rr = ev["risk_reward"] if ev["risk_reward"] is not None else rr
        strategy_id = strategy.get("id")
        strategy_name = strategy.get("name")
        profile_suitability = ev["profile_suitability"]
        trigger = ev["trigger"]
        signal_pending = ev["signal_pending"]
        invalidation = ev["invalidation"]

        if signal != "NEUTRAL":
            _strat_regimes = (strategy.get("rules", {}).get("filters", {}) or {}).get("regime")
            _cur_regime = regime.get("regime")
            if _cur_regime == "VOLATILE" and _strat_regimes and "VOLATILE" in _strat_regimes:
                pass  # strategy explicitly allows VOLATILE — skip only that rule
            else:
                allowed, filter_reason = regime_filter(regime, signal)
                if not allowed:
                    signal = "NEUTRAL"
                    confidence = 0
                    reasons.append(f"[FILTERED] {filter_reason}")

        # ── Re-apply risk guards that evaluate_strategy doesn't know about ──
        # evaluate_strategy overwrites signal/confidence/score, so guards applied
        # earlier in the pipeline are silently bypassed. Re-apply them here.

        # Forex macro risk: suspend signals before high-impact news
        if signal != "NEUTRAL" and asset_type == "FOREX" and forex_context and forex_context.get("macro_risk"):
            signal = "NEUTRAL"
            confidence = 0
            reasons.append("Macro risk: événement HIGH dans <2h — scan forex suspendu")

        # Phase F — News filter for COMMODITY and CRYPTO
        if signal != "NEUTRAL" and news_context and news_context.get("macro_risk"):
            signal = "NEUTRAL"
            confidence = 0
            _next_ev = news_context.get("next_event", {})
            _ev_title = _next_ev.get("title", "unknown") if isinstance(_next_ev, dict) else "unknown"
            reasons.append(f"Macro risk: événement HIGH dans <2h ({_ev_title}) — signal suspendu")

        # Tokenomics danger: big unlock imminent → signal disabled
        if signal != "NEUTRAL" and asset_type == "CRYPTO" and tokenomics_flags.get("danger_flag"):
            signal = "NEUTRAL"
            confidence = 0
            reasons.append("Tokenomics: unlock >20% supply <30j — signal désactivé")

        # DXY momentum adjustment for Forex
        if signal != "NEUTRAL" and asset_type == "FOREX" and forex_context:
            dxy_adj = forex_context.get("score_adjustment", 0)
            if dxy_adj:
                score += dxy_adj
                reasons.extend(forex_context.get("reasons", []))

        # Gold specialist bonus (DXY correlation + session + safe haven)
        if signal != "NEUTRAL" and is_gold_symbol(symbol):
            import time as _time
            _utc_hour = _time.gmtime().tm_hour
            _dxy_data = None
            if gold_dxy:
                _dxy_data = {
                    "trend": "bullish" if gold_dxy.get("momentum_5d", 0) > 0 else "bearish" if gold_dxy.get("momentum_5d", 0) < 0 else "neutral",
                    "change_pct": gold_dxy.get("momentum_5d", 0) * 100,
                }
            _gold_bonus, _gold_reasons = gold_specialist_bonus(signal, score, regime, _dxy_data, _utc_hour)
            if _gold_bonus:
                score += _gold_bonus
                reasons.extend(_gold_reasons)
                confidence = min(abs(score), 95) if signal != "NEUTRAL" else 0

            # Gold-adapted ATR multipliers for SL/TP
            if atr_v and entry:
                _session_info = gold_session_info(_utc_hour)
                _sl_m, _tp1_m, _tp2_m = gold_atr_adjustment(atr_v, entry, _session_info)
                if signal == "BUY":
                    sl = round(entry - atr_v * _sl_m, 6)
                    tp1 = round(entry + atr_v * _tp1_m, 6)
                    tp2 = round(entry + atr_v * _tp2_m, 6)
                elif signal == "SELL":
                    sl = round(entry + atr_v * _sl_m, 6)
                    tp1 = round(entry - atr_v * _tp1_m, 6)
                    tp2 = round(entry - atr_v * _tp2_m, 6)
                rr_val = None
                from utils.risk_reward import compute_rr as _compute_rr
                if sl and tp1 and abs(entry - sl) > 0:
                    rr_val = _compute_rr(entry, sl, tp1)
                rr = rr_val if rr_val is not None else rr

        # Social sentiment bonus for Crypto
        if signal != "NEUTRAL" and asset_type == "CRYPTO" and social_context:
            _sb, _sr = social_bonus(social_context, signal)
            if _sb:
                score += _sb
                reasons.extend(_sr)

        # MTF confluence score adjustment
        if signal != "NEUTRAL" and htf_regime and mtf_regime:
            _strat_dir = "BUY" if score >= 0 else "SELL"
            if mtf_regime:
                _mtf_r = mtf_regime.get("regime", "UNKNOWN")
                if _mtf_r == "TRENDING_BULL" and signal == "BUY":
                    score += 15; reasons.append(f"MTF({_mtf_tf}): alignement TRENDING_BULL")
                elif _mtf_r == "TRENDING_BULL" and signal == "SELL":
                    score -= 25; reasons.append(f"MTF({_mtf_tf}): contre-tendance TRENDING_BULL")
                elif _mtf_r == "TRENDING_BEAR" and signal == "SELL":
                    score += 15; reasons.append(f"MTF({_mtf_tf}): alignement TRENDING_BEAR")
                elif _mtf_r == "TRENDING_BEAR" and signal == "BUY":
                    score -= 25; reasons.append(f"MTF({_mtf_tf}): contre-tendance TRENDING_BEAR")
                elif _mtf_r == "VOLATILE":
                    score -= 15; reasons.append(f"MTF({_mtf_tf}): VOLATILE — réduction score")
            if htf_regime:
                _htf_r = htf_regime.get("regime", "UNKNOWN")
                if _htf_r == "TRENDING_BULL" and signal == "BUY":
                    score += 10; reasons.append(f"HTF({_htf_tf}): alignement TRENDING_BULL")
                elif _htf_r == "TRENDING_BULL" and signal == "SELL":
                    score -= 15; reasons.append(f"HTF({_htf_tf}): contre-tendance TRENDING_BULL")
                elif _htf_r == "TRENDING_BEAR" and signal == "SELL":
                    score += 10; reasons.append(f"HTF({_htf_tf}): alignement TRENDING_BEAR")
                elif _htf_r == "TRENDING_BEAR" and signal == "BUY":
                    score -= 15; reasons.append(f"HTF({_htf_tf}): contre-tendance TRENDING_BEAR")
                elif _htf_r == "VOLATILE":
                    score -= 10; reasons.append(f"HTF({_htf_tf}): VOLATILE — réduction score")

        # Re-apply D1/Weekly bias after strategy merge
        if signal != "NEUTRAL" and bias_regimes:
            _bias_dir = "BUY" if score >= 0 else "SELL"
            _d1 = bias_regimes.get("1d")
            _w1 = bias_regimes.get("1w")
            if _d1 and _d1.get("regime") in ("TRENDING_BULL", "TRENDING_BEAR"):
                _d1r = _d1["regime"]
                if (_d1r == "TRENDING_BULL" and _bias_dir == "BUY") or (_d1r == "TRENDING_BEAR" and _bias_dir == "SELL"):
                    score += 10; _sub_bias += 10; reasons.append("Bias(D1): aligné (+10)")
                else:
                    score -= 5; _sub_bias -= 5; reasons.append("Bias(D1): opposé (-5)")
            if _w1 and _w1.get("regime") in ("TRENDING_BULL", "TRENDING_BEAR"):
                _w1r = _w1["regime"]
                if (_w1r == "TRENDING_BULL" and _bias_dir == "BUY") or (_w1r == "TRENDING_BEAR" and _bias_dir == "SELL"):
                    score += 8; _sub_bias += 8; reasons.append("Bias(1W): aligné (+8)")
                else:
                    score -= 4; _sub_bias -= 4; reasons.append("Bias(1W): opposé (-4)")

        # ── Re-apply liquidity-aware SL/TP after strategy merge ──
        # evaluate_strategy returns ATR-based SL/TP which overwrites the
        # liquidity-aware adjustments computed above. Re-apply them here
        # so the final SL/TP respects market structure (EQL/EQH zones).
        if signal != "NEUTRAL" and sl is not None and atr_v:
            sl_buffer = atr_v * 0.3
            _liq = smc.get("liquidity", {})
            if signal == "BUY":
                _eql = [z for z in _liq.get("equal_lows", []) if z["price"] <= entry]
                if _eql:
                    _nearest = max(_eql, key=lambda z: z["price"])
                    _cluster_min = _nearest["min"]
                    if sl >= _cluster_min - sl_buffer:
                        sl = round(_cluster_min - sl_buffer, 6)
                        reasons.append(f"SL moved below equal-low cluster {_cluster_min:.2f}")
            elif signal == "SELL":
                _eqh = [z for z in _liq.get("equal_highs", []) if z["price"] >= entry]
                if _eqh:
                    _nearest = min(_eqh, key=lambda z: z["price"])
                    _cluster_max = _nearest["max"]
                    if sl <= _cluster_max + sl_buffer:
                        sl = round(_cluster_max + sl_buffer, 6)
                        reasons.append(f"SL moved above equal-high cluster {_cluster_max:.2f}")

        if signal != "NEUTRAL" and tp1 is not None and atr_v:
            _liq = smc.get("liquidity", {})
            if signal == "BUY":
                _eqh = [z for z in _liq.get("equal_highs", []) if z["price"] > entry]
                if _eqh:
                    _nearest = min(_eqh, key=lambda z: z["price"])
                    _liq_tp = round(_nearest["price"], 6)
                    _liq_rr = abs(_liq_tp - entry) / abs(entry - sl) if sl and abs(entry - sl) > 0 else 0
                    if _liq_rr >= 1.5:
                        tp1 = _liq_tp
                        reasons.append(f"TP1 set to next equal-high {tp1:.2f} (R:R {_liq_rr:.2f})")
                    else:
                        scale_out_tp = _liq_tp
                        reasons.append(f"Scale-out TP at equal-high {_liq_tp:.2f} (R:R {_liq_rr:.2f} < 1.5, keeping ATR TP1)")
            elif signal == "SELL":
                _eql = [z for z in _liq.get("equal_lows", []) if z["price"] < entry]
                if _eql:
                    _nearest = max(_eql, key=lambda z: z["price"])
                    _liq_tp = round(_nearest["price"], 6)
                    _liq_rr = abs(_liq_tp - entry) / abs(entry - sl) if sl and abs(entry - sl) > 0 else 0
                    if _liq_rr >= 1.5:
                        tp1 = _liq_tp
                        reasons.append(f"TP1 set to next equal-low {tp1:.2f} (R:R {_liq_rr:.2f})")
                    else:
                        scale_out_tp = _liq_tp
                        reasons.append(f"Scale-out TP at equal-low {_liq_tp:.2f} (R:R {_liq_rr:.2f} < 1.5, keeping ATR TP1)")

        # ── Recalculate rr + predictive metrics after liquidity-aware refinement ──
        # sl and tp1 may have changed from ATR-based to liquidity zone-based,
        # so rr, dps, tps, success_probability, expected_move must be recomputed
        # to stay consistent with the final returned values.
        if signal != "NEUTRAL" and sl is not None and tp1 is not None and entry is not None:
            from utils.risk_reward import compute_rr
            if abs(entry - sl) > 0:
                rr = compute_rr(entry, sl, tp1)
            if strategy and dps is not None:
                from utils.predictive import compute_predictive_metrics
                _pred = compute_predictive_metrics(
                    signal, confidence, entry, tp1, sl, rr,
                    indicators={"close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v},
                    pa=pa, regime=regime, smc=smc, mtf_aligned=None, trigger=trigger,
                )
                dps = _pred["dps"]
                tps = _pred["tps"]
                success_probability = _pred["success_probability"]
                expected_move = _pred["expected_move"]

    # ── Synthetic caution filter: reduce confidence on spike risk ──
    # Applied after evaluate_strategy but BEFORE returning — recalculate DPS
    # so it's consistent with the reduced confidence.
    if asset_type == "SYNTHETIC" and synthetic_stats and signal != "NEUTRAL":
        _caution = synthetic_stats.get("caution", False)
        _spike_prob = synthetic_stats.get("spike_probability", 0)
        if _caution or _spike_prob > 70:
            confidence = int(confidence * 0.7)
            reasons.append(f"Synthetic caution: spike_prob={_spike_prob:.1f}% — confidence reduced 30%")
            if confidence < 40:
                signal = "NEUTRAL"
                confidence = 0
                reasons.append("Synthetic spike risk too high — signal neutralised")
            elif strategy and dps is not None:
                # Recalculate DPS on reduced confidence for consistency
                from utils.predictive import compute_predictive_metrics
                _pred = compute_predictive_metrics(
                    signal, confidence, entry, tp1, sl, rr,
                    indicators={"close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v},
                    pa=pa, regime=regime, smc=smc, mtf_aligned=None, trigger=trigger,
                )
                dps = _pred["dps"]
                tps = _pred["tps"]
                success_probability = _pred["success_probability"]
                expected_move = _pred["expected_move"]
                # Re-check min_dps on recalculated value
                _min_dps = float(_rules_raw.get("min_dps", 60))
                if dps < _min_dps:
                    reasons.append(f"DPS {dps}% < seuil {_min_dps}% après caution filter — filtré")
                    signal = "NEUTRAL"
                    confidence = 0

    if not profile_suitability:
        profile_suitability = derive_profile_suitability(
            timeframe,
            rr,
            [],
            signal,
            confidence,
        )

    _mtf_aligned = (
        (mtf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BULL" and signal == "BUY" or
        (mtf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BEAR" and signal == "SELL"
    ) if mtf_regime else None
    _htf_aligned = (
        (htf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BULL" and signal == "BUY" or
        (htf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BEAR" and signal == "SELL"
    ) if htf_regime else None

    # --- Confluence scoring on detected chart/harmonic patterns ---
    if chart_patterns:
        scored_patterns = []
        mtf_ctx = {"mtf_aligned": _mtf_aligned, "htf_aligned": _htf_aligned}
        for p in chart_patterns:
            conf, tags = score_pattern_confluence(p, pa, smc, mtf_context=mtf_ctx, regime=regime, sr=sr)
            p["confluenceScore"] = conf
            p["confluenceTags"] = tags
            scored_patterns.append(p)
        scored_patterns.sort(key=lambda x: x.get("confluenceScore", 0), reverse=True)
        chart_patterns = scored_patterns

        # ── Broadcast pattern alerts via WebSocket ──
        from routers.ws import broadcast_pattern
        for p in chart_patterns:
            broadcast_pattern({
                "symbol": symbol,
                "timeframe": timeframe,
                "name": p.get("name"),
                "category": p.get("category"),
                "direction": p.get("direction"),
                "confidence": p.get("confidence"),
                "confluenceScore": p.get("confluenceScore"),
                "confluenceTags": p.get("confluenceTags"),
                "entry": p.get("entry"),
                "stop_loss": p.get("stop_loss"),
                "targets": p.get("targets"),
                "prz": p.get("prz"),
            })

    # --- Predictive metrics for default hardcoded path (Sprint 4) ---
    if not strategy:
        from utils.predictive import compute_predictive_metrics
        predictive = compute_predictive_metrics(
            signal,
            confidence,
            entry,
            tp1,
            sl,
            rr,
            indicators={
                "close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v,
            },
            pa=pa,
            regime=regime,
            smc=smc,
            mtf_aligned=_mtf_aligned,
            trigger=None,
        )
        dps = predictive["dps"]
        tps = predictive["tps"]
        success_probability = predictive["success_probability"]
        expected_move = predictive["expected_move"]

        # --- DPS filter (Sprint 4) — signal directionnel peu fiable → non persisté ---
        if signal != "NEUTRAL" and dps is not None and dps < 60.0:
            reasons.append(f"DPS {dps}% < seuil 60% — filtré")
            signal = "NEUTRAL"
            confidence = 0

    # ── Clean price levels when signal is NEUTRAL ──
    if signal == "NEUTRAL":
        sl = None
        tp1 = None
        tp2 = None
        rr = None

    # ── Risk engine evaluation ──
    risk_assessment = None
    if signal != "NEUTRAL" and entry is not None and sl is not None:
        try:
            _risk = get_risk_engine()
            _direction = "BUY" if signal == "BUY" else "SELL"
            _atr_pct = (atr_v / entry) * 100 if atr_v and entry else 0.0
            _score_norm = min(abs(score) / 100.0, 1.0) if score else 0.5
            _strategy_name = (strategy or {}).get("name", "default").lower().replace(" ", "_") if strategy else "default"
            _regime_name = (regime or {}).get("regime", "UNKNOWN")
            risk_assessment = _risk.evaluate(
                symbol=symbol,
                direction=_direction,
                entry=entry,
                stop_loss=sl,
                atr_pct=_atr_pct,
                signal_score=_score_norm,
                strategy=_strategy_name,
                regime=_regime_name,
            )
            if risk_assessment.decision == TradeDecision.BLOCKED:
                signal = "NEUTRAL"
                confidence = 0
                sl = None
                tp1 = None
                tp2 = None
                rr = None
                reasons.append(f"[RISK BLOCKED] {'; '.join(risk_assessment.reasons)}")
        except Exception as _e:
            logger.warning("risk_engine.evaluate failed", error=str(_e))

    # ── Phase 0++: Risk level computation ──
    _final_mcap_tier = market_cap_tier or get_market_cap_tier_sync(symbol, asset_type)
    _final_liquidity = liquidity_data or estimate_liquidity_score_sync(symbol, asset_type, df)
    _atr_pct = (atr_v / c_val) * 100 if atr_v and c_val else 0.0
    _risk_level_result = compute_risk_level(
        asset_type=asset_type,
        market_cap_tier=_final_mcap_tier,
        liquidity_score=_final_liquidity.get("score", 50.0),
        atr_pct=_atr_pct,
    )
    _risk_level = _risk_level_result["risk_level"]
    _risk_reasons = _risk_level_result["reasons"]

    # Liquidity warning: reduce confidence if critical
    if signal != "NEUTRAL" and _final_liquidity.get("score", 100) < 10:
        confidence = int(confidence * 0.5)
        reasons.append(f"Liquidité critique (score={_final_liquidity['score']}) — confidence réduite 50%")
        if confidence < 40:
            signal = "NEUTRAL"
            confidence = 0
            reasons.append("Liquidité insuffisante — signal neutralisé")

    # ── Phase 0++: Red flags checklist ──
    _red_flags = red_flags_data or {"red_flags": [], "red_flag_count": 0, "danger": False, "warning": None}
    if signal != "NEUTRAL" and _red_flags.get("danger"):
        signal = "NEUTRAL"
        confidence = 0
        sl = None
        tp1 = None
        tp2 = None
        rr = None
        reasons.append(f"[RED FLAGS] {_red_flags.get('warning', 'Projet à risque extrême')}")

    # ── Signal Quality Gate (14-layer filter) ─────────────────────
    _qg_asset_type = "GOLD" if is_gold_symbol(symbol) else asset_type
    _quality_gate = apply_quality_gate(
        signal=signal,
        asset_type=_qg_asset_type,
        symbol=symbol,
        entry=entry,
        tp1=tp1,
        df=df,
        session_info=session_info,
        liquidity_data=_final_liquidity,
        news_context=news_context if news_context else (forex_context if forex_context else None),
        regime=regime,
        atr_value=atr_v,
        onchain_context=onchain.get("context") if onchain else None,
        dxy_data=gold_dxy,
    )
    if not _quality_gate["passed"]:
        _reject_reasons = [r["reason"] for r in _quality_gate["rejected_layers"]]
        logger.info(
            "quality_gate.rejected",
            symbol=symbol,
            asset_type=asset_type,
            signal=signal,
            layers=[r["layer"] for r in _quality_gate["rejected_layers"]],
            reasons=_reject_reasons,
        )
        signal = "NEUTRAL"
        confidence = 0
        sl = None
        tp1 = None
        tp2 = None
        rr = None
        reasons.append(f"[QUALITY GATE] {' | '.join(_reject_reasons)}")
    else:
        if _quality_gate["confidence_penalty"] > 0:
            confidence = int(confidence * (1.0 - _quality_gate["confidence_penalty"]))
            if confidence < 40:
                signal = "NEUTRAL"
                confidence = 0
                reasons.append("[QUALITY GATE] Confidence trop basse après pénalité qualité")
        if _quality_gate["quality_flags"]:
            reasons.append(f"[QUALITY] {' | '.join(_quality_gate['quality_flags'])}")

    result = {
        "symbol":       symbol,
        "strategy_id":  strategy_id,
        "strategy_name": strategy_name,
        "is_default":   _using_default,
        "analysis_timeframe": (strategy or {}).get("analysisTimeframe") or (strategy or {}).get("analysis_timeframe") or timeframe,
        "entry_timeframe":    (strategy or {}).get("entryTimeframe")    or (strategy or {}).get("entry_timeframe")    or timeframe,
        "score":        score,
        "profile_suitability": profile_suitability,
        "trigger":      trigger,
        "signal_pending": signal_pending,
        "invalidation": invalidation,
        "dps":          dps,
        "tps":          tps,
        "success_probability": success_probability,
        "expected_move": expected_move,
        "timeframe":    timeframe,
        "asset_type":   asset_type,
        "signal":       signal,
        "confidence":   confidence,
        "_confidence_before_sentiment": confidence,  # snapshot avant enrichissement sentiment
        "entry_price":  entry,
        "stop_loss":    sl,
        "take_profit_1": tp1,
        "take_profit_2": tp2,
        "scale_out_tp": scale_out_tp,
        "risk_reward":  rr,
        "explanation":  " | ".join(reasons) or "No clear setup",
        "indicators": {
            "close": entry, "ema20": e20_v, "ema50": e50_v, "ema200": e200_v,
            "rsi": rsi_v, "atr": atr_v, "volume_ratio": vol_r,
            "macd": macd_v, "macd_signal": macd_sig_v, "macd_hist": macd_hist_v,
            "bb_upper": bb_upper_v, "bb_mid": bb_mid_v, "bb_lower": bb_lower_v, "bb_bw": bb_bw_v,
            "score_total": score,
            "score_trend": _sub_trend,
            "score_pa": _sub_pa,
            "score_sr": _sub_sr,
            "score_patterns": _sub_patterns,
            "score_regime": _sub_regime,
            "score_smc": _sub_smc,
            "score_mtf": _sub_mtf,
            "score_sentiment": _sub_sentiment,
            "score_bias": _sub_bias,
        },
        "session": {
            "session": session_info.get("session"),
            "overlap": session_info.get("overlap"),
            "minutes_after_session_open": session_info.get("minutes_after_session_open"),
            "hour": session_info.get("hour"),
            "weekday": session_info.get("weekday"),
            "is_weekend": session_info.get("is_weekend"),
        },
        "price_action": {
            "trend":      pa.get("trend"),
            "structure":  pa.get("structure"),
            "bos":        pa.get("bos"),
            "bos_dir":    pa.get("bos_dir"),
            "bos_score":  pa.get("bos_score"),
            "choch":      pa.get("choch"),
            "last_swing_high": pa.get("last_swing_high"),
            "last_swing_low":  pa.get("last_swing_low"),
        },
        "sr_zones": {
            "supports":        sr.get("supports",    [])[:3],
            "resistances":     sr.get("resistances", [])[:3],
            "near_support":    sr.get("near_support"),
            "near_resistance": sr.get("near_resistance"),
        },
        "patterns": pats,
        "detectedPatterns": chart_patterns,
        "prz": chart_patterns[0].get("prz") if chart_patterns else None,
        "fibTargets": chart_patterns[0].get("targets") if chart_patterns else None,
        "confluenceScore": chart_patterns[0].get("confluenceScore") if chart_patterns else None,
        "confluenceTags": chart_patterns[0].get("confluenceTags") if chart_patterns else [],
        "regime":   {
            "regime":         regime.get("regime"),
            "adx":            regime.get("adx"),
            "trend_strength": regime.get("trend_strength"),
            "above_ema200":   regime.get("above_ema200"),
            "description":    regime.get("description"),
        },
        "smc": {
            "fvg": {
                "bullish":         smc["fvg"].get("bullish", [])[:2],
                "bearish":         smc["fvg"].get("bearish", [])[:2],
                "near_bullish_fvg": smc["fvg"].get("near_bullish_fvg"),
                "near_bearish_fvg": smc["fvg"].get("near_bearish_fvg"),
                "total_open":      smc["fvg"].get("total_open", 0),
            },
            "ob": {
                "bullish":       smc["ob"].get("bullish", [])[:2],
                "bearish":       smc["ob"].get("bearish", [])[:2],
                "near_bullish_ob": smc["ob"].get("near_bullish_ob"),
                "near_bearish_ob": smc["ob"].get("near_bearish_ob"),
            },
            "liquidity": {
                "equal_highs": smc["liquidity"].get("equal_highs", [])[:2],
                "equal_lows":  smc["liquidity"].get("equal_lows", [])[:2],
                "near_eqh":   smc["liquidity"].get("near_eqh"),
                "near_eql":   smc["liquidity"].get("near_eql"),
            },
        },
        "synthetic_stats": synthetic_stats if asset_type == "SYNTHETIC" else {},
        "forex_context": forex_context if asset_type == "FOREX" else {},
        "onchain_context": (
            {**(onchain or {}), "flags": advanced_flags}
            if asset_type == "CRYPTO" else {}
        ),
        "tokenomics_context": (
            {"data": tokenomics_context, "flags": tokenomics_flags}
            if asset_type == "CRYPTO" else {}
        ),
        "social_context": social_context if asset_type == "CRYPTO" else {},
        "market_concept_vector": market_concept_vector,
        "market_embedding": market_embedding,
        "feature_vector": feature_vector,
        "mtf_context": {
            "ltf":         timeframe,
            "mtf":         _mtf_tf,
            "htf":         _htf_tf,
            "mtf_regime":  (mtf_regime or {}).get("regime"),
            "htf_regime":  (htf_regime or {}).get("regime"),
            "mtf_adx":     (mtf_regime or {}).get("adx"),
            "htf_adx":     (htf_regime or {}).get("adx"),
            "mtf_aligned": _mtf_aligned,
            "htf_aligned": _htf_aligned,
            "confluence":  (
                "FULL"    if _mtf_aligned and _htf_aligned else
                "PARTIAL" if _mtf_aligned or  _htf_aligned else
                "NONE"    if (_mtf_aligned is False or _htf_aligned is False) else
                "UNKNOWN"
            ),
        },
        "risk": {
            "decision":       risk_assessment.decision.value if risk_assessment else "SKIPPED",
            "size_multiplier": risk_assessment.size_multiplier if risk_assessment else 1.0,
            "risk_pct":        risk_assessment.risk_pct if risk_assessment else 0.0,
            "adjusted_score":  risk_assessment.adjusted_score if risk_assessment else 0.0,
            "reasons":         risk_assessment.reasons if risk_assessment else [],
            "factors":         risk_assessment.factors if risk_assessment else {},
            "kill_switch":     risk_assessment.kill_switch_state if risk_assessment else "",
            "drawdown":        risk_assessment.drawdown_level if risk_assessment else "",
            "crisis_mode":     risk_assessment.crisis_mode if risk_assessment else False,
        } if risk_assessment else None,
        "risk_level": _risk_level,
        "market_cap_tier": _final_mcap_tier,
        "liquidity_score": _final_liquidity,
        "max_position_pct": get_max_position_pct(_risk_level),
        "risk_level_reasons": _risk_reasons,
        "red_flags": _red_flags,
        "moonshot_tp": _compute_moonshot_tp(signal, entry, tp1, tp2, _final_mcap_tier) if signal != "NEUTRAL" else None,
        "dca_tranches": compute_dca_tranches(signal, entry if signal != "NEUTRAL" else None, fear_greed_value) if signal != "NEUTRAL" else None,
        "scale_out": compute_scale_out(signal, entry if signal != "NEUTRAL" else None, fear_greed_value) if signal != "NEUTRAL" else None,
        "quality_score": _quality_gate.get("quality_score", 0),
        "quality_flags": _quality_gate.get("quality_flags", []),
        "quality_size_multiplier": get_quality_size_multiplier(_quality_gate.get("quality_score", 0)) if signal != "NEUTRAL" else 0,
        "correlation_id": corr_id,
    }

    logger.info("analyze_candles.end", correlation_id=corr_id, symbol=symbol, signal=signal, confidence=confidence)
    clear_correlation_id()
    return result




async def fetch_and_analyze(symbol: str, timeframe: str, htf_regime: Optional[dict] = None, strategy: Optional[dict] = None, bias_regimes: Optional[dict[str, dict]] = None) -> dict:
    """Fetch klines et analyse un actif — utilisé par warmup et fallback."""
    # ── Phase J: NYSE session guard for US stocks ──
    _asset_type = get_asset_type(symbol)
    if _asset_type == "US_STOCK":
        from datetime import datetime, timezone as _tz
        _now = datetime.now(_tz.utc)
        _hour_min = _now.hour * 60 + _now.minute
        # NYSE: 14:30–21:00 UTC, Mon–Fri
        if _now.weekday() >= 5 or _hour_min < 870 or _hour_min >= 1260:
            return {
                "symbol": symbol,
                "signal": "NEUTRAL",
                "confidence": 0,
                "reason": "NYSE closed — US stock scanning suspended outside market hours (14:30–21:00 UTC, Mon–Fri)",
                "asset_type": "US_STOCK",
            }

    tf = TF_MAP.get(timeframe, "1h")
    df = await fetch_klines_fallback(
        symbol,
        tf,
        providers=["binance", "deriv", "yfinance", "twelvedata"],
        timeout=10.0,
    )
    if df is None or len(df) < 50:
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}

    # Fetch D1/Weekly bias regimes if not provided
    if bias_regimes is None:
        bias_regimes = {}
        for bias_tf in _BIAS_TF:
            try:
                df_bias = await asyncio.wait_for(fetch_binance_klines(symbol, bias_tf, limit=100), timeout=3.0)
                if df_bias is None:
                    df_bias = await asyncio.wait_for(fetch_yfinance_klines(symbol, bias_tf, limit=100), timeout=5.0)
                if df_bias is not None and len(df_bias) >= 50:
                    bias_regimes[bias_tf] = await asyncio.to_thread(
                        detect_regime, df_bias["high"], df_bias["low"], df_bias["close"]
                    )
            except Exception:
                pass

    # Macro context (economic calendar + DXY) — computed async before sync analysis
    # Phase F: now applies to FOREX, COMMODITY, and CRYPTO (not just FOREX)
    forex_context = None
    news_context = None
    _asset_type_for_news = get_asset_type(symbol)
    if _asset_type_for_news in ("FOREX", "COMMODITY", "CRYPTO"):
        try:
            _suspend, _news_ctx = await asyncio.wait_for(
                should_suspend_signal(symbol, _asset_type_for_news),
                timeout=10.0,
            )
            if _asset_type_for_news == "FOREX":
                forex_context = _news_ctx
            else:
                news_context = _news_ctx
        except asyncio.TimeoutError:
            pass
        except Exception:
            pass

    # Gold specialist: fetch DXY for gold symbols (inverse correlation)
    gold_dxy = None
    if is_gold_symbol(symbol):
        try:
            gold_dxy = await asyncio.wait_for(
                mem_cached("dxy:5d", lambda: get_dxy_momentum(days=5), ttl=300),
                timeout=5.0,
            )
        except Exception:
            gold_dxy = None

    # Tokenomics risk (crypto) — computed async before sync analysis
    tokenomics_context = None
    if get_asset_type(symbol) == "CRYPTO":
        try:
            tokenomics_context = await asyncio.wait_for(
                mem_cached(f"tkn:{symbol}", lambda: fetch_tokenomics(symbol), ttl=600),
                timeout=3.0,
            )
        except Exception as exc:
            logger.debug("tokenomics_context_failed", symbol=symbol, error=str(exc))
            tokenomics_context = None

    # Social sentiment (crypto) — computed async before sync analysis
    social_context = None
    if get_asset_type(symbol) == "CRYPTO":
        try:
            social_context = await asyncio.wait_for(
                mem_cached(f"soc:{symbol}", lambda: fetch_social_metrics(symbol), ttl=600),
                timeout=3.0,
            )
        except Exception as exc:
            logger.debug("social_context_failed", symbol=symbol, error=str(exc))
            social_context = None

    # ── Phase M: X/Twitter sentiment for crypto ──
    x_sentiment_context = None
    if get_asset_type(symbol) == "CRYPTO":
        try:
            from routers.x_sentiment import fetch_x_sentiment
            _base = symbol.split("/")[0]
            x_result = await asyncio.wait_for(
                mem_cached(f"xsent:{_base}", lambda: fetch_x_sentiment(category="crypto", symbol=_base), ttl=600),
                timeout=8.0,
            )
            if x_result and not x_result.get("error"):
                x_sentiment_context = {
                    "overall_label": x_result.get("overall_sentiment", {}).get("overall_label"),
                    "overall_score": x_result.get("overall_sentiment", {}).get("overall_score", 0),
                    "tweet_count": x_result.get("overall_sentiment", {}).get("count", 0),
                    "engagement": x_result.get("engagement", {}),
                    "source": x_result.get("source"),
                }
        except Exception as exc:
            logger.debug("x_sentiment_context_failed", symbol=symbol, error=str(exc))

    # ── Phase 0++: Market cap tier + Liquidity score (async) ──
    _mcap_tier = None
    _liquidity = None
    _onchain_ctx = None
    _asset_type_for_risk = get_asset_type(symbol)
    if _asset_type_for_risk == "CRYPTO":
        try:
            _mcap_tier = await asyncio.wait_for(
                mem_cached(f"mcap:{symbol}", lambda: fetch_market_cap_tier(symbol), ttl=600),
                timeout=5.0,
            )
        except Exception:
            _mcap_tier = get_market_cap_tier_sync(symbol, "CRYPTO")
        try:
            _liquidity = await asyncio.wait_for(
                mem_cached(f"liq:{symbol}", lambda: compute_liquidity_score(symbol, "CRYPTO"), ttl=600),
                timeout=5.0,
            )
        except Exception:
            _liquidity = estimate_liquidity_score_sync(symbol, "CRYPTO", df)

    # ── Phase 0++: Red flags checklist for micro/small cap crypto ──
    _red_flags = None
    if _asset_type_for_risk == "CRYPTO" and _mcap_tier in ("MICRO", "SMALL"):
        try:
            _red_flags = await asyncio.wait_for(
                mem_cached(f"rf:{symbol}", lambda: check_red_flags(symbol, _mcap_tier), ttl=600),
                timeout=8.0,
            )
        except Exception:
            _red_flags = {"red_flags": [], "red_flag_count": 0, "danger": False, "warning": None}

    # ── Phase 0++: Fear & Greed for DCA/scale-out logic ──
    _fg_value = None
    if _asset_type_for_risk == "CRYPTO":
        try:
            _fg = await asyncio.wait_for(
                mem_cached("fg:global", lambda: fear_greed(), ttl=300),
                timeout=3.0,
            )
            _fg_value = _fg.get("value") if isinstance(_fg, dict) else None
        except Exception:
            _fg_value = None

    # ── On-chain context for crypto (funding rate gate) ──
    if _asset_type_for_risk == "CRYPTO":
        try:
            _oc_ctx = await asyncio.wait_for(
                mem_cached(f"oc:{symbol}", lambda: onchain_context(symbol), ttl=600),
                timeout=3.0,
            )
            _onchain_ctx = {"context": _oc_ctx, "fear_greed": _fg_value}
        except Exception:
            _onchain_ctx = None

    # ── Phase L: AI Defense pre-filter for crypto ──
    if get_asset_type(symbol) == "CRYPTO" and df is not None and len(df) >= 2:
        try:
            from ml.ai_defense import run_defense_checks
            _pc24 = float((df["close"].iloc[-1] / df["close"].iloc[-min(len(df), 24)] - 1) * 100) if len(df) >= 24 else 0
            _pc1 = float((df["close"].iloc[-1] / df["close"].iloc[-2] - 1) * 100) if len(df) >= 2 else 0
            _vol24 = float(df["volume"].iloc[-min(len(df), 24):].sum() * df["close"].iloc[-1]) if "volume" in df else 0
            _defense = await asyncio.to_thread(
                run_defense_checks,
                symbol, price_change_24h=_pc24, price_change_1h=_pc1,
                volume_24h=_vol24, liquidity=_liquidity if _liquidity else 0,
            )
            if _defense["recommendation"] == "BLOCK":
                return {
                    "symbol": symbol,
                    "signal": "NEUTRAL",
                    "confidence": 0,
                    "reason": f"AI Defense BLOCK: {_defense['alerts'][0]['message'] if _defense['alerts'] else 'critical risk detected'}",
                    "asset_type": "CRYPTO",
                    "ai_defense": _defense,
                }
        except Exception:
            pass

    loop = asyncio.get_event_loop()
    # Feed price history to CorrelationManager
    try:
        _risk_engine = get_risk_engine()
        if df is not None and len(df) >= 10 and "close" in df:
            _risk_engine.correlation.update_price_history(symbol, df["close"])
    except Exception:
        pass

    result = await loop.run_in_executor(
        _executor,
        lambda: analyze_candles(
            symbol, timeframe, df,
            htf_regime=htf_regime,
            strategy=strategy,
            onchain=_onchain_ctx,
            forex_context=forex_context,
            tokenomics_context=tokenomics_context,
            social_context=social_context,
            bias_regimes=bias_regimes if bias_regimes else None,
            news_context=news_context,
            gold_dxy=gold_dxy,
            market_cap_tier=_mcap_tier,
            liquidity_data=_liquidity,
            red_flags_data=_red_flags,
            fear_greed_value=_fg_value,
        ),
    )

    # ── Phase M: Attach X sentiment to result metadata ──
    if result and isinstance(result, dict) and x_sentiment_context:
        if "metadata" not in result:
            result["metadata"] = {}
        result["metadata"]["x_sentiment"] = x_sentiment_context

    # ── Phase P: On-chain pre-listing signals for crypto ──
    if result and isinstance(result, dict) and get_asset_type(symbol) == "CRYPTO":
        try:
            from routers.onchain_prelisting import analyze_pre_listing_signals
            _base = symbol.split("/")[0]
            _chain = "solana" if "SOL" in _base else "ethereum"
            _onchain = await asyncio.wait_for(
                analyze_pre_listing_signals(_base, chain=_chain),
                timeout=8.0,
            )
            if _onchain and not _onchain.get("error"):
                if "metadata" not in result:
                    result["metadata"] = {}
                result["metadata"]["onchain_signals"] = {
                    "signal_score": _onchain.get("signal_score", 0),
                    "verdict": _onchain.get("verdict"),
                    "whale_accumulation": _onchain.get("signals", {}).get("whale_accumulation"),
                    "liquidity_building": _onchain.get("signals", {}).get("liquidity_building"),
                    "dev_activity": _onchain.get("signals", {}).get("dev_activity"),
                    "holder_growth": _onchain.get("signals", {}).get("holder_growth"),
                }
        except Exception as exc:
            logger.debug("onchain_signals_failed", symbol=symbol, error=str(exc))

    # ── Phase I: Token Grade 0-100 in scan results ──
    if result and isinstance(result, dict) and result.get("signal") in ("BUY", "SELL"):
        try:
            from ml.token_grade import compute_token_grade
            _social_score = 50
            _tokenomics_score = 50
            if social_context:
                _social_score = min(100, (social_context.get("galaxy_score", 50)) + 20)
            if tokenomics_context:
                _tokenomics_score = max(0, 100 - tokenomics_context.get("risk_score", 50))
            _tokenomics_penalty = max(0, _tokenomics_score) if _tokenomics_score else None
            _grade = await asyncio.to_thread(
                compute_token_grade,
                symbol,
                technical_score=result.get("confidence", 50),
                technical_confidence=result.get("confidence", 50),
                onchain_bonus=_onchain.get("context", {}).get("fear_greed") if _onchain else None,
                social_score=_social_score,
                tokenomics_penalty=_tokenomics_penalty,
            )
            result["token_grade"] = _grade
        except Exception:
            pass

    return result













