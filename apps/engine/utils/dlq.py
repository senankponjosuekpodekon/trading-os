"""Dead-letter queue minimale — Redis list `dlq:tasks`.

Toute tâche background qui échoue (batch insert, ingest signal, market memory…)
est poussée ici avec payload + erreur + compteur de tentatives, au lieu de
disparaître silencieusement. Un flusher périodique peut la rejouer ou alerter.

Usage:
    await dlq_push("scan_batch", rows, error=str(e))
"""
from __future__ import annotations

import json
import time
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)

DLQ_KEY = "dlq:tasks"
DLQ_MAX = 1000  # cap anti-flood


async def dlq_push(task: str, payload: Any, error: str = "", attempts: int = 0) -> None:
    """Push a failed task payload onto the DLQ list (best-effort, never raises)."""
    try:
        from utils.cache import cache
        r = await cache.client()
        entry = {
            "task": task,
            "payload": payload,
            "error": error[:500],
            "attempts": attempts,
            "queued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        await r.rpush(DLQ_KEY, json.dumps(entry, default=str))
        await r.ltrim(DLQ_KEY, -DLQ_MAX, -1)
        logger.warning("dlq_pushed", task=task, error=error[:200], attempts=attempts)
    except Exception as e:
        logger.error("dlq_push_failed", task=task, error=str(e))


async def dlq_depth() -> int:
    try:
        from utils.cache import cache
        r = await cache.client()
        return int(await r.llen(DLQ_KEY))
    except Exception:
        return -1
