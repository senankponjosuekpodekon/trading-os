"""HTTP helpers — retry with exponential backoff + jitter + circuit breaker + semaphore."""
import asyncio
import random
from typing import Callable, TypeVar, Optional

import httpx

from utils.circuit_breaker import get_breaker, CircuitBreakerOpen
from utils.semaphores import get_semaphore

T = TypeVar('T')


def _is_retryable_error(exc: Exception) -> bool:
    """Évite de retry les erreurs 4xx client (sauf 429 rate limit)."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 429:
            return True
        if 400 <= code < 500:
            return False
    return True


def _delay_for_error(base_delay: float, attempt: int, exc: Exception) -> float:
    """Back-off plus aggressif sur 429."""
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
        return base_delay * (2 ** (attempt + 2))
    return base_delay * (2 ** attempt)


async def retry_async(
    fn: Callable[[], T],
    max_retries: int = 3,
    base_delay: float = 0.5,
    max_delay: float = 10.0,
    jitter: bool = True,
    exceptions: tuple = (Exception,),
    on_retry: Optional[Callable[[int, Exception], None]] = None,
    source: Optional[str] = None,
) -> T:
    """
    Exécute `fn` avec retries, backoff exponentiel, et (optionnel) circuit breaker + sémaphore.
    Délais : base_delay * 2^attempt, plafonné à max_delay, avec jitter ±25%.
    Ne retry pas les erreurs client 4xx (excepté 429).
    """
    async def _execute_once() -> T:
        if source:
            breaker = get_breaker(source)
            sem = get_semaphore(source)
            async with sem:
                return await breaker.call(fn, exceptions=exceptions)
        return await fn() if asyncio.iscoroutinefunction(fn) else fn()

    last_exc: Optional[Exception] = None
    for attempt in range(max_retries + 1):
        try:
            return await _execute_once()
        except CircuitBreakerOpen:
            # Never retry when breaker is open — fail fast to protect upstream.
            raise
        except exceptions as e:
            last_exc = e
            if attempt == max_retries or not _is_retryable_error(e):
                break
            delay = min(_delay_for_error(base_delay, attempt, e), max_delay)
            if jitter:
                delay *= random.uniform(0.75, 1.25)
            if on_retry:
                on_retry(attempt + 1, e)
            await asyncio.sleep(delay)
    raise last_exc  # type: ignore
