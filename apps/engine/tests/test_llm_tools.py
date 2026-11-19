import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from routers import llm_tools


@pytest.mark.asyncio
async def test_get_hidden_gems_collecting():
    with patch("ml.hidden_gems._cache", {"gems": None, "ts": 0}):
        res = await llm_tools._get_hidden_gems(5)
        assert res["status"] == "collecting"


@pytest.mark.asyncio
async def test_get_hidden_gems_returns_top():
    cache = {"ts": 1e9, "gems": {"gems": [
        {"symbol": f"T{i}", "chain": "solana", "gem_score": 80 - i,
         "exec_check": {"sellable": True}, "warnings": []}
        for i in range(10)]}}
    with patch("ml.hidden_gems._cache", cache), patch("time.monotonic", return_value=1e9 + 60):
        res = await llm_tools._get_hidden_gems(3)
        assert res["count"] == 3
        assert res["gems"][0]["symbol"] == "T0"
        assert res["gems"][0]["sellable"] is True


@pytest.mark.asyncio
async def test_get_gem_paper_stats_truncates():
    fake = {"status": "ok", "open": [{"symbol": f"S{i}", "extra": "x"*500}
            for i in range(20)], "closed": [], "win_rate_pct": 50}
    with patch("ml.gem_paper_trader.paper_stats", AsyncMock(return_value=fake)):
        res = await llm_tools._get_gem_paper_stats()
        assert len(res["open"]) == 10
        assert "extra" not in res["open"][0]


@pytest.mark.asyncio
async def test_get_signal_performance_groups_by_symbol():
    pool = MagicMock()
    conn = pool.acquire.return_value.__aenter__.return_value
    conn.fetch = AsyncMock(return_value=[
        {"symbol": "BTC/USDT", "wins": 8, "losses": 2, "closed": 10, "avg_pnl_pct": 3.5}])
    with patch.object(llm_tools, "get_shared_pool", AsyncMock(return_value=pool)):
        res = await llm_tools._get_signal_performance(5)
        assert res["symbols"][0]["winrate_pct"] == 80.0
        assert res["symbols"][0]["symbol"] == "BTC/USDT"


@pytest.mark.asyncio
async def test_get_autopilot_summary_sanitized():
    pool = MagicMock()
    conn = pool.acquire.return_value.__aenter__.return_value
    conn.fetchrow = AsyncMock(return_value={
        "open_count": 3, "closed_count": 10, "wins": 6, "avg_pnl_pct": 1.2})
    with patch.object(llm_tools, "get_shared_pool", AsyncMock(return_value=pool)):
        res = await llm_tools._get_autopilot_summary()
        assert res == {"mode": "PAPER", "open_positions": 3,
                       "closed_trades": 10, "winrate_pct": 60.0, "avg_pnl_pct": 1.2}
        # pas de symboles/positions détaillées
        assert "positions" not in res


@pytest.mark.asyncio
async def test_get_venue_health_shadow():
    cfg = {"mode": "shadow", "live_venues": set(), "gate_fail_closed": False}
    with patch("risk.execution._exec_config", AsyncMock(return_value=cfg)), \
         patch("risk.execution.adapters_status", return_value={}):
        res = await llm_tools._get_venue_health()
        assert res["mode"] == "shadow"
        assert "note" in res


@pytest.mark.asyncio
async def test_run_tool_dispatch_and_json():
    with patch.object(llm_tools, "_get_venue_health", AsyncMock(return_value={"mode": "shadow"})):
        out = await llm_tools.run_tool("get_venue_health", "{}")
        import json
        assert json.loads(out)["mode"] == "shadow"
    out = await llm_tools.run_tool("nonexistent_tool", "{}")
    assert "error" in out
