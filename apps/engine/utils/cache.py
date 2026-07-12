"""Cache Redis centralisé pour l'engine."""
import json
import pickle
from typing import Any, Optional

import redis.asyncio as redis

import config


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
            return pickle.loads(raw)
        except Exception:
            return None

    async def set(self, key: str, value: Any, ttl: int = 900) -> bool:
        try:
            r = await self.client()
            await r.setex(key, ttl, pickle.dumps(value))
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


async def get_cached(key: str) -> Any | None:
    return await cache.get(key)


async def set_cached(key: str, value: Any, ttl: int = 900) -> bool:
    return await cache.set(key, value, ttl)
