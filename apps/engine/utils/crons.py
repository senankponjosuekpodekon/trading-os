"""
Cron Jobs — Daily Pulse, Hidden Gems, Portfolio Rebalancing
Periodic background tasks that run alongside the warmup loops.
"""
import asyncio
import time
from datetime import datetime, timezone

from utils.logger import get_logger

logger = get_logger(__name__)

DAILY_PULSE_INTERVAL = 3600  # 1h check, but only generates once per day at 6h UTC
HIDDEN_GEMS_INTERVAL = 1800  # 30 min
REBALANCE_INTERVAL = 3600 * 6  # 6h


async def cron_daily_pulse():
    """Generate Daily Pulse at 6h UTC daily. Checks every hour."""
    last_generated = None
    while True:
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y-%m-%d")

        # Generate at 6h UTC (or if not yet generated today)
        if last_generated != today and 6 <= now.hour < 7:
            try:
                from routers.daily_pulse import generate_daily_pulse
                logger.info("cron_daily_pulse_start")
                await generate_daily_pulse()
                last_generated = today
                logger.info("cron_daily_pulse_done", date=today, status="ok")
            except Exception as exc:
                logger.warning("cron_daily_pulse_failed", error=str(exc))
                last_generated = today  # Don't retry every minute

        await asyncio.sleep(DAILY_PULSE_INTERVAL)


async def cron_hidden_gems():
    """Scan for hidden gems every 30 minutes and cache results."""
    while True:
        try:
            from ml.hidden_gems import discover_hidden_gems, _cache
            logger.info("cron_hidden_gems_start")
            result = await discover_hidden_gems(limit=50)
            _cache["gems"] = result
            _cache["ts"] = time.monotonic()
            logger.info("cron_hidden_gems_done", gems=len(result.get("gems", [])))
        except Exception as exc:
            logger.warning("cron_hidden_gems_failed", error=str(exc))

        await asyncio.sleep(HIDDEN_GEMS_INTERVAL)


async def cron_majors_tracker():
    """Snapshot les top-30 majors CoinGecko toutes les 30 min — alimente
    la trajectoire longitudinale (volume trend, croissance prix/mcap)."""
    while True:
        try:
            from ml.majors_tracker import snapshot_majors
            n = await snapshot_majors()
            logger.info("cron_majors_tracker_done", count=n)
        except Exception as exc:
            logger.warning("cron_majors_tracker_failed", error=str(exc))

        await asyncio.sleep(HIDDEN_GEMS_INTERVAL)


async def cron_gem_paper_trader():
    """Évalue les positions papier des gems toutes les 10 min : TP1 +50% /
    TP2 +100% / trailing -30% pic / SL -25% / time-stop 72h, avec push."""
    PAPER_INTERVAL = 600
    await asyncio.sleep(120)  # laisse le premier scan peupler les positions
    while True:
        try:
            from ml.gem_paper_trader import check_positions
            res = await check_positions()
            logger.info("cron_gem_paper_done", **res)
        except Exception as exc:
            logger.warning("cron_gem_paper_failed", error=str(exc))

        await asyncio.sleep(PAPER_INTERVAL)


async def cron_gem_model():
    """Réentraîne le modèle de détection chaque nuit — régression logistique
    calibrée sur les snapshots accumulés (label = +20% à 24h). Le modèle
    s'améliore au fil des données : self-calibrating scorer."""
    GEM_MODEL_INTERVAL = 24 * 3600
    await asyncio.sleep(3600)  # premier run 1h après boot
    while True:
        try:
            from ml.gem_model import train_gem_model, train_majors_model
            res = await train_gem_model()
            logger.info("cron_gem_model_done", **res)
            res_m = await train_majors_model()
            logger.info("cron_majors_model_done", **res_m)
        except Exception as exc:
            logger.warning("cron_gem_model_failed", error=str(exc))

        await asyncio.sleep(GEM_MODEL_INTERVAL)


async def cron_smart_money():
    """Met à jour l'index smart-money toutes les heures : juge les tokens
    trackés dont l'issue est connue (win ≥+50% / loss ≤−50% vs premier
    snapshot) et enrichit les index deployers + early-buyers."""
    SMART_MONEY_INTERVAL = 3600
    await asyncio.sleep(600)  # premier run 10min après boot
    while True:
        try:
            from ml.smart_money import update_smart_money_index
            res = await update_smart_money_index()
            logger.info("cron_smart_money_done", **res)
        except Exception as exc:
            logger.warning("cron_smart_money_failed", error=str(exc))

        await asyncio.sleep(SMART_MONEY_INTERVAL)


async def cron_gem_snapshot_archive():
    """Archive quotidienne en Postgres du dernier snapshot de chaque token
    tracké — les listes Redis gem_snapshots:* ont un TTL : sans archivage,
    l'historique de calibration (le dataset qui mesure le score) s'évapore."""
    ARCHIVE_INTERVAL = 24 * 3600
    _db_ready = False
    await asyncio.sleep(900)  # premier run 15min après boot
    while True:
        try:
            from utils.cache import cache
            from utils.db_pool import get_shared_pool as get_pool
            import json as _json
            r = await cache.client()
            pool = await get_pool()
            async with pool.acquire() as con:
                if not _db_ready:
                    await con.execute("""
                        CREATE TABLE IF NOT EXISTS gem_snapshots_archive (
                            id BIGSERIAL PRIMARY KEY,
                            chain TEXT NOT NULL,
                            token_address TEXT NOT NULL,
                            snap_ts TIMESTAMPTZ NOT NULL,
                            data JSONB,
                            created_at TIMESTAMPTZ DEFAULT now(),
                            UNIQUE (chain, token_address, snap_ts)
                        )""")
                    _db_ready = True

                keys = await r.smembers("gem_tracked")
                archived = 0
                for raw in keys:
                    k = raw.decode() if isinstance(raw, bytes) else raw
                    parts = k.split(":", 1)
                    if len(parts) != 2:
                        continue
                    chain, addr = parts
                    snap_raw = await r.lindex(f"gem_snapshots:{k}", 0)
                    if not snap_raw:
                        continue
                    try:
                        snap = _json.loads(snap_raw)
                        ts = snap.get("ts") or snap.get("time") or 0
                        if isinstance(ts, (int, float)) and ts > 10**12:
                            ts /= 1000.0
                    except Exception:
                        continue
                    res = await con.execute("""
                        INSERT INTO gem_snapshots_archive (chain, token_address, snap_ts, data)
                        VALUES ($1, $2, to_timestamp($3), $4::jsonb)
                        ON CONFLICT (chain, token_address, snap_ts) DO NOTHING""",
                        chain, addr, float(ts), snap_raw.decode() if isinstance(snap_raw, bytes) else snap_raw)
                    if res.endswith(" 1"):
                        archived += 1
                logger.info("cron_gem_snapshot_archive_done", tracked=len(keys), archived=archived)
        except Exception as exc:
            logger.warning("cron_gem_snapshot_archive_failed", error=str(exc))

        await asyncio.sleep(ARCHIVE_INTERVAL)


async def cron_portfolio_rebalance():
    """
    Periodically compute portfolio rebalancing suggestions.
    In production, this would fetch real positions from the database.
    """
    while True:
        try:
            logger.info("cron_rebalance_start")
            # In production: fetch positions from DB, compute rebalancing
            # For now, just log that the cron is alive
            logger.info("cron_rebalance_done", status="idle — no positions in DB")
        except Exception as exc:
            logger.warning("cron_rebalance_failed", error=str(exc))

        await asyncio.sleep(REBALANCE_INTERVAL)


async def run_all_crons():
    """Launch all cron jobs in parallel. Each cron is individually resilient
    (try/except inside the while loop), but we also use return_exceptions=True
    as a safety net so one crash doesn't kill the others."""
    await asyncio.gather(
        cron_daily_pulse(),
        cron_hidden_gems(),
        cron_majors_tracker(),
        cron_gem_paper_trader(),
        cron_gem_model(),
        cron_smart_money(),
        cron_gem_snapshot_archive(),
        cron_portfolio_rebalance(),
        return_exceptions=True,
    )
