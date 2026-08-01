"""
Sprint 7 — Macro & données avancées.
Endpoints macro : Fear & Greed, VIX, DXY (Yahoo), BTC dominance.
"""
from fastapi import APIRouter, HTTPException
import httpx
import asyncio
from typing import Optional
import yfinance as yf

from utils.http import retry_async

router = APIRouter()

# Cache mémoire simple (TTL 5 min)
_cache: dict[str, tuple[float, any]] = {}
CACHE_TTL = 300


def _get_cached(key: str):
    import time
    if key in _cache:
        ts, val = _cache[key]
        if time.monotonic() - ts < CACHE_TTL:
            return val
    return None


def _set_cached(key: str, val: any):
    import time
    _cache[key] = (time.monotonic(), val)


async def _fetch_yahoo_ticker(ticker: str) -> Optional[float]:
    """Fetch le dernier prix d'un ticker Yahoo via yfinance (thread)."""
    try:
        loop = asyncio.get_running_loop()
        t = yf.Ticker(ticker)
        hist = await loop.run_in_executor(None, t.history, period="2d", interval="1d")
        if hist.empty:
            return None
        return round(float(hist["Close"].iloc[-1]), 4)
    except Exception:
        return None


@router.get("/fear-greed")
async def fear_greed():
    """Fear & Greed Index from alternative.me"""
    cached = _get_cached("fear_greed")
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.alternative.me/fng/")
                r.raise_for_status()
                return r.json()
        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        entry = data.get("data", [{}])[0]
        result = {
            "value": int(entry.get("value", 50)),
            "label": entry.get("value_classification", "Neutral"),
            "timestamp": entry.get("timestamp"),
        }
        _set_cached("fear_greed", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Fear & Greed unavailable: {e}") from e


@router.get("/vix")
async def vix():
    """VIX (Volatility Index)"""
    cached = _get_cached("vix")
    if cached:
        return cached
    value = await _fetch_yahoo_ticker("^VIX")
    if value is None:
        raise HTTPException(status_code=503, detail="VIX unavailable")
    result = {"ticker": "^VIX", "value": value}
    _set_cached("vix", result)
    return result


@router.get("/dxy")
async def dxy():
    """DXY (US Dollar Index)"""
    cached = _get_cached("dxy")
    if cached:
        return cached
    value = await _fetch_yahoo_ticker("DX-Y.NYB")
    if value is None:
        raise HTTPException(status_code=503, detail="DXY unavailable")
    result = {"ticker": "DX-Y.NYB", "value": value}
    _set_cached("dxy", result)
    return result


@router.get("/btc-dominance")
async def btc_dominance():
    """BTC dominance approximation from CoinGecko"""
    cached = _get_cached("btc_dominance")
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.coingecko.com/api/v3/global")
                r.raise_for_status()
                return r.json()
        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        market_cap_percentage = data.get("data", {}).get("market_cap_percentage", {})
        btc = market_cap_percentage.get("btc", 0)
        result = {"btc_dominance": round(float(btc), 2)}
        _set_cached("btc_dominance", result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"BTC dominance unavailable: {e}") from e


@router.get("/summary")
async def macro_summary():
    """Agrège les indicateurs macro en un seul appel."""
    results = await asyncio.gather(
        fear_greed(),
        vix(),
        dxy(),
        btc_dominance(),
        return_exceptions=True,
    )
    return {
        "fear_greed": results[0] if not isinstance(results[0], Exception) else None,
        "vix": results[1] if not isinstance(results[1], Exception) else None,
        "dxy": results[2] if not isinstance(results[2], Exception) else None,
        "btc_dominance": results[3] if not isinstance(results[3], Exception) else None,
    }
