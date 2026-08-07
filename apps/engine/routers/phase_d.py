"""
Phase D API Router — Market Memory, Feedback Loop, Multi-Agent System
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

router = APIRouter()


# ── Market Memory ────────────────────────────────────────────────────────────

class StorePatternRequest(BaseModel):
    symbol: str
    timeframe: str
    signal_type: str
    metadata: Dict[str, Any]
    signal_id: Optional[str] = None


class ResolvePatternRequest(BaseModel):
    pattern_id: str
    outcome: str  # win / loss / breakeven
    pnl_pct: float


class RecallPatternsRequest(BaseModel):
    symbol: str
    timeframe: str
    signal_type: str
    metadata: Dict[str, Any]
    limit: int = 10


@router.post("/memory/store")
async def store_pattern(body: StorePatternRequest):
    from ml.market_memory import store_pattern
    pattern_id = await store_pattern(
        body.symbol, body.timeframe, body.signal_type, body.metadata, body.signal_id,
    )
    return {"pattern_id": pattern_id, "stored": True}


@router.post("/memory/resolve")
async def resolve_pattern(body: ResolvePatternRequest):
    from ml.market_memory import resolve_pattern
    await resolve_pattern(body.pattern_id, body.outcome, body.pnl_pct)
    return {"resolved": True}


@router.post("/memory/recall")
async def recall_patterns(body: RecallPatternsRequest):
    from ml.market_memory import recall_similar_patterns
    patterns = await recall_similar_patterns(
        body.symbol, body.timeframe, body.signal_type, body.metadata, body.limit,
    )
    return {"patterns": patterns, "count": len(patterns)}


@router.post("/memory/stats")
async def pattern_stats(body: RecallPatternsRequest):
    from ml.market_memory import get_pattern_stats
    stats = await get_pattern_stats(body.symbol, body.timeframe, body.signal_type, body.metadata)
    return stats


@router.get("/memory/summary")
async def memory_summary():
    from ml.market_memory import get_memory_summary
    return get_memory_summary()


@router.post("/memory/init-db")
async def init_memory_db():
    from ml.market_memory import init_market_memory_db
    await init_market_memory_db()
    return {"initialized": True}


# ── Feedback Loop ────────────────────────────────────────────────────────────

class RegisterSignalRequest(BaseModel):
    signal_id: str
    symbol: str
    timeframe: str
    signal_type: str
    entry_price: float
    stop_loss: float
    take_profit1: Optional[float] = None
    metadata: Dict[str, Any] = {}


class FeedbackTickRequest(BaseModel):
    live_prices: Dict[str, float]


@router.post("/feedback/register")
async def register_signal(body: RegisterSignalRequest):
    from ml.feedback_loop import register_signal_for_tracking
    await register_signal_for_tracking(
        body.signal_id, body.symbol, body.timeframe, body.signal_type,
        body.entry_price, body.stop_loss, body.take_profit1, body.metadata,
    )
    return {"registered": True}


@router.post("/feedback/tick")
async def feedback_tick(body: FeedbackTickRequest):
    from ml.feedback_loop import feedback_loop_tick
    result = await feedback_loop_tick(body.live_prices)
    return result


@router.get("/feedback/stats")
async def feedback_stats():
    from ml.feedback_loop import get_feedback_stats
    return await get_feedback_stats()


# ── Multi-Agent System ───────────────────────────────────────────────────────

class AgentAnalyzeRequest(BaseModel):
    symbol: str
    market_data: Dict[str, Any] = {}


@router.post("/agents/analyze")
async def agents_analyze(body: AgentAnalyzeRequest):
    from ml.multi_agent import orchestrator
    signals = await orchestrator.run_all_agents(body.symbol, body.market_data)
    decision = orchestrator.orchestrate(signals, body.symbol)
    return {
        "action": decision.action,
        "confidence": decision.confidence,
        "symbol": decision.symbol,
        "consensus_score": decision.consensus_score,
        "contributing_agents": decision.contributing_agents,
        "conflicting_agents": decision.conflicting_agents,
        "reasoning": decision.reasoning,
        "signals": [
            {
                "agent": s.agent_name,
                "signal": s.signal_type,
                "confidence": s.confidence,
                "timeframe": s.timeframe,
                "entry": s.entry,
                "stop_loss": s.stop_loss,
                "take_profit": s.take_profit,
                "reasoning": s.reasoning,
            }
            for s in decision.signals
        ],
    }


@router.get("/agents/status")
async def agents_status():
    from ml.multi_agent import orchestrator
    return orchestrator.get_status()


class AgentPerformanceRequest(BaseModel):
    agent_name: str
    outcome: str


@router.post("/agents/performance")
async def update_agent_performance(body: AgentPerformanceRequest):
    from ml.multi_agent import orchestrator
    orchestrator.update_agent_performance(body.agent_name, body.outcome)
    return {"updated": True}
