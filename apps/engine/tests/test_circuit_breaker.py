"""Tests for the circuit breaker utility."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
import pytest

from utils.circuit_breaker import CircuitBreaker, CircuitBreakerOpen


async def _ok():
    return "ok"


async def _fail():
    raise ValueError("boom")


def test_circuit_breaker_initially_closed():
    cb = CircuitBreaker("test")
    assert cb.state == "closed"


@pytest.mark.asyncio
async def test_success_keeps_closed():
    cb = CircuitBreaker("test")
    result = await cb.call(_ok)
    assert result == "ok"
    assert cb.state == "closed"


@pytest.mark.asyncio
async def test_opens_after_threshold():
    cb = CircuitBreaker("test", failure_threshold=2, recovery_timeout=60.0)
    with pytest.raises(ValueError):
        await cb.call(_fail, exceptions=(ValueError,))
    with pytest.raises(ValueError):
        await cb.call(_fail, exceptions=(ValueError,))
    assert cb.state == "open"
    with pytest.raises(CircuitBreakerOpen):
        await cb.call(_ok)


@pytest.mark.asyncio
async def test_half_open_then_close():
    cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.0)
    with pytest.raises(ValueError):
        await cb.call(_fail, exceptions=(ValueError,))
    # Wait for recovery timeout to pass
    await asyncio.sleep(0.01)
    result = await cb.call(_ok)
    assert result == "ok"
    assert cb.state == "closed"


@pytest.mark.asyncio
async def test_unknown_exception_not_tracked():
    cb = CircuitBreaker("test", failure_threshold=1)
    with pytest.raises(ValueError):
        await cb.call(_fail)  # default exceptions=(Exception,) -> tracked
    assert cb.state == "open"
