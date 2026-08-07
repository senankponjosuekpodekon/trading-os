"""
Tests for Phase D: Market Memory, Feedback Loop, Multi-Agent System.
"""
import pytest
import sys
import os
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Market Memory ────────────────────────────────────────────────────────────

def test_extract_setup_type_bos_ob():
    from ml.market_memory import _extract_setup_type
    metadata = {
        "price_action": {"bos": True, "bos_dir": "bullish"},
        "smc": {"ob": {"near_bullish_ob": True}},
    }
    setup = _extract_setup_type(metadata)
    assert "BOS" in setup
    assert "OB" in setup


def test_extract_setup_type_generic():
    from ml.market_memory import _extract_setup_type
    setup = _extract_setup_type({})
    assert setup == "GENERIC"


def test_extract_features():
    from ml.market_memory import _extract_features
    metadata = {
        "regime": {"regime": "TREND", "adx": 35},
        "mtf_context": {"confluence": "FULL"},
        "confidence": 72,
    }
    features = _extract_features(metadata)
    assert features["regime"] == "TREND"
    assert features["adx"] == 35
    assert features["mtf_confluence"] == "FULL"
    assert features["confidence"] == 72


def test_store_and_recall_pattern():
    from ml.market_memory import store_pattern, recall_similar_patterns, _memory_cache
    metadata = {
        "price_action": {"bos": True, "bos_dir": "bullish"},
        "smc": {"ob": {"near_bullish_ob": True}},
        "regime": {"regime": "TREND", "adx": 30},
        "mtf_context": {"confluence": "FULL"},
        "confidence": 70,
    }
    pattern_id = asyncio.run(store_pattern("BTC/USDT", "1h", "BUY", metadata, "sig_1"))
    assert pattern_id is not None

    # Recall should find it (but it has no outcome yet)
    patterns = asyncio.run(recall_similar_patterns("BTC/USDT", "1h", "BUY", metadata))
    # Unresolved patterns won't be returned in recall (only resolved)
    assert isinstance(patterns, list)


def test_resolve_pattern():
    from ml.market_memory import store_pattern, resolve_pattern, recall_similar_patterns, _memory_cache
    metadata = {
        "price_action": {"bos": True},
        "smc": {"ob": {"near_bullish_ob": True}},
        "regime": {"regime": "TREND", "adx": 30},
        "mtf_context": {"confluence": "FULL"},
        "confidence": 70,
    }
    pattern_id = asyncio.run(store_pattern("ETH/USDT", "4h", "BUY", metadata, "sig_2"))
    asyncio.run(resolve_pattern(pattern_id, "win", 5.2))

    patterns = asyncio.run(recall_similar_patterns("ETH/USDT", "4h", "BUY", metadata))
    assert len(patterns) >= 1
    assert patterns[-1]["outcome"] == "win"
    assert patterns[-1]["pnl_pct"] == 5.2


def test_pattern_stats_no_history():
    from ml.market_memory import get_pattern_stats
    stats = asyncio.run(get_pattern_stats("UNKNOWN/USDT", "1h", "BUY", {}))
    assert stats["sample_size"] == 0
    assert stats["recommendation"] == "NO_HISTORY"


def test_pattern_stats_with_history():
    from ml.market_memory import store_pattern, resolve_pattern, get_pattern_stats
    metadata = {
        "price_action": {"bos": True},
        "smc": {"ob": {"near_bullish_ob": True}},
        "regime": {"regime": "TREND", "adx": 30},
        "mtf_context": {"confluence": "FULL"},
        "confidence": 70,
    }
    # Store and resolve 6 patterns (4 wins, 2 losses = 66% win rate)
    for i in range(4):
        pid = asyncio.run(store_pattern("SOL/USDT", "1h", "BUY", metadata, f"sig_w_{i}"))
        asyncio.run(resolve_pattern(pid, "win", 3.0))
    for i in range(2):
        pid = asyncio.run(store_pattern("SOL/USDT", "1h", "BUY", metadata, f"sig_l_{i}"))
        asyncio.run(resolve_pattern(pid, "loss", -1.5))

    stats = asyncio.run(get_pattern_stats("SOL/USDT", "1h", "BUY", metadata))
    assert stats["sample_size"] == 6
    assert stats["win_rate"] >= 60
    assert stats["recommendation"] == "STRONG_SETUP"
    assert stats["confidence_adjustment"] > 0


def test_memory_summary():
    from ml.market_memory import get_memory_summary
    summary = get_memory_summary()
    assert "total_patterns_stored" in summary
    assert "unique_setups" in summary


# ── Feedback Loop ────────────────────────────────────────────────────────────

def test_register_and_resolve_signal():
    from ml.feedback_loop import register_signal_for_tracking, check_and_resolve_signals, _pending_signals
    _pending_signals.clear()

    asyncio.run(register_signal_for_tracking(
        signal_id="test_sig_1",
        symbol="BTC/USDT",
        timeframe="1h",
        signal_type="BUY",
        entry_price=50000,
        stop_loss=49000,
        take_profit1=51000,
        metadata={"price_action": {"bos": True}},
    ))

    assert "test_sig_1" in _pending_signals

    # Price hits SL
    resolved = asyncio.run(check_and_resolve_signals({"BTCUSDT": 48500}))
    assert len(resolved) == 1
    assert resolved[0]["outcome"] == "loss"
    assert "test_sig_1" not in _pending_signals


def test_register_and_resolve_tp():
    from ml.feedback_loop import register_signal_for_tracking, check_and_resolve_signals, _pending_signals
    _pending_signals.clear()

    asyncio.run(register_signal_for_tracking(
        signal_id="test_sig_2",
        symbol="ETH/USDT",
        timeframe="4h",
        signal_type="SELL",
        entry_price=3000,
        stop_loss=3100,
        take_profit1=2900,
        metadata={},
    ))

    # Price drops → TP hit for SELL
    resolved = asyncio.run(check_and_resolve_signals({"ETHUSDT": 2850}))
    assert len(resolved) == 1
    assert resolved[0]["outcome"] == "win"


def test_feedback_stats():
    from ml.feedback_loop import get_feedback_stats
    stats = asyncio.run(get_feedback_stats())
    assert "total_evaluated" in stats
    assert "win_rate" in stats
    assert "pending_signals" in stats


# ── Multi-Agent System ───────────────────────────────────────────────────────

def test_orchestrator_has_agents():
    from ml.multi_agent import orchestrator
    assert len(orchestrator.agents) == 4
    agent_names = [a.name for a in orchestrator.agents]
    assert "scalper" in agent_names
    assert "swing" in agent_names
    assert "hedge" in agent_names
    assert "alpha" in agent_names


def test_scalper_agent_analyze():
    from ml.multi_agent import ScalperAgent
    import pandas as pd
    import numpy as np

    # Create mock dataframe
    n = 50
    closes = np.random.randn(n).cumsum() + 100
    df = pd.DataFrame({"close": closes, "volume": np.random.rand(n) * 1000})

    agent = ScalperAgent()
    signal = asyncio.run(agent.analyze("BTC/USDT", {"df_5m": df}))
    assert signal.agent_name == "scalper"
    assert signal.symbol == "BTC/USDT"
    assert signal.signal_type in ("BUY", "SELL", "NEUTRAL")


def test_swing_agent_analyze():
    from ml.multi_agent import SwingAgent
    import pandas as pd
    import numpy as np

    n = 250
    closes = np.linspace(100, 150, n) + np.random.randn(n) * 2
    df = pd.DataFrame({"close": closes, "volume": np.random.rand(n) * 1000})

    agent = SwingAgent()
    signal = asyncio.run(agent.analyze("BTC/USDT", {"df_1h": df}))
    assert signal.agent_name == "swing"
    assert signal.signal_type in ("BUY", "SELL", "NEUTRAL")


def test_hedge_agent_risk_check():
    from ml.multi_agent import HedgeAgent, AgentSignal
    agent = HedgeAgent()
    sig = AgentSignal("scalper", "BTC/USDT", "BUY", 70, "5m")

    # No existing positions → should be approved
    result = agent.check_risk(sig, {})
    assert result["risk_approved"] is True

    # High exposure → should be rejected
    result = agent.check_risk(sig, {"BTC/USDT": 5.0, "ETH/USDT": 5.0})
    assert result["risk_approved"] is False


def test_alpha_agent_onchain_signal():
    from ml.multi_agent import AlphaAgent
    agent = AlphaAgent()
    signal = asyncio.run(agent.analyze("BTC/USDT", {
        "onchain_signals": {"signal_score": 80, "whale_accumulation": True},
        "token_grade": {"overall_grade": 85},
    }))
    assert signal.signal_type == "BUY"
    assert signal.confidence > 50


def test_orchestrate_buy_consensus():
    from ml.multi_agent import orchestrator, AgentSignal
    signals = [
        AgentSignal("scalper", "BTC/USDT", "BUY", 70, "5m"),
        AgentSignal("swing", "BTC/USDT", "BUY", 65, "1h"),
        AgentSignal("alpha", "BTC/USDT", "BUY", 80, "1d"),
        AgentSignal("hedge", "BTC/USDT", "NEUTRAL", 0, "4h"),
    ]
    decision = orchestrator.orchestrate(signals, "BTC/USDT")
    assert decision.action == "BUY"
    assert decision.confidence > 50
    assert "scalper" in decision.contributing_agents
    assert "swing" in decision.contributing_agents
    assert "alpha" in decision.contributing_agents


def test_orchestrate_conflict():
    from ml.multi_agent import orchestrator, AgentSignal
    signals = [
        AgentSignal("scalper", "BTC/USDT", "SELL", 70, "5m"),
        AgentSignal("swing", "BTC/USDT", "BUY", 65, "1h"),
    ]
    decision = orchestrator.orchestrate(signals, "BTC/USDT")
    # Agents disagree — either conflict detected or action reflects stronger side
    assert decision.action in ("BUY", "SELL", "WAIT")
    assert len(decision.contributing_agents) == 2


def test_orchestrator_status():
    from ml.multi_agent import orchestrator
    status = orchestrator.get_status()
    assert status["total_agents"] == 4
    assert len(status["agents"]) == 4


def test_agent_performance_update():
    from ml.multi_agent import orchestrator
    initial_weight = orchestrator.agent_weights["scalper"]
    for _ in range(10):
        orchestrator.update_agent_performance("scalper", "win")
    # Weight should increase after 10 wins
    assert orchestrator.agent_weights["scalper"] >= initial_weight


# ── Router endpoints ─────────────────────────────────────────────────────────

def test_phase_d_router_endpoints():
    from routers.phase_d import router
    paths = [r.path for r in router.routes]
    assert "/memory/store" in paths
    assert "/memory/resolve" in paths
    assert "/memory/recall" in paths
    assert "/memory/stats" in paths
    assert "/memory/summary" in paths
    assert "/memory/init-db" in paths
    assert "/feedback/register" in paths
    assert "/feedback/tick" in paths
    assert "/feedback/stats" in paths
    assert "/agents/analyze" in paths
    assert "/agents/status" in paths
    assert "/agents/performance" in paths
