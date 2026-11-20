"""Risque événementiel — calendrier économique haute importance.

Le système est ~85% technique : les patterns génèrent, le fondamental
filtre. Ici : un événement High impact (NFP, CPI, FOMC…) dans la
fenêtre [-1h, +2h] dégrade la prise de risque — les stops serrés meurent
dans le spike initial quelle que soit la qualité du setup.

  event_risk() → {"level": "high"|"none", "events": [...]}
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from utils.cache import cache
from utils.http import retry_async
from utils.logger import get_logger

logger = get_logger(__name__)

CAL_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
CACHE_KEY = "event:calendar"
CACHE_TTL = 1800  # 30 min — le feed bouge peu
WINDOW_BEFORE_S = 2 * 3600   # blocage jusqu'à 2h AVANT l'event
WINDOW_AFTER_S = 1 * 3600    # et 1h après (spike + digestion)


async def _fetch_calendar() -> Optional[list]:
    cached = await cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(CAL_URL)
                r.raise_for_status()
                return r.json()
        data = await retry_async(_do, max_retries=1, base_delay=0.5,
                                 source="faireconomy")
        events = data if isinstance(data, list) else []
        await cache.set(CACHE_KEY, events, ttl=CACHE_TTL)
        return events
    except Exception as e:
        logger.warning("event_calendar_fetch_failed", error=str(e))
        return None


def _parse_ts(ev: Dict[str, Any]) -> Optional[float]:
    try:
        return datetime.fromisoformat(
            str(ev.get("date", "")).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def assess_event_risk(events: list, now_ts: float) -> Dict[str, Any]:
    """Règle pure — testable. High impact seulement (Medium ne déplace
    pas assez pour mériter un gate)."""
    hits = []
    for ev in events or []:
        if ev.get("impact") != "High":
            continue
        ts = _parse_ts(ev)
        if ts is None:
            continue
        delta = ts - now_ts
        if -WINDOW_AFTER_S <= delta <= WINDOW_BEFORE_S:
            hits.append({
                "title": ev.get("title", "?"),
                "currency": ev.get("country", "?"),
                "delta_min": round(delta / 60),
            })
    if hits:
        return {"level": "high", "events": hits}
    return {"level": "none", "events": []}


async def event_risk() -> Dict[str, Any]:
    """fail-open : calendrier indisponible → pas de gate (jamais bloquant)."""
    try:
        events = await _fetch_calendar()
        if events is None:
            return {"level": "none", "events": [], "note": "calendar_unavailable"}
        return assess_event_risk(events, datetime.now(timezone.utc).timestamp())
    except Exception as e:
        logger.debug("event_risk_fallback", error=str(e))
        return {"level": "none", "events": [], "note": "error"}


# Pénalité appliquée au risque neuf quand level == "high"
EVENT_RISK_MULT = 0.5
# Malus sur la confiance du signal (même logique que le bonus macro)
EVENT_CONF_MALUS = -15
