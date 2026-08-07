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
            result = await discover_hidden_gems(limit=10)
            _cache["gems"] = result
            _cache["ts"] = time.monotonic()
            logger.info("cron_hidden_gems_done", gems=len(result.get("gems", [])))
        except Exception as exc:
            logger.warning("cron_hidden_gems_failed", error=str(exc))

        await asyncio.sleep(HIDDEN_GEMS_INTERVAL)


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
    """Launch all cron jobs in parallel."""
    await asyncio.gather(
        cron_daily_pulse(),
        cron_hidden_gems(),
        cron_portfolio_rebalance(),
    )
