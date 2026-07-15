"""
Sprint 0 — Rate limiting générique pour les appels externes.

Permet de limiter les requêtes concurrentes et d'espacer les appels
pour respecter les quotas des APIs tierces (Twelve Data, NewsAPI, Binance, etc.).
"""
import asyncio
import time
from functools import wraps
from typing import Any, Callable


def rate_limit(max_concurrent: int = 1, min_delay: float = 0.0):
    """
    Décorateur de rate-limiting.

    :param max_concurrent: nombre maximum d'appels en parallèle.
    :param min_delay: délai minimum (en secondes) entre deux appels.
    """
    sem = asyncio.Semaphore(max_concurrent)
    lock = asyncio.Lock()
    last_call = 0.0

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(fn)
        async def wrapper(*args, **kwargs):
            nonlocal last_call
            await sem.acquire()
            try:
                if min_delay > 0:
                    async with lock:
                        elapsed = time.monotonic() - last_call
                        if elapsed < min_delay:
                            await asyncio.sleep(min_delay - elapsed)
                        last_call = time.monotonic()
                return await fn(*args, **kwargs)
            finally:
                sem.release()
        return wrapper
    return decorator


class HostRateLimiter:
    """
    Rate limiter par hôte (domaine). Utilisé quand plusieurs services tiers
    sont appelés depuis le même processus.
    """
    def __init__(self):
        self._limiters: dict[str, Callable[..., Callable[..., Any]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def for_host(self, host: str, max_concurrent: int = 1, min_delay: float = 0.0):
        """Retourne un décorateur de rate-limiting pour un hôte donné."""
        key = f"{host}:{max_concurrent}:{min_delay}"
        if key not in self._limiters:
            self._limiters[key] = rate_limit(max_concurrent, min_delay)
        return self._limiters[key]


_global_limiter = HostRateLimiter()


def host_rate_limit(host: str, max_concurrent: int = 1, min_delay: float = 0.0):
    """Rate limiting partagé par hôte (ex: 'newsapi.org', 'api.binance.com')."""
    return _global_limiter.for_host(host, max_concurrent, min_delay)
