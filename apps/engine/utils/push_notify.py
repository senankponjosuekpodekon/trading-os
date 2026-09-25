"""
Engine → API push broadcast — fire-and-forget.

Used by detection modules (hidden gems moonshots, onchain regime changes,
early-alpha strong signals) to notify all push-subscribed users through the
API's internal broadcast endpoint. Fails silently — a notification outage
must never break the data pipeline.
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional

import httpx

import config
from utils.logger import get_logger

logger = get_logger(__name__)

_client: httpx.AsyncClient | None = None


async def engine_broadcast(
    title: str,
    message: str,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    """POST /api/notifications/internal/broadcast — push + notif in-app à tous
    les abonnés. No-op si api_url/engine_api_key non configurés."""
    api_url = config.settings.api_url
    api_key = config.settings.engine_api_key
    if not api_url or not api_key:
        return

    global _client
    try:
        if _client is None or _client.is_closed:
            _client = httpx.AsyncClient(timeout=5.0)
        await _client.post(
            f"{api_url.rstrip('/')}/api/notifications/internal/broadcast",
            json={"title": title, "message": message, "data": data or {}},
            headers={"X-Engine-Key": api_key},
        )
    except Exception as exc:
        logger.debug("engine_broadcast_failed", error=str(exc))


async def broadcast_once(
    dedup_key: str,
    title: str,
    message: str,
    data: Optional[Dict[str, Any]] = None,
    cooldown_seconds: int = 86400,
) -> bool:
    """
    Broadcast dédupliqué via Redis : n'envoie que si dedup_key n'existe pas
    (SET NX EX cooldown). Retourne True si une notification a été envoyée.
    """
    try:
        from utils.cache import cache
        r = await cache.client()
        ok = await r.set(f"push_dedup:{dedup_key}", int(time.time()), nx=True, ex=cooldown_seconds)
        if not ok:
            return False
    except Exception:
        # Redis indisponible → on préfère ne pas spammer plutôt que spammer
        return False
    await engine_broadcast(title, message, data)
    return True
