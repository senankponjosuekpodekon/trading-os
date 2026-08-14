"""
Klines fetchers for Binance, TwelveData, Deriv, and yfinance.

Extracted from scan.py for modularity. All fetch functions share a single
HTTP client and klines cache with per-timeframe TTL.
"""
import asyncio
import time
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

import httpx
import pandas as pd

from utils.rate_limiter import rate_limit
from utils.http import retry_async
from utils.logger import get_logger
from routers.symbol_mappings import (
    SYMBOL_TO_BINANCE, SYMBOL_TO_TWELVEDATA, SYMBOL_TO_YFINANCE, SYMBOL_TO_DERIV,
    TF_TO_TD, TF_TO_DERIV_GRANULARITY, TF_TO_YF, TF_TO_MS,
    TWELVE_DATA_API_KEY,
)

logger = get_logger(__name__)

_executor = ThreadPoolExecutor(max_workers=4)

# ── Shared HTTP client ──
_http_client: Optional[httpx.AsyncClient] = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=20))
    return _http_client

# ── Klines cache ──
_klines_cache: dict = {}
_CACHE_TTL = 60
_CACHE_TTL_TD = 300
_CACHE_TTL_YF = 300

_TF_CACHE_TTL = {
    "1m": 30, "5m": 60, "15m": 120,
    "1h": 300, "4h": 600, "1d": 1800, "1w": 3600,
}

def _get_cache_ttl(interval: str) -> int:
    return _TF_CACHE_TTL.get(interval, _CACHE_TTL)

# ── Twelve Data rate limiting ──
_TD_SEMAPHORE = asyncio.Semaphore(1)
_TD_MIN_DELAY = 1.2
_td_last_call = 0.0


@rate_limit(max_concurrent=4, min_delay=0.5)
async def fetch_twelvedata_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV from Twelve Data API — for Forex, metals, WTI."""
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
        global _td_last_call
        async with _TD_SEMAPHORE:
            elapsed = time.monotonic() - _td_last_call
            if elapsed < _TD_MIN_DELAY:
                await asyncio.sleep(_TD_MIN_DELAY - elapsed)
            client = _get_http_client()
            r = await client.get(url, params=params)
            _td_last_call = time.monotonic()
            r.raise_for_status()
            return r.json()

    try:
        data = await retry_async(
            _do_fetch,
            max_retries=1,
            base_delay=0.5,
            exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
            on_retry=lambda attempt, exc: logger.warning(
                "twelvedata_retry", symbol=symbol, attempt=attempt, error=str(exc)
            ),
            source="twelvedata",
        )
        if "values" not in data:
            return None
        rows = data["values"]
        df = pd.DataFrame(rows)
        df.rename(columns={"datetime": "time"}, inplace=True)
        for col in ["open", "high", "low", "close"]:
            df[col] = df[col].astype(float)
        df["volume"] = df.get("volume", pd.Series([0.0] * len(df))).astype(float)
        df["time"] = pd.to_datetime(df["time"]).map(lambda t: int(t.timestamp()))
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning("twelvedata_fetch_failed", symbol=symbol, interval=interval, error=str(exc))
        return None


@rate_limit(max_concurrent=15, min_delay=0.05)
async def fetch_deriv_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV from Deriv WebSocket — for synthetic indices."""
    import websockets
    import json as _json
    deriv_sym = SYMBOL_TO_DERIV.get(symbol)
    if not deriv_sym:
        return None

    granularity = TF_TO_DERIV_GRANULARITY.get(interval, 3600)
    cache_key   = f"deriv:{deriv_sym}:{granularity}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _get_cache_ttl(interval):
            return df

    ws_url = "wss://ws.binaryws.com/websockets/v3?app_id=1089"
    payload = {
        "ticks_history": deriv_sym,
        "adjust_start_time": 1,
        "count": limit,
        "end": "latest",
        "granularity": granularity,
        "style": "candles",
    }

    try:
        async with websockets.connect(ws_url, ping_interval=None) as ws:
            await ws.send(_json.dumps(payload))
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = _json.loads(raw)

        if "error" in data or "candles" not in data:
            return None

        candles_raw = data["candles"]
        df = pd.DataFrame([
            {
                "time":   c["epoch"],
                "open":   float(c["open"]),
                "high":   float(c["high"]),
                "low":    float(c["low"]),
                "close":  float(c["close"]),
                "volume": float(c["high"]) - float(c["low"]),
            }
            for c in candles_raw
        ])
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning("deriv_klines_error", symbol=symbol, error=str(exc))
        return None


@rate_limit(max_concurrent=8, min_delay=0.1)
async def fetch_yfinance_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV via yfinance — free fallback for Forex, commodities, stocks."""
    import datetime as _dt
    yf_sym = SYMBOL_TO_YFINANCE.get(symbol)
    if not yf_sym:
        return None

    yf_interval = TF_TO_YF.get(interval, "1h")
    cache_key   = f"yf:{yf_sym}:{yf_interval}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL_YF:
            return df

    _interval_seconds = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}
    seconds_per_bar = _interval_seconds.get(yf_interval, 3600)
    needed_seconds = int(seconds_per_bar * limit * 1.5)
    _max_seconds = {
        "1m": 7 * 86400, "5m": 60 * 86400, "15m": 60 * 86400,
        "1h": 730 * 86400, "1d": 5 * 365 * 86400,
    }
    max_sec = _max_seconds.get(yf_interval, 730 * 86400)
    window  = min(needed_seconds, max_sec)
    end_dt   = _dt.datetime.now(_dt.timezone.utc)
    start_dt = end_dt - _dt.timedelta(seconds=window)

    try:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        def _download():
            ticker = yf.Ticker(yf_sym)
            df_raw = ticker.history(
                start=start_dt.strftime("%Y-%m-%d"),
                end=(end_dt + _dt.timedelta(days=1)).strftime("%Y-%m-%d"),
                interval=yf_interval,
                auto_adjust=True,
                actions=False,
            )
            return df_raw
        df_raw = await loop.run_in_executor(_executor, _download)
        if df_raw is None or df_raw.empty:
            return None
        times = df_raw.index.map(lambda t: int(t.timestamp()))
        df = pd.DataFrame({
            "time":   times.values,
            "open":   df_raw["Open"].astype(float).values,
            "high":   df_raw["High"].astype(float).values,
            "low":    df_raw["Low"].astype(float).values,
            "close":  df_raw["Close"].astype(float).values,
            "volume": df_raw["Volume"].astype(float).values,
        })
        if interval == "4h" and yf_interval == "1h":
            df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
            df = df.set_index("time").resample("4h").agg(
                open=("open", "first"), high=("high", "max"),
                low=("low", "min"),   close=("close", "last"),
                volume=("volume", "sum")
            ).dropna().reset_index()
            df["time"] = df["time"].map(lambda t: int(t.timestamp()))
        df = (df.sort_values("time")
                .drop_duplicates(subset=["time"])
                .dropna(subset=["close"])
                .tail(limit)
                .reset_index(drop=True))
        if len(df) < 2:
            return None
        if df["volume"].sum() == 0:
            df["volume"] = (df["high"] - df["low"]).astype(float)
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning("yfinance_error", symbol=symbol, error=str(exc))
        return None


@rate_limit(max_concurrent=10, min_delay=0.05)
async def fetch_binance_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV from Binance REST API."""
    import time as _time
    binance_sym = SYMBOL_TO_BINANCE.get(symbol)
    if not binance_sym:
        return None

    cache_key = f"{binance_sym}:{interval}:{limit}"
    now = _time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _get_cache_ttl(interval):
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
                "binance_retry", symbol=symbol, attempt=attempt,
                error_type=type(exc).__name__, error=repr(exc),
            ),
            source="binance_batch",
        )
        df = pd.DataFrame(data, columns=[
            "time","open","high","low","close","volume",
            "close_time","quote_vol","trades","taker_buy_base","taker_buy_quote","ignore"
        ])
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        candle_ms = TF_TO_MS.get(interval, 3_600_000)
        now_ms = int(_time.time() * 1000)
        if len(df) > 1 and int(df["time"].iloc[-1]) + candle_ms > now_ms:
            df = df.iloc[:-1].reset_index(drop=True)
        _klines_cache[cache_key] = (_time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning(
            "binance_klines_failed", symbol=symbol, interval=interval,
            error_type=type(exc).__name__, error=repr(exc),
        )
        return None
