"""Tests for per-source semaphores."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
import pytest

from utils.semaphores import get_semaphore, set_semaphore_limit


@pytest.mark.asyncio
async def test_semaphore_limits_concurrency():
    set_semaphore_limit("test", 1)
    sem = get_semaphore("test")
    assert sem._value == 1

    results = []
    async def work():
        async with sem:
            results.append("start")
            await asyncio.sleep(0.01)
            results.append("end")

    await asyncio.gather(work(), work())
    # Tasks must not overlap
    assert results == ["start", "end", "start", "end"]


def test_get_semaphore_creates_new_source():
    sem = get_semaphore("new_source")
    assert sem._value > 0
