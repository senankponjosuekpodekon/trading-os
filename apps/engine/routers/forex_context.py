"""
Forex macro context — DXY momentum + economic calendar macro risk.
Used by scan.py for FOREX assets only.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx
import pandas as pd

import config
from scrapers.forex_calendar_scraper import get_macro_context

TWELVE_DATA_API_KEY = config.settings.twelve_data_api_key
DXY_SYMBOL_TD = "DXY"

_dxy_cache: dict = {"df": None, "ts": 0.0}
_DXY_CACHE_TTL = 3600  # 1h


async def fetch_dxy_daily(limit: int = 30) -> Optional[pd.DataFrame]:
    """Fetch DXY daily candles from Twelve Data. Returns DataFrame with close column."""
    if not TWELVE_DATA_API_KEY:
        return None

    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": DXY_SYMBOL_TD,
        "interval": "1day",
        "outputsize": limit,
        "apikey": TWELVE_DATA_API_KEY,
        "format": "JSON",
        "order": "ASC",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        values = data.get("values", [])
        if not values:
            return None
        df = pd.DataFrame(values)
        df["close"] = df["close"].astype(float)
        df["datetime"] = pd.to_datetime(df["datetime"])
        return df
    except Exception:
        return None


def _mock_dxy_df(limit: int = 30) -> pd.DataFrame:
    """Generate a plausible DXY daily series when API is unavailable."""
    import numpy as np
    np.random.seed(42)
    base = 103.0
    returns = np.random.normal(0.0, 0.003, size=limit)
    closes = base * np.exp(np.cumsum(returns))
    dates = pd.date_range(end=datetime.now(timezone.utc).date(), periods=limit, freq="D")
    return pd.DataFrame({"datetime": dates, "close": closes})


def _dxy_momentum(df: pd.DataFrame, days: int = 5) -> dict:
    """Compute 5-day momentum and 20-day trend for DXY."""
    if len(df) < days + 1:
        return {"momentum_5d": 0.0, "trend_20d": 0.0, "current": None}
    current = float(df["close"].iloc[-1])
    past_5 = float(df["close"].iloc[-(days + 1)])
    past_20 = float(df["close"].iloc[-21]) if len(df) >= 21 else float(df["close"].iloc[0])
    momentum = (current - past_5) / past_5
    trend = (current - past_20) / past_20
    return {
        "current": round(current, 4),
        "momentum_5d": round(momentum, 5),
        "trend_20d": round(trend, 5),
    }


async def get_dxy_momentum(days: int = 5) -> dict:
    """Get DXY momentum with caching. Falls back to mock."""
    from time import monotonic
    now = monotonic()
    if _dxy_cache["df"] is None or (now - _dxy_cache["ts"]) > _DXY_CACHE_TTL:
        df = await fetch_dxy_daily(limit=max(30, days + 10))
        source = "live"
        if df is None:
            df = _mock_dxy_df(limit=30)
            source = "mock"
        _dxy_cache["df"] = df
        _dxy_cache["ts"] = now
    else:
        df = _dxy_cache["df"]
        source = "live" if _dxy_cache["ts"] > 0 else "mock"

    momentum = _dxy_momentum(df, days=days)
    momentum["source"] = source
    return momentum


def _apply_dxy_adjustment(symbol: str, score: float, dxy: dict) -> tuple[float, list[str]]:
    """
    Adjust signal score for major USD pairs based on DXY momentum.
    - EUR/USD, GBP/USD, AUD/USD, NZD/USD : stronger DXY → weaker pair
    - USD/JPY, USD/CHF, USD/CAD : stronger DXY → stronger pair
    """
    reasons = []
    momentum = dxy.get("momentum_5d", 0.0)
    threshold = 0.005  # 0.5% over 5 days

    inverse_pairs = {"EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD"}
    direct_pairs = {"USD/JPY", "USD/CHF", "USD/CAD"}

    if abs(momentum) < threshold:
        return score, reasons

    if symbol in inverse_pairs:
        if momentum > 0:
            score -= 10
            reasons.append(f"DXY bullish (+{momentum*100:.1f}% 5j) → {symbol} drag")
        else:
            score += 10
            reasons.append(f"DXY bearish ({momentum*100:.1f}% 5j) → {symbol} lift")
    elif symbol in direct_pairs:
        if momentum > 0:
            score += 10
            reasons.append(f"DXY bullish (+{momentum*100:.1f}% 5j) → {symbol} lift")
        else:
            score -= 10
            reasons.append(f"DXY bearish ({momentum*100:.1f}% 5j) → {symbol} drag")

    return score, reasons


async def get_forex_context(symbol: str, score: float = 0.0) -> dict:
    """
    Full Forex context for a signal:
    - macro_risk / post_news_volatility from economic calendar
    - DXY momentum adjustment
    """
    macro = await get_macro_context()
    dxy = await get_dxy_momentum(days=5)
    adjusted_score, reasons = _apply_dxy_adjustment(symbol, score, dxy)

    return {
        "macro_risk": macro["macro_risk"],
        "post_news_volatility": macro["post_news_volatility"],
        "next_event": macro["next_event"],
        "high_events_48h": macro["high_events_48h"],
        "dxy": dxy,
        "score_adjustment": round(adjusted_score - score, 1),
        "reasons": reasons,
    }


async def should_suspend_forex(symbol: str) -> tuple[bool, dict]:
    """Return True if scan should be suspended due to macro risk."""
    ctx = await get_forex_context(symbol)
    return ctx["macro_risk"], ctx
