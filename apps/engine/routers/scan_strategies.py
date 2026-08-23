"""Active strategy loading and caching for the scanner."""
import asyncio
import json
import time

from utils.logger import get_logger
from routers.scan_persistence import _get_scan_pool

logger = get_logger(__name__)

_active_strategies_cache: list[dict] = []
_active_strategies_ts: float = 0
_active_strategies_lock = asyncio.Lock()


# ── Default strategy ──────────────────────────────────────────
# Used when no strategy is provided (no UserStrategy active, fresh install,
# manual scan without strategy). Ensures all signals go through
# evaluate_strategy with proper filters (min_confidence, regime, DPS, etc.)
# instead of the legacy hardcoded pipeline.
DEFAULT_STRATEGY = {
    "id": None,
    "name": "Default",
    "rules": {
        "ema_fast": 20,
        "ema_slow": 50,
        "ema_trend": 200,
        "rsi_period": 14,
        "rsi_oversold": 30,
        "rsi_overbought": 70,
        "rsi_bullish_zone": 45,
        "rsi_bearish_zone": 55,
        "min_confidence": 40,
        "min_dps": 0,
        "volume_spike_min": 1.3,
        "use_price_action": True,
        "use_sr_zones": True,
        "use_smc": True,
        "use_patterns": True,
        "atr_min_pct": 0.0,
        "trigger": "BREAKOUT",
        "markets": [],
        "profiles": [],
        "timeframes": ["1h", "4h"],
    },
}


async def _load_active_strategies() -> list[dict]:
    """Charge les stratégies actives depuis la DB (cache 60s)."""
    global _active_strategies_cache, _active_strategies_ts
    now = time.monotonic()
    if _active_strategies_cache and (now - _active_strategies_ts) < 60:
        return _active_strategies_cache
    async with _active_strategies_lock:
        if _active_strategies_cache and (now - _active_strategies_ts) < 60:
            return _active_strategies_cache
        try:
            pool = await _get_scan_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT id, name, rules::text FROM strategies WHERE "isActive" = true"""
                )
            strategies = []
            for r in rows:
                try:
                    rules = json.loads(r["rules"]) if r["rules"] else {}
                except Exception:
                    rules = {}
                strategies.append({"id": r["id"], "name": r["name"], "rules": rules})
            _active_strategies_cache = strategies
            _active_strategies_ts = time.monotonic()
            logger.info("active_strategies_loaded", count=len(strategies))
            return strategies
        except Exception as e:
            logger.warning("active_strategies_load_failed", error=str(e))
            return _active_strategies_cache if _active_strategies_cache else []
