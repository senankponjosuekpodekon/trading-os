"""
Multi-Agent Trading System — Phase D
Autonomous agents that specialize in different trading styles and coordinate
to produce a unified trading strategy.

Agents:
- ScalperAgent: Short timeframe (1m-5m), high frequency, tight SL
- SwingAgent: Medium timeframe (1h-4h), trend following, wider SL
- HedgeAgent: Risk management, correlation hedging, position sizing
- AlphaAgent: Pre-listing & on-chain alpha hunter

Each agent runs independently but shares a common state (positions, exposure).
The Orchestrator aggregates their signals and produces a unified recommendation.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class AgentSignal:
    agent_name: str
    symbol: str
    signal_type: str  # BUY / SELL / NEUTRAL
    confidence: float
    timeframe: str
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    reasoning: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


@dataclass
class OrchestratedDecision:
    action: str  # BUY / SELL / WAIT
    confidence: float
    symbol: str
    contributing_agents: List[str]
    conflicting_agents: List[str]
    consensus_score: float
    reasoning: str
    signals: List[AgentSignal]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BaseAgent:
    """Base class for all trading agents."""

    name: str = "base"
    description: str = ""
    preferred_timeframes: List[str] = []
    max_risk_pct: float = 1.0

    async def analyze(self, symbol: str, market_data: Dict[str, Any]) -> AgentSignal:
        raise NotImplementedError

    def can_trade(self, current_exposure: Dict[str, float]) -> bool:
        total_exposure = sum(current_exposure.values())
        return total_exposure < 10.0  # Max 10% total exposure


class ScalperAgent(BaseAgent):
    """Short-term scalping agent — fast entries/exits on 1m-5m."""

    name = "scalper"
    description = "Scalper: 1m-5m timeframe, tight SL, high frequency"
    preferred_timeframes = ["1m", "3m", "5m"]
    max_risk_pct = 0.5

    async def analyze(self, symbol: str, market_data: Dict[str, Any]) -> AgentSignal:
        df = market_data.get("df_5m")
        if df is None:
            df = market_data.get("df_1m")
        if df is None or len(df) < 10:
            return AgentSignal(self.name, symbol, "NEUTRAL", 0, "5m", reasoning="Insufficient data")

        close = float(df["close"].iloc[-1])
        sma_fast = float(df["close"].rolling(5).mean().iloc[-1])
        sma_slow = float(df["close"].rolling(20).mean().iloc[-1])
        rsi = 50.0
        if len(df) >= 14:
            delta = df["close"].diff()
            gain = float(delta.clip(lower=0).rolling(14).mean().iloc[-1])
            loss = float((-delta.clip(upper=0)).rolling(14).mean().iloc[-1])
            rs = gain / loss if loss > 0 else 100
            rsi = 100 - (100 / (1 + rs))

        signal_type = "NEUTRAL"
        confidence = 30.0
        reasoning = ""

        if sma_fast > sma_slow and rsi < 70:
            signal_type = "BUY"
            confidence = min(80, 40 + (100 - rsi) * 0.3)
            reasoning = f"Scalp long: SMA5>SMA20, RSI {rsi:.0f}"
        elif sma_fast < sma_slow and rsi > 30:
            signal_type = "SELL"
            confidence = min(80, 40 + rsi * 0.3)
            reasoning = f"Scalp short: SMA5<SMA20, RSI {rsi:.0f}"
        else:
            signal_type = "NEUTRAL"
            confidence = 30.0
            reasoning = f"Scalp: no clear signal (RSI {rsi:.0f})"

        atr = float(df["close"].rolling(14).std().iloc[-1]) if len(df) >= 14 else close * 0.005

        return AgentSignal(
            self.name, symbol, signal_type, confidence, "5m",
            entry=close,
            stop_loss=close - 1.5 * atr if signal_type == "BUY" else close + 1.5 * atr,
            take_profit=close + 2 * atr if signal_type == "BUY" else close - 2 * atr,
            reasoning=reasoning,
        )


class SwingAgent(BaseAgent):
    """Medium-term swing trading agent — trend following on 1h-4h."""

    name = "swing"
    description = "Swing: 1h-4h timeframe, trend following, wider SL"
    preferred_timeframes = ["1h", "4h"]
    max_risk_pct = 2.0

    async def analyze(self, symbol: str, market_data: Dict[str, Any]) -> AgentSignal:
        df = market_data.get("df_1h")
        if df is None:
            df = market_data.get("df_4h")
        if df is None or len(df) < 20:
            return AgentSignal(self.name, symbol, "NEUTRAL", 0, "1h", reasoning="Insufficient data")

        close = float(df["close"].iloc[-1])
        ema20 = float(df["close"].ewm(span=20).mean().iloc[-1])
        ema50 = float(df["close"].ewm(span=50).mean().iloc[-1])
        ema200 = float(df["close"].ewm(span=200).mean().iloc[-1]) if len(df) >= 200 else ema50

        # Guard against NaN
        if any(v != v for v in (ema20, ema50, ema200)):
            return AgentSignal(self.name, symbol, "NEUTRAL", 0, "1h", reasoning="NaN in EMA calc")

        signal_type = "NEUTRAL"
        confidence = 30.0
        reasoning = ""

        # Trend alignment
        if ema20 > ema50 > ema200:
            signal_type = "BUY"
            confidence = 65.0
            reasoning = "Swing long: EMA20>50>200, strong uptrend"
        elif ema20 < ema50 < ema200:
            signal_type = "SELL"
            confidence = 65.0
            reasoning = "Swing short: EMA20<50<200, strong downtrend"
        elif ema20 > ema50:
            signal_type = "BUY"
            confidence = 45.0
            reasoning = "Swing long (weak): EMA20>50 only"
        elif ema20 < ema50:
            signal_type = "SELL"
            confidence = 45.0
            reasoning = "Swing short (weak): EMA20<50 only"

        atr = float(df["close"].rolling(20).std().iloc[-1]) if len(df) >= 20 else close * 0.02

        return AgentSignal(
            self.name, symbol, signal_type, confidence, "1h",
            entry=close,
            stop_loss=close - 3 * atr if signal_type == "BUY" else close + 3 * atr,
            take_profit=close + 6 * atr if signal_type == "BUY" else close - 6 * atr,
            reasoning=reasoning,
        )


class HedgeAgent(BaseAgent):
    """Risk management agent — checks exposure and suggests hedges."""

    name = "hedge"
    description = "Hedge: risk management, correlation hedging, position sizing"
    preferred_timeframes = ["4h", "1d"]
    max_risk_pct = 1.0

    async def analyze(self, symbol: str, market_data: Dict[str, Any]) -> AgentSignal:
        # This agent doesn't generate directional signals
        # It validates other agents' signals and suggests hedges
        return AgentSignal(
            self.name, symbol, "NEUTRAL", 0, "4h",
            reasoning="Hedge agent: validates risk, suggests hedges",
        )

    def check_risk(
        self, proposed_signal: AgentSignal, current_positions: Dict[str, float],
    ) -> Dict[str, Any]:
        """Check if a proposed signal is within risk limits."""
        total_exposure = sum(abs(v) for v in current_positions.values())
        symbol_exposure = abs(current_positions.get(proposed_signal.symbol, 0))

        risk_ok = total_exposure < 10.0 and symbol_exposure < 3.0

        return {
            "risk_approved": risk_ok,
            "total_exposure_pct": round(total_exposure, 2),
            "symbol_exposure_pct": round(symbol_exposure, 2),
            "max_total_exposure": 10.0,
            "max_symbol_exposure": 3.0,
            "suggested_size_pct": min(self.max_risk_pct, 10.0 - total_exposure),
        }


class AlphaAgent(BaseAgent):
    """Pre-listing & on-chain alpha hunter."""

    name = "alpha"
    description = "Alpha: pre-listing, on-chain whale accumulation, hidden gems"
    preferred_timeframes = ["1d"]
    max_risk_pct = 3.0

    async def analyze(self, symbol: str, market_data: Dict[str, Any]) -> AgentSignal:
        onchain = market_data.get("onchain_signals", {})
        token_grade = market_data.get("token_grade", {})

        signal_type = "NEUTRAL"
        confidence = 30.0
        reasoning = "No alpha signal"

        if onchain.get("signal_score", 0) >= 70 and onchain.get("whale_accumulation"):
            signal_type = "BUY"
            confidence = min(85, onchain.get("signal_score", 50))
            reasoning = f"Alpha: whale accumulation detected (score {onchain.get('signal_score')})"

        if token_grade.get("overall_grade", 0) >= 75:
            if signal_type == "BUY":
                confidence = min(90, confidence + 10)
                reasoning += f" + Token grade {token_grade.get('overall_grade')}"
            else:
                signal_type = "BUY"
                confidence = 60.0
                reasoning = f"Alpha: high token grade ({token_grade.get('overall_grade')})"

        return AgentSignal(
            self.name, symbol, signal_type, confidence, "1d",
            reasoning=reasoning,
        )


class Orchestrator:
    """
    Aggregates signals from all agents and produces a unified decision.
    Uses weighted voting based on agent confidence and historical performance.
    """

    def __init__(self):
        self.agents: List[BaseAgent] = [
            ScalperAgent(),
            SwingAgent(),
            HedgeAgent(),
            AlphaAgent(),
        ]
        self.agent_weights: Dict[str, float] = {
            "scalper": 0.8,
            "swing": 1.2,
            "hedge": 1.0,
            "alpha": 1.5,
        }
        self.agent_performance: Dict[str, Dict[str, float]] = {
            name: {"wins": 0, "losses": 0} for name in self.agent_weights
        }

    async def run_all_agents(
        self, symbol: str, market_data: Dict[str, Any],
    ) -> List[AgentSignal]:
        """Run all agents in parallel and collect their signals."""
        tasks = [agent.analyze(symbol, market_data) for agent in self.agents]
        signals = await asyncio.gather(*tasks, return_exceptions=True)

        results: List[AgentSignal] = []
        for i, sig in enumerate(signals):
            if isinstance(sig, Exception):
                logger.warning("agent_failed", agent=self.agents[i].name, error=str(sig))
                results.append(AgentSignal(self.agents[i].name, symbol, "NEUTRAL", 0, "1h", reasoning=f"Error: {sig}"))
            else:
                results.append(sig)

        return results

    def orchestrate(self, signals: List[AgentSignal], symbol: str) -> OrchestratedDecision:
        """Aggregate agent signals into a unified decision."""
        buy_score = 0.0
        sell_score = 0.0
        total_weight = 0.0
        contributing: List[str] = []
        conflicting: List[str] = []

        for sig in signals:
            if sig.signal_type == "NEUTRAL":
                continue

            weight = self.agent_weights.get(sig.agent_name, 1.0)
            score = sig.confidence * weight
            total_weight += weight

            if sig.signal_type == "BUY":
                buy_score += score
                contributing.append(sig.agent_name)
            elif sig.signal_type == "SELL":
                sell_score += score
                contributing.append(sig.agent_name)

        # Check for conflicts
        buy_agents = [s.agent_name for s in signals if s.signal_type == "BUY"]
        sell_agents = [s.agent_name for s in signals if s.signal_type == "SELL"]
        if buy_agents and sell_agents:
            conflicting = list(set(buy_agents) & set(sell_agents))

        # Determine action
        if buy_score > sell_score and buy_score > 50:
            action = "BUY"
            confidence = min(95, buy_score / max(total_weight, 1))
            consensus_score = buy_score / max(buy_score + sell_score, 1) * 100
        elif sell_score > buy_score and sell_score > 50:
            action = "SELL"
            confidence = min(95, sell_score / max(total_weight, 1))
            consensus_score = sell_score / max(buy_score + sell_score, 1) * 100
        else:
            action = "WAIT"
            confidence = 0
            consensus_score = 0

        reasoning_parts = [f"{s.agent_name}: {s.reasoning}" for s in signals if s.signal_type != "NEUTRAL"]

        return OrchestratedDecision(
            action=action,
            confidence=round(confidence, 1),
            symbol=symbol,
            contributing_agents=contributing,
            conflicting_agents=conflicting,
            consensus_score=round(consensus_score, 1),
            reasoning=" | ".join(reasoning_parts),
            signals=signals,
        )

    def update_agent_performance(self, agent_name: str, outcome: str) -> None:
        """Update agent performance tracking after signal resolution."""
        if agent_name in self.agent_performance:
            if outcome == "win":
                self.agent_performance[agent_name]["wins"] += 1
            elif outcome == "loss":
                self.agent_performance[agent_name]["losses"] += 1

            # Adjust weight based on performance
            stats = self.agent_performance[agent_name]
            total = stats["wins"] + stats["losses"]
            if total >= 10:
                win_rate = stats["wins"] / total
                if win_rate > 0.6:
                    self.agent_weights[agent_name] = min(2.0, self.agent_weights[agent_name] * 1.1)
                elif win_rate < 0.4:
                    self.agent_weights[agent_name] = max(0.3, self.agent_weights[agent_name] * 0.9)

    def get_status(self) -> Dict[str, Any]:
        """Get orchestrator status and agent performance."""
        return {
            "agents": [
                {
                    "name": a.name,
                    "description": a.description,
                    "weight": self.agent_weights.get(a.name, 1.0),
                    "performance": self.agent_performance.get(a.name, {}),
                }
                for a in self.agents
            ],
            "total_agents": len(self.agents),
        }


# Singleton orchestrator
orchestrator = Orchestrator()
