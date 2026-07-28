"""
Forex Factory economic calendar scraper.
Source : Forex Factory public JSON feed (fair economy media proxy).
Cache en mémoire avec TTL raisonnable (1h) pour éviter les appels répétés.
"""
import httpx
from datetime import datetime, timezone, timedelta
from typing import List, Optional
import time

FOREX_FACTORY_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

_cache: dict = {"events": None, "ts": 0.0}
_CACHE_TTL_SECONDS = 3600  # 1h


def _parse_iso(date_str: str) -> Optional[datetime]:
    """Parse Forex Factory ISO date with timezone offset."""
    try:
        # date format: 2026-07-12T18:30:00-04:00
        return datetime.fromisoformat(date_str)
    except Exception:
        return None


async def fetch_forex_factory_calendar() -> List[dict]:
    """Fetch this week's economic calendar events from Forex Factory."""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(FOREX_FACTORY_FEED)
            r.raise_for_status()
            data = r.json()
    except Exception:
        return []

    if not isinstance(data, list):
        return []

    events = []
    for item in data:
        dt = _parse_iso(item.get("date", ""))
        events.append({
            "title": item.get("title", ""),
            "country": item.get("country", ""),
            "impact": item.get("impact", "Low"),
            "forecast": item.get("forecast", ""),
            "previous": item.get("previous", ""),
            "actual": item.get("actual", ""),
            "datetime": dt,
            "timestamp": dt.timestamp() if dt else None,
        })
    return events


async def get_cached_calendar() -> List[dict]:
    """Return cached calendar or refresh if stale."""
    now = time.monotonic()
    if _cache["events"] is None or (now - _cache["ts"]) > _CACHE_TTL_SECONDS:
        events = await fetch_forex_factory_calendar()
        _cache["events"] = events
        _cache["ts"] = now
    return _cache["events"] or []


def invalidate_cache() -> None:
    _cache["events"] = None
    _cache["ts"] = 0.0


def _high_impact_events(events: List[dict], now: datetime) -> List[dict]:
    """Filter to HIGH impact events around the current time (±48h)."""
    out = []
    window = timedelta(hours=48)
    for e in events:
        dt = e.get("datetime")
        if not dt or e.get("impact") != "High":
            continue
        if now - window <= dt <= now + window:
            out.append(e)
    return out


async def get_macro_context(now: Optional[datetime] = None) -> dict:
    """
    Macro context for Forex trading.
    - macro_risk: HIGH event within next 2h → avoid new signals
    - post_news_volatility: HIGH event within last 30m → volatility spike likely
    - next_event: next HIGH event in the next 48h
    """
    now = now or datetime.now(timezone.utc)
    events = await get_cached_calendar()
    high_events = _high_impact_events(events, now)

    macro_risk = False
    post_news = False
    next_event = None
    next_delta = None

    for e in high_events:
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
        "high_events_48h": len(high_events),
    }


# Re-export the parser for other modules
parse_iso = _parse_iso
