"""
Scan history persistence — Redis real-time + DB batch insertion.

Extracted from scan.py for modularity. Handles:
- Redis push for real-time frontend access (TTL 1h)
- Batch DB insertion every 5 min (scan_history table)
- Auto-ingest high-confidence signals to API
"""
import asyncio
import json
import time

import httpx

import config
from utils.cache import cache
from utils.logger import get_logger

logger = get_logger(__name__)

SCAN_HISTORY_REDIS_TTL = 3600

_scan_db_pool = None
_scan_db_lock = asyncio.Lock()
_scan_batch: list[dict] = []
_scan_batch_lock = asyncio.Lock()


async def _get_scan_pool():
    global _scan_db_pool
    if _scan_db_pool is None:
        async with _scan_db_lock:
            if _scan_db_pool is None:
                import asyncpg
                url = config.settings.database_url.replace(
                    "postgresql+asyncpg://", "postgresql://"
                ).replace("postgres://", "postgresql://")
                _scan_db_pool = await asyncpg.create_pool(url, min_size=1, max_size=3)
    return _scan_db_pool


async def _persist_scan_redis(result: dict, timeframe: str) -> None:
    """Push scan result to Redis list for real-time frontend access (TTL 1h)."""
    try:
        entry = {
            "strategy_id": result.get("strategy_id"),
            "strategy_name": result.get("strategy_name") or "Default",
            "symbol": result.get("symbol"),
            "timeframe": timeframe,
            "signal": result.get("signal", "NEUTRAL"),
            "confidence": result.get("confidence", 0),
            "explanation": result.get("explanation", ""),
            "signal_pending": result.get("signal_pending", False),
            "persistence_score": result.get("persistence_score", 0),
            "asset_type": result.get("asset_type"),
            "quality_score": result.get("quality_score", 0),
            "quality_flags": result.get("quality_flags", []),
            "quality_size_multiplier": result.get("quality_size_multiplier", 0),
            "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        key = "scan_history:recent"
        r = await cache.client()
        await r.lpush(key, json.dumps(entry, default=str))
        await r.ltrim(key, 0, 499)  # keep last 500 entries
        await r.expire(key, SCAN_HISTORY_REDIS_TTL)
    except Exception:
        pass


async def _queue_scan_for_batch(result: dict, timeframe: str) -> None:
    """Queue scan result for batch DB insertion (every 5 min)."""
    entry = {
        "strategy_id": result.get("strategy_id"),
        "strategy_name": result.get("strategy_name") or "Default",
        "symbol": result.get("symbol"),
        "timeframe": timeframe,
        "signal": result.get("signal", "NEUTRAL"),
        "confidence": int(result.get("confidence", 0)),
        "explanation": result.get("explanation", "")[:2000],
        "signal_pending": bool(result.get("signal_pending", False)),
        "persistence_score": float(result.get("persistence_score", 0)),
        "asset_type": result.get("asset_type"),
        "quality_score": int(result.get("quality_score", 0)),
        "quality_size_multiplier": float(result.get("quality_size_multiplier", 0)),
    }
    async with _scan_batch_lock:
        _scan_batch.append(entry)
        if len(_scan_batch) > 2000:
            _scan_batch[:] = _scan_batch[-2000:]


async def _flush_scan_batch() -> None:
    """Batch insert queued scans into scan_history table."""
    async with _scan_batch_lock:
        if not _scan_batch:
            return
        batch = _scan_batch.copy()
        _scan_batch.clear()
    try:
        pool = await _get_scan_pool()
        async with pool.acquire() as conn:
            rows = [
                (e["strategy_id"], e["strategy_name"], e["symbol"], e["timeframe"],
                 e["signal"], e["confidence"], e["explanation"], e["signal_pending"],
                 e["persistence_score"], e["asset_type"])
                for e in batch
            ]
            await conn.executemany(
                """INSERT INTO scan_history
                   (id, strategy_id, strategy_name, symbol, timeframe, signal,
                    confidence, explanation, signal_pending, persistence_score,
                    asset_type, scanned_at)
                   VALUES (md5(random()::text || clock_timestamp()::text || random()::text), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())""",
                rows,
            )
        logger.info("scan_history_batch_inserted", count=len(rows))
    except Exception as e:
        logger.warning("scan_history_batch_failed", error=str(e), count=len(batch))


async def _scan_batch_flusher():
    """Flush scan batch to DB every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        await _flush_scan_batch()


async def _persist_scan(result: dict, timeframe: str) -> None:
    """Persist scan result to Redis (real-time) + queue for DB batch."""
    await _persist_scan_redis(result, timeframe)
    await _queue_scan_for_batch(result, timeframe)


# ── Auto-ingest high-confidence signals to API (→ SignalCards) ──
_ingest_recent: dict[str, float] = {}  # key: "symbol:timeframe" → last ingest timestamp
_INGEST_COOLDOWN = 300  # 5 min between ingests for the same symbol+timeframe
_ingest_client: httpx.AsyncClient | None = None


async def _try_ingest_signal(result: dict, timeframe: str) -> None:
    """If signal is BUY/SELL with confidence >= 70, POST to API /signals/ingest.
    This creates a Signal record → appears as a SignalCard in the frontend.
    Fire-and-forget, 5s timeout, deduplicated per symbol+timeframe (5 min cooldown).
    """
    sig = result.get("signal", "NEUTRAL")
    conf = result.get("confidence", 0)
    if sig not in ("BUY", "SELL") or conf < 70:
        return
    sym = result.get("symbol", "")
    key = f"{sym}:{timeframe}"
    now = time.monotonic()
    last = _ingest_recent.get(key, 0)
    if now - last < _INGEST_COOLDOWN:
        return
    _ingest_recent[key] = now

    api_url = config.settings.api_url
    api_key = config.settings.engine_api_key
    if not api_url or not api_key:
        return

    global _ingest_client
    try:
        if _ingest_client is None or _ingest_client.is_closed:
            _ingest_client = httpx.AsyncClient(timeout=5.0)
        await _ingest_client.post(
            f"{api_url}/signals/ingest",
            json=result,
            headers={"X-Engine-Key": api_key},
        )
    except Exception:
        pass
