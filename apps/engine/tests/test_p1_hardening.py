"""Tests de régression P1 — broadcast thread-safe, caches bornés, bornes LLM."""
import asyncio
import sys
import os
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from pydantic import ValidationError

from routers import ws
from utils.cache import BoundedTTLDict, mem_set, mem_get, _mem_cache
from routers.llm import ChatRequest, StrategyFromTextRequest


# ── broadcast_pattern depuis un thread worker ─────────────────────────────────

class TestBroadcastPatternThreadSafe:
    # Accédé via la classe (pas self) — sinon Python les binde comme méthodes
    _orig_broadcast = staticmethod(ws._broadcast_patterns)
    _orig_notify = staticmethod(ws._notify_api_pattern)

    def teardown_method(self):
        ws._broadcast_patterns = type(self)._orig_broadcast
        ws._notify_api_pattern = type(self)._orig_notify
        ws.set_main_loop(None)  # type: ignore[arg-type]
        ws._last_patterns.clear()

    def test_broadcast_from_worker_thread_delivers(self):
        """broadcast_pattern() appelé depuis un ThreadPoolExecutor ne doit
        plus perdre l'événement (RuntimeError avalé avant le fix)."""

        async def _run():
            ws.set_main_loop(asyncio.get_running_loop())
            received = []

            async def fake_broadcast(pattern):
                received.append(("ws", pattern["symbol"]))

            async def fake_notify(pattern):
                received.append(("api", pattern["symbol"]))

            ws._broadcast_patterns = fake_broadcast
            ws._notify_api_pattern = fake_notify

            done = threading.Event()

            def _worker():
                ws.broadcast_pattern({"symbol": "BTC/USDT", "pattern": "H&S"})
                done.set()

            t = threading.Thread(target=_worker)
            t.start()
            assert done.wait(timeout=2)
            t.join()
            # Laisse la loop traiter les call_soon_threadsafe
            for _ in range(20):
                await asyncio.sleep(0.01)
                if len(received) >= 2:
                    break
            return received

        received = asyncio.run(_run())
        assert ("ws", "BTC/USDT") in received
        assert ("api", "BTC/USDT") in received
        assert ws._last_patterns[-1]["symbol"] == "BTC/USDT"

    def test_broadcast_without_loop_still_records_pattern(self):
        """Sans loop capturée, le pattern est au moins enregistré dans
        _last_patterns (pas d'exception, pas de perte silencieuse totale)."""
        ws.set_main_loop(None)  # type: ignore[arg-type]
        ws.broadcast_pattern({"symbol": "ETH/USDT"})
        assert ws._last_patterns[-1]["symbol"] == "ETH/USDT"

    def test_broadcast_from_running_loop_unchanged(self):
        """Appel depuis la loop principale → comportement direct inchangé."""

        async def _run():
            received = []

            async def fake_broadcast(pattern):
                received.append(("ws", pattern["symbol"]))

            ws._broadcast_patterns = fake_broadcast
            ws.broadcast_pattern({"symbol": "SOL/USDT"})
            await asyncio.sleep(0.01)
            return received

        received = asyncio.run(_run())
        assert ("ws", "SOL/USDT") in received


# ── Caches bornés ─────────────────────────────────────────────────────────────

class TestBoundedTTLDict:
    def test_evicts_lru_beyond_maxsize(self):
        d = BoundedTTLDict(maxsize=3)
        d["a"] = 1
        d["b"] = 2
        d["c"] = 3
        _ = d["a"]  # touche 'a' → 'b' devient le plus ancien
        d["d"] = 4
        assert "b" not in d
        assert set(d.keys()) == {"a", "c", "d"}

    def test_overwrite_does_not_grow(self):
        d = BoundedTTLDict(maxsize=2)
        d["a"] = 1
        d["a"] = 2
        d["b"] = 3
        assert len(d) == 2
        assert d["a"] == 2


class TestMemCacheBound:
    def test_mem_cache_stays_bounded(self):
        _mem_cache.clear()
        for i in range(3000):
            mem_set(f"flood:{i}", i, ttl=3600)
        assert len(_mem_cache) <= 2048

    def test_mem_cache_expiry_still_works(self):
        _mem_cache.clear()
        mem_set("exp", "v", ttl=0)
        time.sleep(0.001)
        assert mem_get("exp") is None


# ── Bornes LLM ────────────────────────────────────────────────────────────────

class TestLlmRequestBounds:
    def test_chat_message_max_length(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="x" * 5000)

    def test_chat_history_max_items(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="hi", history=[{"role": "user", "content": "x"}] * 25)

    def test_chat_valid_payload_accepted(self):
        req = ChatRequest(message="analyse BTC", history=[{"role": "user", "content": "ctx"}])
        assert req.message == "analyse BTC"

    def test_strategy_description_bounded(self):
        with pytest.raises(ValidationError):
            StrategyFromTextRequest(description="x" * 3000)
        with pytest.raises(ValidationError):
            StrategyFromTextRequest(description="ab")  # min_length=3
