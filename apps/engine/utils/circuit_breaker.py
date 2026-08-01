"""
Circuit breaker for external API sources.

Prevents cascading failures by opening the circuit after consecutive failures,
then testing again after a cooldown.
"""
import asyncio
import time
from enum import Enum
from typing import Optional, Callable, TypeVar

T = TypeVar('T')


class State(Enum):
    CLOSED = "closed"      # normal
    OPEN = "open"          # failing fast
    HALF_OPEN = "half_open"  # probing


class CircuitBreaker:
    """
    Simple in-memory circuit breaker.

    - failure_threshold : consecutive failures before opening
    - recovery_timeout    : seconds before trying one probe call
    - half_open_max_calls: number of successful probes needed to close
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 3,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 1,
        on_open: Optional[Callable[[str], None]] = None,
        on_close: Optional[Callable[[str], None]] = None,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        self.on_open = on_open
        self.on_close = on_close

        self._state = State.CLOSED
        self._failures = 0
        self._last_failure_time: Optional[float] = None
        self._successes_in_half_open = 0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> str:
        return self._state.value

    async def call(self, fn: Callable[[], T], exceptions: tuple = (Exception,)) -> T:
        async with self._lock:
            if self._state == State.OPEN:
                last = self._last_failure_time or 0
                if time.monotonic() - last >= self.recovery_timeout:
                    self._state = State.HALF_OPEN
                    self._successes_in_half_open = 0
                else:
                    raise CircuitBreakerOpen(self.name)

        try:
            result = await fn() if asyncio.iscoroutinefunction(fn) else fn()
        except exceptions:
            await self._record_failure()
            raise
        else:
            await self._record_success()
            return result

    async def _record_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            self._last_failure_time = time.monotonic()
            if self._state == State.HALF_OPEN:
                self._state = State.OPEN
                if self.on_open:
                    self.on_open(self.name)
            elif self._failures >= self.failure_threshold:
                if self._state != State.OPEN:
                    self._state = State.OPEN
                    if self.on_open:
                        self.on_open(self.name)

    async def _record_success(self) -> None:
        async with self._lock:
            if self._state == State.HALF_OPEN:
                self._successes_in_half_open += 1
                if self._successes_in_half_open >= self.half_open_max_calls:
                    self._state = State.CLOSED
                    self._failures = 0
                    if self.on_close:
                        self.on_close(self.name)
            else:
                self._failures = 0


class CircuitBreakerOpen(Exception):
    """Raised when the circuit breaker is open."""

    def __init__(self, source: str):
        self.source = source
        super().__init__(f"Circuit breaker OPEN for source: {source}")


# Pre-defined breakers for known external sources.
BREAKERS: dict[str, CircuitBreaker] = {
    "binance": CircuitBreaker("binance", failure_threshold=3, recovery_timeout=60.0),
    "twelvedata": CircuitBreaker("twelvedata", failure_threshold=3, recovery_timeout=120.0),
    "coingecko": CircuitBreaker("coingecko", failure_threshold=3, recovery_timeout=120.0),
    "newsapi": CircuitBreaker("newsapi", failure_threshold=5, recovery_timeout=300.0),
    "lunarcrush": CircuitBreaker("lunarcrush", failure_threshold=3, recovery_timeout=120.0),
    "coinalyze": CircuitBreaker("coinalyze", failure_threshold=3, recovery_timeout=120.0),
    "dexscreener": CircuitBreaker("dexscreener", failure_threshold=3, recovery_timeout=60.0),
    "geckoterminal": CircuitBreaker("geckoterminal", failure_threshold=3, recovery_timeout=120.0),
    "defillama": CircuitBreaker("defillama", failure_threshold=3, recovery_timeout=120.0),
    "whale-alert": CircuitBreaker("whale-alert", failure_threshold=5, recovery_timeout=300.0),
    "brvm": CircuitBreaker("brvm", failure_threshold=5, recovery_timeout=300.0),
    "deriv": CircuitBreaker("deriv", failure_threshold=3, recovery_timeout=60.0),
}


def get_breaker(name: str) -> CircuitBreaker:
    if name not in BREAKERS:
        BREAKERS[name] = CircuitBreaker(name, failure_threshold=3, recovery_timeout=60.0)
    return BREAKERS[name]
