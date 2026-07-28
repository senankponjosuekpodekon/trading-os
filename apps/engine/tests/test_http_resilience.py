"""Tests for retry_async with circuit breaker and semaphore."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
import pytest

from utils.http import retry_async
from utils.circuit_breaker import CircuitBreakerOpen, get_breaker
from utils.semaphores import set_semaphore_limit


@pytest.mark.asyncio
async def test_retry_async_uses_breaker_and_semaphore():
    # Unique source name per test run to avoid state leakage
    source = "test_http_resilience"
    breaker = get_breaker(source)
    breaker.failure_threshold = 1
    breaker.recovery_timeout = 60.0
    set_semaphore_limit(source, 1)

    async def always_fail():
        raise ValueError("fail")

    with pytest.raises(ValueError):
        await retry_async(always_fail, max_retries=0, source=source)

    assert breaker.state == "open"
    with pytest.raises(CircuitBreakerOpen):
        await retry_async(always_fail, max_retries=0, source=source)


@pytest.mark.asyncio
async def test_retry_async_success_with_source():
    source = "test_http_resilience_ok"

    async def ok():
        return 42

    result = await retry_async(ok, max_retries=0, source=source)
    assert result == 42
