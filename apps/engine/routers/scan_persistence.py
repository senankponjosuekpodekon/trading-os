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

SCAN_HISTORY_REDIS_TTL = 21600  # 6h — évite la disparition des résultats en journée
SCAN_HISTORY_REDIS_MAX = 1999   # ltrim garde les indices 0..1999 (~2000 entrées)
NEUTRAL_SAMPLE_RATE = 0.05      # ~5% des scans NEUTRAL conf=0 conservés en DB (statistiques)

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
            "entry_price": result.get("entry_price"),
            "stop_loss": result.get("stop_loss"),
            "take_profit_1": result.get("take_profit_1"),
            "take_profit_2": result.get("take_profit_2"),
            "risk_reward": result.get("risk_reward"),
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
        await r.ltrim(key, 0, SCAN_HISTORY_REDIS_MAX)  # keep last ~2000 entries
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


_rej_batch: list[dict] = []
_rej_batch_lock = asyncio.Lock()
# Dédup : le même setup rejeté à chaque cycle de scan produirait une
# ligne par cycle (observé : 427 lignes / 57 setups ≈ ×7.5). On garde
# une ligne par (symbol, timeframe, direction, layer) par fenêtre.
_rej_seen: dict[tuple, float] = {}
REJ_DEDUP_TTL = 1800  # s — un rejet persistant est ré-émis toutes les 30 min


def queue_gate_rejection(rejection: dict) -> None:
    """Queue a structured gate rejection for batch DB insertion.

    Synchrone : appelable depuis analyze_candles (sync). list.append est
    atomique sous le GIL ; le flush recopie le batch sous lock.
    Champs attendus : symbol, timeframe, direction, layer, reason,
    asset_type, strategy_id, strategy_name, entry_price, quality_score,
    metadata (inclut stop_loss/take_profit/price_source pour rejouer le
    setup). Persiste chaque rejet du pipeline — sans ça, les SELL
    disparus et les couches qui filtrent ne sont pas mesurables.
    """
    key = (rejection.get("symbol"), rejection.get("timeframe"),
           rejection.get("direction"), rejection.get("layer"))
    now = time.monotonic()
    if now - _rej_seen.get(key, -REJ_DEDUP_TTL) < REJ_DEDUP_TTL:
        return
    _rej_seen[key] = now
    if len(_rej_seen) > 5000:  # borne mémoire — purge les clés expirées
        for k in [k for k, t in _rej_seen.items()
                  if now - t >= REJ_DEDUP_TTL]:
            del _rej_seen[k]
    _rej_batch.append(rejection)
    if len(_rej_batch) > 2000:
        _rej_batch[:] = _rej_batch[-2000:]


async def _flush_rejection_batch() -> None:
    async with _rej_batch_lock:
        if not _rej_batch:
            return
        batch = _rej_batch.copy()
        _rej_batch.clear()
    try:
        pool = await _get_scan_pool()
        async with pool.acquire() as conn:
            rows = [
                (e.get("symbol"), e.get("timeframe"), e.get("direction"),
                 e.get("layer"), (e.get("reason") or "")[:2000],
                 e.get("asset_type"), e.get("strategy_id"),
                 e.get("strategy_name"), e.get("entry_price"),
                 e.get("quality_score"), json.dumps(e.get("metadata") or {}, default=str))
                for e in batch
            ]
            await conn.executemany(
                """INSERT INTO gate_rejections
                   (id, symbol, timeframe, direction, layer, reason,
                    asset_type, strategy_id, strategy_name, entry_price,
                    quality_score, metadata)
                   VALUES (md5(random()::text || clock_timestamp()::text || random()::text),
                           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                rows,
            )
        logger.info("gate_rejections_batch_inserted", count=len(rows))
    except Exception as e:
        logger.warning("gate_rejections_batch_failed", error=str(e), count=len(batch))


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
        try:
            from utils.dlq import dlq_push
            # garder seulement les clés utiles pour rejouer l'insert
            await dlq_push("scan_history_batch", batch[:500], error=str(e))
        except Exception:
            pass


async def _scan_batch_flusher():
    """Flush scan batch to DB every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        await _flush_scan_batch()
        await _flush_rejection_batch()


async def _persist_scan(result: dict, timeframe: str) -> None:
    """Persist scan result to Redis (real-time) + queue for DB batch.

    NEUTRAL conf=0 scans (~96% du volume, aucune valeur métier individuelle)
    ne sont pas insérés en DB — seul un échantillon ~5% est conservé pour les stats.
    Redis garde tout en temps réel.
    """
    await _persist_scan_redis(result, timeframe)
    if result.get("signal", "NEUTRAL") == "NEUTRAL" and not result.get("confidence"):
        import random
        if random.random() >= NEUTRAL_SAMPLE_RATE:
            return
    await _queue_scan_for_batch(result, timeframe)


# ── Auto-ingest high-confidence signals to API (→ SignalCards) ──
_ingest_recent: dict[str, float] = {}  # key: "symbol:timeframe" → last ingest timestamp
_INGEST_COOLDOWN = 300  # 5 min between ingests for the same symbol+timeframe
_ingest_client: httpx.AsyncClient | None = None

# Appris des outcomes réels : les wins ont un persistence_score moyen ~45,
# les losses ~20. Exiger une stabilité minimale filtre les signaux "flash".
INGEST_MIN_PERSISTENCE = float(__import__("os").environ.get("INGEST_MIN_PERSISTENCE", "30"))


async def _try_ingest_signal(result: dict, timeframe: str) -> None:
    """If signal is BUY/SELL with confidence >= 70, POST to API /signals/ingest.
    This creates a Signal record → appears as a SignalCard in the frontend, ready to execute.
    Fire-and-forget, 5s timeout, deduplicated per symbol+timeframe (5 min cooldown).
    """
    sig = result.get("signal", "NEUTRAL")
    conf = result.get("confidence", 0)
    if sig not in ("BUY", "SELL") or conf < 70:
        return
    # Gate de persistance : un signal doit survivre à plusieurs rescans
    # (persistence_score absent/0 sur les stratégies sans hysteresis → accepté)
    persist = result.get("persistence_score")
    if persist is not None and 0 < persist < INGEST_MIN_PERSISTENCE:
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
            f"{api_url.rstrip('/')}/api/signals/ingest",
            content=json.dumps(result, default=str),
            headers={"X-Engine-Key": api_key, "Content-Type": "application/json"},
        )
    except Exception as e:
        try:
            from utils.dlq import dlq_push
            await dlq_push("ingest_signal", {"symbol": result.get("symbol"), "timeframe": timeframe,
                                             "signal": result.get("signal"), "confidence": result.get("confidence")},
                           error=str(e))
        except Exception:
            pass
