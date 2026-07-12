from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import httpx
import asyncio
import time
import os
import pandas as pd
import numpy as np
import pandas_ta as ta
from concurrent.futures import ThreadPoolExecutor

from routers.price_action import detect_market_structure, price_action_bonus
from routers.sr_zones import get_sr_zones, sr_bonus
from routers.patterns import scan_last_patterns, patterns_bonus
from routers.regime import detect_regime, regime_bonus, regime_filter
from routers.smc import analyze_smc, smc_bonus
from routers import ws as ws_module
from routers.news import get_news_sentiment, NewsRequest
from routers.news_scraper import scrape_all_sources, aggregate_sentiment
from routers.brvm import is_brvm_symbol, analyze_brvm_symbols
import config
from utils.cache import get_cached, set_cached
from utils.logger import get_logger
from utils.http import retry_async

logger = get_logger(__name__)
_executor = ThreadPoolExecutor(max_workers=4)

# Actifs précalculés en background
ACTIVE_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "AVAX/USDT",
    "ADA/USDT", "XRP/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT",
    "EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "WTI/USD",
]
WARMUP_TIMEFRAMES = ["1h", "4h"]
WARMUP_INTERVAL_SECONDS = 30
WARMUP_TTL_SECONDS = 45

router = APIRouter()

SYMBOL_TO_BINANCE = {
    "BTC/USDT":   "BTCUSDT",
    "ETH/USDT":   "ETHUSDT",
    "SOL/USDT":   "SOLUSDT",
    "BNB/USDT":   "BNBUSDT",
    "AVAX/USDT":  "AVAXUSDT",
    "ADA/USDT":   "ADAUSDT",
    "DOT/USDT":   "DOTUSDT",
    "LINK/USDT":  "LINKUSDT",
    "MATIC/USDT": "MATICUSDT",
    "ATOM/USDT":  "ATOMUSDT",
    "LTC/USDT":   "LTCUSDT",
    "XRP/USDT":   "XRPUSDT",
    "EUR/USDT":   "EURUSDT",
    "GBP/USDT":   "GBPUSDT",
    "PAXG/USDT":  "PAXGUSDT",
}

# Symboles disponibles via Twelve Data (Forex réel, métaux, énergie)
# Clé gratuite: https://twelvedata.com  →  TWELVE_DATA_API_KEY dans .env
SYMBOL_TO_TWELVEDATA = {
    "EUR/USD": "EUR/USD",
    "GBP/USD": "GBP/USD",
    "USD/JPY": "USD/JPY",
    "AUD/USD": "AUD/USD",
    "USD/CHF": "USD/CHF",
    "USD/CAD": "USD/CAD",
    "XAU/USD": "XAU/USD",
    "XAG/USD": "XAG/USD",
}

TWELVE_DATA_API_KEY = config.settings.twelve_data_api_key

# Conversion timeframe interne → Twelve Data
TF_TO_TD: dict = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1h": "1h",   "4h": "4h",   "1d": "1day",
}

TF_MAP = {"1m":"1m","5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}


class ScanRequest(BaseModel):
    symbols: List[str]
    timeframe: str = "1h"


def ema(s: pd.Series, p: int) -> pd.Series:
    return ta.ema(s, length=p)

def rsi(s: pd.Series, p: int = 14) -> pd.Series:
    return ta.rsi(s, length=p)

def atr(h: pd.Series, lo: pd.Series, c: pd.Series, p: int = 14) -> pd.Series:
    return ta.atr(h, lo, c, length=p)

def macd(s: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    out = ta.macd(s, fast=fast, slow=slow, signal=signal)
    # pandas-ta order: MACD line, histogram, signal line
    return out.iloc[:, 0], out.iloc[:, 2], out.iloc[:, 1]

def bollinger(s: pd.Series, p: int = 20, k: float = 2.0):
    out = ta.bbands(s, length=p, std=k)
    # pandas-ta order: lower, mid, upper, bandwidth, %B
    return out.iloc[:, 2], out.iloc[:, 1], out.iloc[:, 0], out.iloc[:, 3]


_http_client: Optional[httpx.AsyncClient] = None
_klines_cache: dict = {}  # key -> (timestamp, df)
_CACHE_TTL = 60  # secondes
_CACHE_TTL_TD = 300  # Twelve Data: 5min (limite 800 req/jour sur plan gratuit)
_TD_SEMAPHORE = asyncio.Semaphore(1)  # Twelve Data : un appel à la fois pour éviter le 429


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=20))
    return _http_client


async def fetch_twelvedata_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV depuis Twelve Data API — pour Forex, métaux, WTI."""
    if not TWELVE_DATA_API_KEY:
        return None
    td_sym = SYMBOL_TO_TWELVEDATA.get(symbol)
    if not td_sym:
        return None
    td_interval = TF_TO_TD.get(interval, "1h")

    cache_key = f"td:{td_sym}:{td_interval}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL_TD:
            return df

    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol":    td_sym,
        "interval":  td_interval,
        "outputsize": limit,
        "apikey":    TWELVE_DATA_API_KEY,
        "format":    "JSON",
        "order":     "ASC",
    }

    async def _do_fetch():
        async with _TD_SEMAPHORE:
            client = _get_http_client()
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()

    try:
        data = await retry_async(
            _do_fetch,
            max_retries=2,
            base_delay=1.0,
            exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
            on_retry=lambda attempt, exc: logger.warning(
                "twelvedata_retry", symbol=symbol, attempt=attempt, error=str(exc)
            ),
        )
        if "values" not in data:
            return None
        rows = data["values"]
        df = pd.DataFrame(rows)
        df.rename(columns={"datetime": "time"}, inplace=True)
        for col in ["open", "high", "low", "close"]:
            df[col] = df[col].astype(float)
        df["volume"] = df.get("volume", pd.Series([0.0] * len(df))).astype(float)
        df["time"] = pd.to_datetime(df["time"]).astype(int) // 10**9
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception:
        return None


async def fetch_binance_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    import time as _time
    binance_sym = SYMBOL_TO_BINANCE.get(symbol)
    if not binance_sym:
        return None

    cache_key = f"{binance_sym}:{interval}:{limit}"
    now = _time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL:
            return df

    url = f"https://api.binance.com/api/v3/klines?symbol={binance_sym}&interval={interval}&limit={limit}"

    async def _do_fetch():
        client = _get_http_client()
        r = await client.get(url)
        r.raise_for_status()
        return r.json()

    try:
        data = await retry_async(
            _do_fetch,
            max_retries=3,
            base_delay=0.5,
            exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
            on_retry=lambda attempt, exc: logger.warning(
                "binance_retry", symbol=symbol, attempt=attempt, error=str(exc)
            ),
        )
        df = pd.DataFrame(data, columns=[
            "time","open","high","low","close","volume",
            "close_time","quote_vol","trades","taker_buy_base","taker_buy_quote","ignore"
        ])
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        _klines_cache[cache_key] = (_time.monotonic(), df)
        return df
    except Exception:
        return None


def analyze_candles(symbol: str, timeframe: str, df: pd.DataFrame) -> dict:
    if len(df) < 50:
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "not enough data"}

    close    = df["close"]
    high     = df["high"]
    low      = df["low"]
    open_col = df["open"]
    last     = len(df) - 1

    e20  = ema(close, 20)
    e50  = ema(close, 50)
    e200 = ema(close, 200) if len(df) >= 200 else None
    r14  = rsi(close, 14)
    a14  = atr(high, low, close, 14)
    vs   = close.rolling(20).mean()
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

    # EMA alignment
    if e20_v and e50_v and e200_v:
        if e20_v > e50_v > e200_v and c_val > e200_v:
            score += 40
            reasons.append("EMA bullish alignment + above 200")
        elif e20_v < e50_v < e200_v and c_val < e200_v:
            score -= 40
            reasons.append("EMA bearish alignment + below 200")
        elif e20_v > e50_v:
            score += 20
            reasons.append("EMA20 > EMA50 bullish")
        elif e20_v < e50_v:
            score -= 20
            reasons.append("EMA20 < EMA50 bearish")

    # RSI
    if rsi_v:
        if 50 <= rsi_v <= 65:
            score += 20
            reasons.append(f"RSI bullish zone ({rsi_v:.1f})")
        elif 35 <= rsi_v <= 50:
            score -= 20
            reasons.append(f"RSI bearish zone ({rsi_v:.1f})")
        elif rsi_v > 70:
            score -= 10
            reasons.append(f"RSI overbought ({rsi_v:.1f})")
        elif rsi_v < 30:
            score += 10
            reasons.append(f"RSI oversold ({rsi_v:.1f})")

    # Volume
    if vol_r and vol_r > 1.3:
        score += 10 if score > 0 else -10
        reasons.append(f"Volume spike x{vol_r:.1f}")

    # ATR (volatility check)
    if atr_v and c_val > 0:
        atr_pct = (atr_v / c_val) * 100
        if atr_pct > 0.3:
            reasons.append(f"ATR OK ({atr_pct:.2f}%)")

    # ── MACD (J20) ──
    if macd_v is not None and macd_sig_v is not None and macd_hist_v is not None:
        # Crossover bullish : MACD vient de passer au-dessus du signal
        if macd_hist_v > 0 and macd_prev_hist is not None and macd_prev_hist <= 0:
            score += 20
            reasons.append(f"MACD bullish crossover ({macd_v:.4f})")
        # Crossover bearish
        elif macd_hist_v < 0 and macd_prev_hist is not None and macd_prev_hist >= 0:
            score -= 20
            reasons.append(f"MACD bearish crossover ({macd_v:.4f})")
        # Histogram momentum
        elif macd_hist_v > 0 and macd_v > 0:
            score += 10
            reasons.append(f"MACD bullish momentum")
        elif macd_hist_v < 0 and macd_v < 0:
            score -= 10
            reasons.append(f"MACD bearish momentum")

    # ── Bollinger Bands (J20) ──
    if bb_upper_v and bb_lower_v and bb_mid_v:
        bb_pos = (c_val - bb_lower_v) / (bb_upper_v - bb_lower_v) if (bb_upper_v - bb_lower_v) > 0 else 0.5
        if c_val <= bb_lower_v * 1.005:
            score += 15
            reasons.append(f"Price at BB lower — mean reversion setup")
        elif c_val >= bb_upper_v * 0.995:
            score -= 15
            reasons.append(f"Price at BB upper — potential reversal")
        elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
            score += 8
            reasons.append(f"BB upper half + MACD momentum")
        elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
            score -= 8
            reasons.append(f"BB lower half + MACD momentum")
        if bb_bw_v and bb_bw_v < 0.02:
            reasons.append(f"BB squeeze (bw={bb_bw_v:.3f}) — breakout imminent")

    # ── Price Action Phase 1 : Structure ──
    pa = detect_market_structure(high, low, close)
    temp_signal = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
    if temp_signal != "NEUTRAL":
        pa_bonus, pa_reasons = price_action_bonus(pa, temp_signal)
        score += pa_bonus
        reasons += pa_reasons

    # ── Phase 2 : S&R Clustering ──
    sr = get_sr_zones(high, low, close)
    if temp_signal != "NEUTRAL":
        b, r = sr_bonus(sr, temp_signal)
        score += b
        reasons += r

    # ── Phase 2 : Candlestick Patterns ──
    pats = scan_last_patterns(open_col, high, low, close)
    if temp_signal != "NEUTRAL":
        b, r = patterns_bonus(pats, temp_signal)
        score += b
        reasons += r

    # ── Jour 10 : Régime de marché ──
    regime = detect_regime(high, low, close)
    temp_signal2 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal2 != "NEUTRAL":
        b, r = regime_bonus(regime, temp_signal2)
        score += b
        reasons += r

    # ── Phase 3 : SMC (FVG + Order Blocks + Liquidité) ──
    smc = analyze_smc(open_col, high, low, close)
    temp_signal3 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal3 != "NEUTRAL":
        b, r = smc_bonus(smc["fvg"], smc["ob"], smc["liquidity"], temp_signal3)
        score += b
        reasons += r

    confidence = min(abs(score), 95)
    if score >= 40:
        signal = "BUY"
    elif score <= -40:
        signal = "SELL"
    else:
        signal = "NEUTRAL"
        confidence = 0

    # Price levels
    entry = round(c_val, 6)
    sl = round(c_val - atr_v * 1.5, 6) if atr_v and signal == "BUY" else (
         round(c_val + atr_v * 1.5, 6) if atr_v and signal == "SELL" else None)
    tp1 = round(c_val + atr_v * 2, 6) if atr_v and signal == "BUY" else (
          round(c_val - atr_v * 2, 6) if atr_v and signal == "SELL" else None)
    tp2 = round(c_val + atr_v * 3.5, 6) if atr_v and signal == "BUY" else (
          round(c_val - atr_v * 3.5, 6) if atr_v and signal == "SELL" else None)
    rr  = round(abs(tp1 - entry) / abs(entry - sl), 2) if sl and tp1 and abs(entry - sl) > 0 else None

    return {
        "symbol":       symbol,
        "timeframe":    timeframe,
        "signal":       signal,
        "confidence":   confidence,
        "entry_price":  entry,
        "stop_loss":    sl,
        "take_profit_1": tp1,
        "take_profit_2": tp2,
        "risk_reward":  rr,
        "explanation":  " | ".join(reasons) or "No clear setup",
        "indicators": {
            "close": entry, "ema20": e20_v, "ema50": e50_v, "ema200": e200_v,
            "rsi": rsi_v, "atr": atr_v, "volume_ratio": vol_r,
            "macd": macd_v, "macd_signal": macd_sig_v, "macd_hist": macd_hist_v,
            "bb_upper": bb_upper_v, "bb_mid": bb_mid_v, "bb_lower": bb_lower_v, "bb_bw": bb_bw_v,
        },
        "price_action": {
            "trend":      pa.get("trend"),
            "structure":  pa.get("structure"),
            "bos":        pa.get("bos"),
            "bos_dir":    pa.get("bos_dir"),
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
    }


async def fetch_and_analyze(symbol: str, timeframe: str) -> dict:
    """Fetch klines et analyse un actif — utilisé par warmup et fallback."""
    tf = TF_MAP.get(timeframe, "1h")
    df = await fetch_binance_klines(symbol, tf)
    if df is None:
        df = await fetch_twelvedata_klines(symbol, tf)
    if df is None or len(df) < 50:
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, analyze_candles, symbol, timeframe, df)


async def warmup_features():
    """Tâche de fond : précalcule les features scan pour les actifs actifs."""
    while True:
        for timeframe in WARMUP_TIMEFRAMES:
            tasks = [fetch_and_analyze(sym, timeframe) for sym in ACTIVE_SYMBOLS]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for sym, res in zip(ACTIVE_SYMBOLS, results):
                if isinstance(res, Exception):
                    logger.warning("warmup_failed", symbol=sym, timeframe=timeframe, error=str(res))
                    continue
                await set_cached(f"scan:{sym}:{timeframe}", res, ttl=WARMUP_TTL_SECONDS)
            logger.info("warmup_done", timeframe=timeframe, symbols=len(ACTIVE_SYMBOLS))
        await asyncio.sleep(WARMUP_INTERVAL_SECONDS)


@router.post("/multi")
async def scan_multi(req: ScanRequest):
    t0  = time.monotonic()
    tf  = TF_MAP.get(req.timeframe, "1h")
    loop = asyncio.get_event_loop()

    # 0. Séparer BRVM des autres marchés
    brvm_symbols = [s for s in req.symbols if is_brvm_symbol(s)]
    other_symbols = [s for s in req.symbols if s not in brvm_symbols]

    # 0b. Cache lookup rapide pour les actifs non-BRVM
    cached_results = []
    missing_symbols = []
    for sym in other_symbols:
        cached = await get_cached(f"scan:{sym}:{req.timeframe}")
        if cached:
            cached_results.append({**cached, "cached": True})
        else:
            missing_symbols.append(sym)

    async def _fetch(sym: str) -> Optional[pd.DataFrame]:
        # Essai Binance en premier
        df = await fetch_binance_klines(sym, tf)
        if df is not None:
            return df
        # Fallback Twelve Data pour Forex/métaux
        return await fetch_twelvedata_klines(sym, tf)

    # 1. Fetch toutes les klines en parallèle (I/O) — Binance + Twelve Data fallback
    dfs = await asyncio.gather(*[_fetch(sym) for sym in missing_symbols])

    async def _no_data(s: str):
        return {"symbol": s, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}

    # 2. Analyse CPU dans un thread pool pour ne pas bloquer l'event loop
    analyze_tasks = []
    for sym, df in zip(missing_symbols, dfs):
        if df is None or len(df) < 50:
            analyze_tasks.append(_no_data(sym))
        else:
            analyze_tasks.append(
                loop.run_in_executor(_executor, analyze_candles, sym, req.timeframe, df)
            )

    computed_results = list(await asyncio.gather(*analyze_tasks))
    for r in computed_results:
        await set_cached(f"scan:{r['symbol']}:{req.timeframe}", r, ttl=WARMUP_TTL_SECONDS)

    brvm_results = []
    if brvm_symbols:
        brvm_results = await analyze_brvm_symbols(brvm_symbols)

    results = cached_results + computed_results + brvm_results

    # 3. Enrichissement sentiment news (en parallèle, non bloquant si NEWS_API_KEY absent)
    if config.settings.news_api_key:
        sentiment_tasks = [
            get_news_sentiment(NewsRequest(symbol=r["symbol"], limit=5, analyze=True))
            for r in results if r.get("signal") in ("BUY", "SELL")
        ]
        if sentiment_tasks:
            sentiments = await asyncio.gather(*sentiment_tasks, return_exceptions=True)
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

                    r["confidence"]     = max(0, min(100, r.get("confidence", 0) + bonus))
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
    # Fonctionne sans aucune clé API — toujours actif
    scraper_tasks = [
        scrape_all_sources(r["symbol"])
        for r in results if r.get("signal") in ("BUY", "SELL")
    ]
    if scraper_tasks:
        scraper_results = await asyncio.gather(*scraper_tasks, return_exceptions=True)
        active_signals = [r for r in results if r.get("signal") in ("BUY", "SELL")]
        for r, scraped in zip(active_signals, scraper_results):
            if isinstance(scraped, Exception) or not scraped:
                continue
            agg = aggregate_sentiment(scraped)
            bonus = agg["bonus"]
            if r.get("signal") == "BUY" and agg["label"] == "bearish":
                bonus = -abs(bonus)
            elif r.get("signal") == "SELL" and agg["label"] == "bullish":
                bonus = -abs(bonus)
            r["confidence"] = max(0, min(100, r.get("confidence", 0) + bonus))
            r["scraper_sentiment"] = {
                "label":   agg["label"],
                "score":   agg["score"],
                "bonus":   bonus,
                "bullish": agg["bullish"],
                "bearish": agg["bearish"],
                "sources": list({a.source for a in scraped[:5]}),
            }

    ws_module.set_latest_signals(results)

    return {
        "scanned":   len(results),
        "timeframe": req.timeframe,
        "elapsed_ms": round((time.monotonic() - t0) * 1000),
        "results":   results,
    }

