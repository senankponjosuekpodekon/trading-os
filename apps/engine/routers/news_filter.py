"""
News Filter — Phase F

Extends the economic calendar news filter beyond FOREX to also cover
COMMODITIES and CRYPTO. High-impact macro events (FOMC, CPI, NFP, etc.)
affect all asset classes. Specific events like Crude Oil Inventories
affect commodities, and SEC/crypto regulation news affects crypto.

This module maps economic events to affected asset types and provides
a unified `should_suspend_signal` function used by scan.py.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
import structlog

from scrapers.forex_calendar_scraper import get_macro_context, get_cached_calendar

log = structlog.get_logger()


# Events that affect ALL asset classes (macro-level)
MACRO_EVENTS_ALL = {
    "fomc", "fed chair", "federal reserve", "interest rate",
    "nonfarm", "non-farm", "nfp", "cpi", "ppi", "gdp",
    "geopolitical", "war", "pandemic", "recession",
    "ecb", "boe", "boj", "rba", "rbnz", "boc", "snb",
    " fomc minutes", "fed minutes", "monetary policy",
}

# Events specific to commodities (gold, oil, silver)
COMMODITY_EVENTS = {
    "crude oil", "oil inventories", "opec", "gold",
    "silver", "copper", "natural gas", "eia",
    "commodities", "metals", "mining",
}

# Events specific to crypto
CRYPTO_EVENTS = {
    "bitcoin", "ethereum", "crypto", "sec", "etf approval",
    "binance", "coinbase", "digital asset", "stablecoin",
    "cryptocurrency regulation", "cbdc",
}


def _event_matches_asset_type(title: str, asset_type: str) -> bool:
    """Check if an event title is relevant to the given asset type."""
    title_lower = title.lower()

    # Macro events affect everything
    for keyword in MACRO_EVENTS_ALL:
        if keyword in title_lower:
            return True

    if asset_type == "COMMODITY":
        for keyword in COMMODITY_EVENTS:
            if keyword in title_lower:
                return True
    elif asset_type == "CRYPTO":
        for keyword in CRYPTO_EVENTS:
            if keyword in title_lower:
                return True
    elif asset_type == "FOREX":
        return True  # All forex factory events are forex-relevant

    return False


async def get_asset_macro_risk(symbol: str, asset_type: str) -> dict:
    """
    Get macro risk context for any asset type, not just forex.
    Returns:
    - macro_risk: HIGH event within next 2h that affects this asset type
    - post_news_volatility: HIGH event within last 30m affecting this asset
    - next_event: next relevant HIGH event
    - high_events_48h: count of relevant high-impact events in 48h window
    """
    now = datetime.now(timezone.utc)
    events = await get_cached_calendar()

    # Filter to HIGH impact events relevant to this asset type
    relevant_events = []
    for e in events:
        if e.get("impact") != "High":
            continue
        dt = e.get("datetime")
        if not dt:
            continue
        # Check if within 48h window
        delta = (dt - now).total_seconds()
        if abs(delta) > 48 * 3600:
            continue
        # Check if event is relevant to this asset type
        if _event_matches_asset_type(e.get("title", ""), asset_type):
            relevant_events.append(e)

    macro_risk = False
    post_news = False
    next_event = None
    next_delta = None

    for e in relevant_events:
        dt = e["datetime"]
        delta = (dt - now).total_seconds()
        if 0 <= delta <= 7200:  # next 2 hours
            macro_risk = True
        if -1800 <= delta <= 0:  # past 30 minutes
            post_news = True
        if delta > 0 and (next_delta is None or delta < next_delta):
            next_delta = delta
            next_event = e

    return {
        "macro_risk": macro_risk,
        "post_news_volatility": post_news,
        "next_event": next_event,
        "high_events_48h": len(relevant_events),
        "asset_type": asset_type,
    }


async def should_suspend_signal(symbol: str, asset_type: str) -> tuple[bool, dict]:
    """
    Unified news filter for all asset types.
    Returns (should_suspend, context_dict).
    """
    # FOREX uses the existing forex_context for backward compatibility
    if asset_type == "FOREX":
        from routers.forex_context import get_forex_context
        ctx = await get_forex_context(symbol)
        return ctx["macro_risk"], ctx

    # COMMODITY and CRYPTO use the new asset-specific filter
    ctx = await get_asset_macro_risk(symbol, asset_type)
    return ctx["macro_risk"], ctx
