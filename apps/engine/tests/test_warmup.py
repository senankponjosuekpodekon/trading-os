"""Tests unitaires — boucles de warmup automatique (routers/scan.py).

Ces boucles (`warmup_fast` / `warmup_slow`) tournent en tâche de fond depuis
`main.py:lifespan` et alimentent le cache Redis consommé par `/scan` et
`/scan/multi`. Elles sont `while True` : on les fait sortir après un cycle
en faisant lever une exception de contrôle depuis `asyncio.sleep`, patché
uniquement pour la durée du test.
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from unittest.mock import patch

from routers import scan as scan_module


class _StopLoop(Exception):
    """Exception de contrôle pour sortir d'une boucle `while True` testée."""


class TestWarmupFast:
    def test_caches_one_result_per_symbol_and_timeframe(self):
        calls = []

        async def fake_fetch_and_analyze(symbol, timeframe, htf_regime=None):
            return {"symbol": symbol, "timeframe": timeframe, "signal": "BUY", "confidence": 80}

        async def fake_set_cached(key, value, ttl=None):
            calls.append((key, value, ttl))

        async def fake_sleep(_seconds):
            raise _StopLoop()

        with patch.object(scan_module, "fetch_and_analyze", side_effect=fake_fetch_and_analyze), \
             patch.object(scan_module, "set_cached", side_effect=fake_set_cached), \
             patch.object(scan_module, "BINANCE_PRIORITY_SYMBOLS", ["BTC/USDT", "ETH/USDT"]), \
             patch.object(scan_module, "WARMUP_TIMEFRAMES_FAST", ["15m", "1h"]), \
             patch.object(scan_module, "WARMUP_TTL_FAST", 90), \
             patch("asyncio.sleep", side_effect=fake_sleep):
            with pytest.raises(_StopLoop):
                asyncio.run(scan_module.warmup_fast())

        keys = {c[0] for c in calls}
        assert keys == {
            "scan:BTC/USDT:15m", "scan:ETH/USDT:15m",
            "scan:BTC/USDT:1h",  "scan:ETH/USDT:1h",
        }
        assert all(ttl == 90 for _, _, ttl in calls)

    def test_a_symbol_failure_does_not_block_the_others(self):
        calls = []

        async def fake_fetch_and_analyze(symbol, timeframe, htf_regime=None):
            if symbol == "ETH/USDT":
                raise RuntimeError("binance timeout")
            return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0}

        async def fake_set_cached(key, value, ttl=None):
            calls.append(key)

        async def fake_sleep(_seconds):
            raise _StopLoop()

        with patch.object(scan_module, "fetch_and_analyze", side_effect=fake_fetch_and_analyze), \
             patch.object(scan_module, "set_cached", side_effect=fake_set_cached), \
             patch.object(scan_module, "BINANCE_PRIORITY_SYMBOLS", ["BTC/USDT", "ETH/USDT"]), \
             patch.object(scan_module, "WARMUP_TIMEFRAMES_FAST", ["1h"]), \
             patch("asyncio.sleep", side_effect=fake_sleep):
            with pytest.raises(_StopLoop):
                asyncio.run(scan_module.warmup_fast())

        # BTC/USDT est mis en cache malgré l'échec d'ETH/USDT sur le même cycle.
        assert calls == ["scan:BTC/USDT:1h"]

    def test_neutral_signals_are_not_counted_as_signals_found(self):
        """Pas d'assertion directe sur le log, mais on vérifie que le cache
        est bien alimenté même quand tout est NEUTRAL (pas de court-circuit)."""
        calls = []

        async def fake_fetch_and_analyze(symbol, timeframe, htf_regime=None):
            return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0}

        async def fake_set_cached(key, value, ttl=None):
            calls.append(key)

        async def fake_sleep(_seconds):
            raise _StopLoop()

        with patch.object(scan_module, "fetch_and_analyze", side_effect=fake_fetch_and_analyze), \
             patch.object(scan_module, "set_cached", side_effect=fake_set_cached), \
             patch.object(scan_module, "BINANCE_PRIORITY_SYMBOLS", ["BTC/USDT"]), \
             patch.object(scan_module, "WARMUP_TIMEFRAMES_FAST", ["1h"]), \
             patch("asyncio.sleep", side_effect=fake_sleep):
            with pytest.raises(_StopLoop):
                asyncio.run(scan_module.warmup_fast())

        assert calls == ["scan:BTC/USDT:1h"]


class TestWarmupSlow:
    def _run_one_cycle(self, active_symbols, binance_priority, timeframes, ttl=360):
        calls = []
        sleep_calls = []

        async def fake_fetch_and_analyze(symbol, timeframe, htf_regime=None):
            return {"symbol": symbol, "timeframe": timeframe, "signal": "SELL", "confidence": 55}

        async def fake_set_cached(key, value, ttl=None):
            calls.append((key, ttl))

        async def fake_sleep(seconds):
            sleep_calls.append(seconds)
            # Laisse passer le délai initial (15s) + les pauses de rate-limit (0.5s)
            # entre chaque symbole, et ne stoppe qu'au sleep de fin de cycle.
            if seconds not in (15, 0.5):
                raise _StopLoop()

        with patch.object(scan_module, "fetch_and_analyze", side_effect=fake_fetch_and_analyze), \
             patch.object(scan_module, "set_cached", side_effect=fake_set_cached), \
             patch.object(scan_module, "ACTIVE_SYMBOLS", active_symbols), \
             patch.object(scan_module, "BINANCE_PRIORITY_SYMBOLS", binance_priority), \
             patch.object(scan_module, "WARMUP_TIMEFRAMES_SLOW", timeframes), \
             patch.object(scan_module, "WARMUP_TTL_SLOW", ttl), \
             patch("asyncio.sleep", side_effect=fake_sleep):
            with pytest.raises(_StopLoop):
                asyncio.run(scan_module.warmup_slow())

        return calls, sleep_calls

    def test_only_non_binance_symbols_are_scanned(self):
        calls, _ = self._run_one_cycle(
            active_symbols=["BTC/USDT", "EUR/USD", "XAU/USD"],
            binance_priority=["BTC/USDT"],
            timeframes=["1h"],
        )
        keys = {k for k, _ in calls}
        assert keys == {"scan:EUR/USD:1h", "scan:XAU/USD:1h"}

    def test_waits_15s_before_starting_and_paces_requests_by_500ms(self):
        _, sleep_calls = self._run_one_cycle(
            active_symbols=["BTC/USDT", "EUR/USD"],
            binance_priority=["BTC/USDT"],
            timeframes=["1h"],
        )
        assert sleep_calls[0] == 15
        assert 0.5 in sleep_calls

    def test_caches_across_multiple_timeframes(self):
        calls, _ = self._run_one_cycle(
            active_symbols=["BTC/USDT", "EUR/USD"],
            binance_priority=["BTC/USDT"],
            timeframes=["1h", "4h"],
            ttl=360,
        )
        keys = {k for k, _ in calls}
        assert keys == {"scan:EUR/USD:1h", "scan:EUR/USD:4h"}
        assert all(ttl == 360 for _, ttl in calls)

    def test_a_symbol_failure_does_not_block_the_cycle(self):
        calls = []

        async def fake_fetch_and_analyze(symbol, timeframe, htf_regime=None):
            if symbol == "EUR/USD":
                raise RuntimeError("twelvedata down")
            return {"symbol": symbol, "signal": "BUY", "confidence": 60}

        async def fake_set_cached(key, value, ttl=None):
            calls.append(key)

        async def fake_sleep(seconds):
            if seconds not in (15, 0.5):
                raise _StopLoop()

        with patch.object(scan_module, "fetch_and_analyze", side_effect=fake_fetch_and_analyze), \
             patch.object(scan_module, "set_cached", side_effect=fake_set_cached), \
             patch.object(scan_module, "ACTIVE_SYMBOLS", ["BTC/USDT", "EUR/USD", "XAU/USD"]), \
             patch.object(scan_module, "BINANCE_PRIORITY_SYMBOLS", ["BTC/USDT"]), \
             patch.object(scan_module, "WARMUP_TIMEFRAMES_SLOW", ["1h"]), \
             patch("asyncio.sleep", side_effect=fake_sleep):
            with pytest.raises(_StopLoop):
                asyncio.run(scan_module.warmup_slow())

        # EUR/USD échoue mais XAU/USD est tout de même traité et mis en cache.
        assert calls == ["scan:XAU/USD:1h"]


def test_warmup_features_runs_both_loops_concurrently():
    started = []

    async def fake_warmup_fast():
        started.append("fast")
        raise _StopLoop("fast")

    async def fake_warmup_slow():
        started.append("slow")
        raise _StopLoop("slow")

    with patch.object(scan_module, "warmup_fast", side_effect=fake_warmup_fast), \
         patch.object(scan_module, "warmup_slow", side_effect=fake_warmup_slow):
        with pytest.raises(_StopLoop):
            asyncio.run(scan_module.warmup_features())

    assert set(started) == {"fast", "slow"}
