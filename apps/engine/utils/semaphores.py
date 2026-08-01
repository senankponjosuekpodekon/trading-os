"""
Per-source concurrency limits (asyncio semaphores).

Prevents bursts against rate-limited external APIs.
"""
import asyncio


# Defaults tuned for free-tier limits.
SEMAPHORE_LIMITS: dict[str, int] = {
    "binance":    10,   # fast, generous
    "twelvedata": 1,    # 1 req/s free tier
    "coingecko":  3,
    "newsapi":    1,
    "lunarcrush": 2,
    "coinalyze": 2,   # 40 req/min free
    "dexscreener": 5,  # 300 req/min free, no key
    "geckoterminal": 1, # 10 req/min free, no key
    "defillama":  3,   # free, no key
    "whale-alert": 1,
    "brvm":       3,
    "deriv":      5,
    "default":    5,
}


_semaphores: dict[str, asyncio.Semaphore] = {}


def get_semaphore(name: str) -> asyncio.Semaphore:
    """Return (creating if needed) the named asyncio.Semaphore."""
    if name not in _semaphores:
        _semaphores[name] = asyncio.Semaphore(SEMAPHORE_LIMITS.get(name, SEMAPHORE_LIMITS["default"]))
    return _semaphores[name]


def set_semaphore_limit(name: str, limit: int) -> None:
    """Override the limit for a source (useful in tests)."""
    SEMAPHORE_LIMITS[name] = limit
    if name in _semaphores:
        # We replace the semaphore to keep the implementation simple.
        _semaphores[name] = asyncio.Semaphore(limit)
