"""
Asset configuration loader for the engine.

Loads market/pair configuration from the shared database via the API.
Caches in-memory for 60s to avoid hitting the API on every scan.
"""
import asyncio
import time
from typing import Optional

import httpx

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

_CACHE_TTL = 60  # seconds
_cache: dict = {}
_cache_ts: float = 0.0
_cache_lock = asyncio.Lock()

# Default market config (used when no DB row exists)
_DEFAULTS = {
    "CRYPTO":     {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 3, "timeframes": None},
    "FOREX":      {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 2, "timeframes": None},
    "SYNTHETIC":  {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 2, "timeframes": None},
    "BRVM":       {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 2, "timeframes": None},
    "US_STOCK":   {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 2, "timeframes": None},
    "COMMODITY":  {"is_active": True,  "warmup_enabled": True,  "scan_interval": None, "max_strategies": 2, "timeframes": None},
}


async def _fetch_from_api() -> dict:
    """Fetch market configs from the API admin endpoint."""
    api_url = settings.api_url.rstrip("/")
    url = f"{api_url}/api/admin/markets/engine"
    headers = {}
    if settings.engine_api_key:
        headers["X-Engine-Key"] = settings.engine_api_key
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    result = {}
    for market in data:
        mt = market["marketType"]
        result[mt] = {
            "is_active": market.get("isActive", True),
            "warmup_enabled": market.get("warmupEnabled", True),
            "scan_interval": market.get("scanInterval"),
            "max_strategies": market.get("maxStrategies"),
            "timeframes": market.get("timeframes"),
        }
    return result


async def load_asset_config() -> dict:
    """Load and cache asset config. Refreshes every 60s."""
    global _cache, _cache_ts
    async with _cache_lock:
        now = time.monotonic()
        if _cache and now - _cache_ts < _CACHE_TTL:
            return _cache
        try:
            fetched = await _fetch_from_api()
            # Merge with defaults
            _cache = {}
            for mt, defaults in _DEFAULTS.items():
                cfg = fetched.get(mt, {})
                _cache[mt] = {
                    "is_active": cfg.get("is_active", defaults["is_active"]),
                    "warmup_enabled": cfg.get("warmup_enabled", defaults["warmup_enabled"]),
                    "scan_interval": cfg.get("scan_interval") or defaults["scan_interval"],
                    "max_strategies": cfg.get("max_strategies") or defaults["max_strategies"],
                    "timeframes": cfg.get("timeframes") or defaults["timeframes"],
                }
            _cache_ts = now
            logger.debug("asset_config_loaded", markets=list(_cache.keys()))
        except Exception as e:
            logger.warning("asset_config_fetch_failed", error=str(e))
            if not _cache:
                _cache = dict(_DEFAULTS)
                _cache_ts = now
        return _cache


def get_market_config(market_type: str) -> dict:
    """Get cached config for a market. Falls back to defaults if not loaded."""
    if not _cache:
        return _DEFAULTS.get(market_type, {"is_active": True, "warmup_enabled": True, "scan_interval": None, "max_strategies": 3, "timeframes": None})
    return _cache.get(market_type, _DEFAULTS.get(market_type, {"is_active": True, "warmup_enabled": True, "scan_interval": None, "max_strategies": 3, "timeframes": None}))


def is_market_active(market_type: str) -> bool:
    return get_market_config(market_type).get("is_active", True)


def is_warmup_enabled(market_type: str) -> bool:
    return get_market_config(market_type).get("warmup_enabled", True)


def get_max_strategies(market_type: str) -> Optional[int]:
    return get_market_config(market_type).get("max_strategies")


def get_scan_interval(market_type: str, default: int) -> int:
    cfg = get_market_config(market_type)
    return cfg.get("scan_interval") or default


def get_timeframes(market_type: str, default: list[str]) -> list[str]:
    cfg = get_market_config(market_type)
    return cfg.get("timeframes") or default
