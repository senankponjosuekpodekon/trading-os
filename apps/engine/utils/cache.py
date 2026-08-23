"""Cache Redis centralisé pour l'engine."""
import json
import time
from typing import Any, Optional, Callable, Awaitable

import redis.asyncio as redis

import config


# ── In-memory TTL cache for external data fetchers ──────────────
_mem_cache: dict[str, tuple[Any, float]] = {}


def mem_get(key: str) -> Any | None:
    entry = _mem_cache.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.monotonic() > expires_at:
        _mem_cache.pop(key, None)
        return None
    return value


def mem_set(key: str, value: Any, ttl: int) -> None:
    _mem_cache[key] = (value, time.monotonic() + ttl)


async def mem_cached(key: str, fetch_fn: Callable[[], Awaitable[Any]], ttl: int = 600) -> Any:
    cached = mem_get(key)
    if cached is not None:
        return cached
    result = await fetch_fn()
    if result is not None:
        mem_set(key, result, ttl)
    return result


class Cache:
    def __init__(self, url: str | None = None):
        self.url = url or config.settings.redis_url
        self._client: Optional[redis.Redis] = None

    async def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(self.url, decode_responses=False)
        return self._client

    async def get(self, key: str) -> Any | None:
        try:
            r = await self.client()
            raw = await r.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception:
            return None

    async def set(self, key: str, value: Any, ttl: int = 900) -> bool:
        try:
            r = await self.client()
            await r.set(key, json.dumps(value, default=str), ex=ttl)
            return True
        except Exception:
            return False

    async def delete(self, key: str) -> bool:
        try:
            r = await self.client()
            await r.delete(key)
            return True
        except Exception:
            return False

    async def health(self) -> dict:
        try:
            r = await self.client()
            await r.ping()
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "error": str(e)}


cache = Cache()


async def get_cached(key: str, ttl: int = 900) -> Any | None:
    """L1 in-memory then L2 Redis lookup."""
    value = mem_get(key)
    if value is not None:
        return value
    value = await cache.get(key)
    if value is not None:
        mem_set(key, value, ttl)
    return value


async def set_cached(key: str, value: Any, ttl: int = 900) -> bool:
    """Write to both L1 in-memory and L2 Redis."""
    mem_set(key, value, ttl)
    return await cache.set(key, value, ttl)
