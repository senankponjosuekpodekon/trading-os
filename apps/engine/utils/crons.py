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


async def cron_instrument_profile_refresh():
    """Mesure continue de la fiche instrument (toutes les 6h) :

    - feed_offset_obs : écart moyen |entryPrice signal − close bougie
      contenant l'entrée| / entryPrice, sur les 90 derniers jours — le
      biais (iv) mesuré (0.5-1.3×SL adverse).
    - candles_since : début réel de couverture bougies.
    - tradable=false si aucune bougie n'a jamais été stockée.
    """
    INTERVAL = 6 * 3600
    TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800,
                  "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400}
    await asyncio.sleep(1200)  # premier run 20min après boot
    while True:
        try:
            from utils.db_pool import get_shared_pool as get_pool
            pool = await get_pool()
            async with pool.acquire() as con:
                # feed_offset par symbole : médiane approx via percentile_cont
                rows = await con.fetch("""
                    SELECT a.symbol, s.timeframe, s."entryPrice", s."createdAt"
                    FROM signals s JOIN assets a ON a.id = s."assetId"
                    WHERE s."entryPrice" IS NOT NULL
                      AND s."createdAt" > NOW() - INTERVAL '90 days'
                """)
                offsets: dict[str, list[float]] = {}
                for r in rows:
                    tf_s = TF_SECONDS.get(r["timeframe"], 3600)
                    c = await con.fetchrow("""
                        SELECT close FROM candles
                        WHERE symbol=$1 AND timeframe=$2
                          AND open_time <= $3::timestamp
                          AND open_time + ($4 || ' seconds')::interval > $3::timestamp
                        LIMIT 1""",
                        r["symbol"], r["timeframe"], r["createdAt"], str(tf_s))
                    if not c:
                        continue
                    e, close = float(r["entryPrice"]), float(c["close"])
                    if e > 0:
                        offsets.setdefault(r["symbol"], []).append(abs(e - close) / e)
                for sym, vals in offsets.items():
                    vals.sort()
                    med = vals[len(vals) // 2]
                    await con.execute("""
                        UPDATE instrument_profile
                        SET feed_offset_obs=$1, source='measured', updated_at=NOW()
                        WHERE symbol=$2""", med, sym)
                await con.execute("""
                    UPDATE instrument_profile ip
                    SET candles_since = sub.first_candle,
                        tradable = (sub.first_candle IS NOT NULL),
                        updated_at = NOW()
                    FROM (SELECT symbol, MIN(open_time)::date AS first_candle
                          FROM candles GROUP BY symbol) sub
                    WHERE ip.symbol = sub.symbol""")
                await con.execute("""
                    UPDATE instrument_profile ip SET tradable=false, updated_at=NOW()
                    WHERE NOT EXISTS (SELECT 1 FROM candles c WHERE c.symbol = ip.symbol)""")
                logger.info("cron_instrument_profile_done", measured=len(offsets))
        except Exception as exc:
            logger.warning("cron_instrument_profile_failed", error=str(exc))
        await asyncio.sleep(INTERVAL)


async def cron_portfolio_snapshots():
    """Snapshot horaire de l'état consolidé de chaque portfolio →
    portfolio_snapshots : equity curve réelle, marge, risque-to-stop,
    clusters, venues. Permet de mesurer la performance réelle du
    portefeuille (pas simulée) et d'alimenter VaR/drawdown."""
    import json
    INTERVAL = 3600
    await asyncio.sleep(900)  # premier run 15min après boot
    while True:
        try:
            from risk.portfolio_state import portfolio_state
            from utils.db_pool import get_shared_pool as get_pool
            pool = await get_pool()
            async with pool.acquire() as con:
                pids = await con.fetch("SELECT id FROM portfolios")
                for p in pids:
                    st = await portfolio_state(p["id"])
                    if st.get("error"):
                        continue
                    await con.execute("""
                        INSERT INTO portfolio_snapshots
                        ("portfolioId",equity,cash,cash_free,margin_locked,
                         unrealized_pnl,n_positions,risk_to_stop,risk_budget,
                         gap_loss,clusters,venues)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)""",
                        p["id"], st["equity"], st["cash"], st["cash_free"],
                        st["margin_locked"], st["unrealized_pnl"],
                        st["n_positions"], st["risk_to_stop"],
                        st["risk_budget"], st["gap_loss_total"],
                        json.dumps(st["clusters"]), json.dumps(st["venues"]))
            logger.info("cron_portfolio_snapshots_done", n=len(pids))
        except Exception as exc:
            logger.warning("cron_portfolio_snapshots_failed", error=str(exc))
        await asyncio.sleep(INTERVAL)


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
        cron_instrument_profile_refresh(),
        cron_portfolio_snapshots(),
        return_exceptions=True,
    )
