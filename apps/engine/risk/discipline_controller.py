"""
Discipline Controller — Central orchestrator for all risk modules.

Integrates:
  - Position Sizer (size calculation)
  - Kill-Switch (emergency halt)
  - Correlation Manager (position concentration)
  - Drawdown Manager (progressive size reduction)
  - Cooldown (post-loss pauses)
  - Regime Filter (strategy-regime compatibility)
  - Performance Monitor (edge degradation)
  - Tail Risk (VaR/CVaR crisis mode)
  - Trailing Stop (per-position stop management)

The controller provides a single `evaluate()` method that runs all
checks and returns a comprehensive decision: can trade, at what size,
with what adjustments, and why.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from enum import Enum

from risk.position_sizer import PositionSizer, SizingConfig, SizingResult
from risk.kill_switch import KillSwitch, KillSwitchConfig, KillSwitchState
from risk.correlation_manager import CorrelationManager, CorrelationConfig
from risk.drawdown_manager import DrawdownManager, DrawdownConfig
from risk.cooldown import CooldownManager, CooldownConfig
from risk.regime_filter import RegimeFilter, RegimeFilterConfig
from risk.performance_monitor import PerformanceMonitor, PerformanceConfig
from risk.tail_risk import TailRiskManager, TailRiskConfig


class TradeDecision(Enum):
    APPROVED = "APPROVED"
    REDUCED = "REDUCED"
    BLOCKED = "BLOCKED"


@dataclass
class RiskAssessment:
    decision: TradeDecision
    size_multiplier: float          # Final size multiplier (0-1+)
    adjusted_score: float           # Signal score after regime filter
    risk_pct: float                 # Effective risk % of capital
    factors: dict = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    kill_switch_state: str = ""
    cooldown_state: str = ""
    drawdown_level: str = ""
    crisis_mode: bool = False


class DisciplineController:
    """
    Central risk orchestrator.

    Usage:
        controller = DisciplineController(capital=10_000)
        assessment = controller.evaluate(
            symbol="EUR/USD",
            direction="BUY",
            entry=1.0850,
            stop_loss=1.0820,
            atr_pct=0.8,
            signal_score=0.75,
            strategy="trend_follow",
            regime="TRENDING_BULL",
        )
        if assessment.decision == TradeDecision.APPROVED:
            # Place trade with assessment.risk_pct
    """

    def __init__(
        self,
        capital: float,
        risk_pct: float = 1.0,
        sizing_config: Optional[SizingConfig] = None,
        kill_switch_config: Optional[KillSwitchConfig] = None,
        correlation_config: Optional[CorrelationConfig] = None,
        drawdown_config: Optional[DrawdownConfig] = None,
        cooldown_config: Optional[CooldownConfig] = None,
        regime_filter_config: Optional[RegimeFilterConfig] = None,
        performance_config: Optional[PerformanceConfig] = None,
        tail_risk_config: Optional[TailRiskConfig] = None,
    ):
        self.sizer = PositionSizer(capital, risk_pct, sizing_config)
        self.kill_switch = KillSwitch(capital, kill_switch_config)
        self.correlation = CorrelationManager(correlation_config)
        self.drawdown = DrawdownManager(capital, drawdown_config)
        self.cooldown = CooldownManager(cooldown_config)
        self.regime_filter = RegimeFilter(regime_filter_config)
        self.performance = PerformanceMonitor(performance_config)
        self.tail_risk = TailRiskManager(tail_risk_config)
        self._current_capital = capital

    def update_capital(self, current_capital: float) -> None:
        """Update capital across all modules after realized PnL."""
        self._current_capital = max(current_capital, 0.0)
        self.sizer.update_capital(current_capital)
        self.kill_switch.update(current_capital)
        self.drawdown.update(current_capital)

    def record_trade_result(self, pnl: float) -> None:
        """Record a trade result across all tracking modules."""
        self.kill_switch.record_trade_result(pnl)
        self.performance.record_trade(pnl, self._current_capital)
        if pnl < 0:
            self.cooldown.record_loss()
        elif pnl > 0:
            self.cooldown.record_win()

    def record_daily_return(self, return_pct: float) -> None:
        """Record daily portfolio return for tail risk."""
        self.tail_risk.record_return(return_pct)

    def evaluate(
        self,
        symbol: str,
        direction: str,
        entry: float,
        stop_loss: float,
        atr_pct: float = 0.0,
        signal_score: float = 0.7,
        strategy: str = "default",
        regime: str = "UNKNOWN",
        now: Optional[datetime] = None,
    ) -> RiskAssessment:
        """
        Run all risk checks and return a comprehensive assessment.

        This is the main entry point for pre-trade risk evaluation.
        """
        now = now or datetime.utcnow()
        reasons: list[str] = []
        factors: dict = {}
        size_multiplier = 1.0
        adjusted_score = signal_score

        # 1. Kill-switch check
        ks_status = self.kill_switch.update(self._current_capital, now)
        can_trade, ks_reason = self.kill_switch.can_trade(now)
        if not can_trade:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=0.0,
                risk_pct=0.0,
                factors={"kill_switch": 0.0},
                reasons=[ks_reason],
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=self.drawdown.update(self._current_capital).level,
                crisis_mode=self.tail_risk.update().crisis_mode,
            )
        factors["kill_switch"] = 1.0
        if ks_status.state == KillSwitchState.RECOVERY:
            size_multiplier *= self.kill_switch.config.recovery_max_risk_pct / 100.0 / self.sizer.base_risk_pct * 100
            size_multiplier = min(size_multiplier, 1.0)
            reasons.append(f"Recovery mode: size capped at {self.kill_switch.config.recovery_max_risk_pct}%")

        # 2. Cooldown check
        can_trade, cd_reason = self.cooldown.can_trade(now)
        if not can_trade:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=0.0,
                risk_pct=0.0,
                factors={"cooldown": 0.0},
                reasons=[cd_reason],
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=self.drawdown.update(self._current_capital).level,
                crisis_mode=self.tail_risk.update().crisis_mode,
            )
        factors["cooldown"] = 1.0

        # 3. Performance check
        should_pause, perf_reason = self.performance.should_pause()
        if should_pause:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=0.0,
                risk_pct=0.0,
                factors={"performance": 0.0},
                reasons=[perf_reason],
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=self.drawdown.update(self._current_capital).level,
                crisis_mode=self.tail_risk.update().crisis_mode,
            )
        factors["performance"] = 1.0

        # 4. Regime filter
        rf_result = self.regime_filter.check(strategy, regime, signal_score)
        if not rf_result.allowed:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=0.0,
                risk_pct=0.0,
                factors={"regime": 0.0},
                reasons=[rf_result.reason],
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=self.drawdown.update(self._current_capital).level,
                crisis_mode=self.tail_risk.update().crisis_mode,
            )
        adjusted_score = rf_result.adjusted_score
        factors["regime"] = rf_result.compatibility
        if rf_result.compatibility < 0.5:
            reasons.append(rf_result.reason)

        # 5. Correlation check
        corr_status = self.correlation.check(symbol, direction)
        if corr_status.blocked:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=adjusted_score,
                risk_pct=0.0,
                factors={"correlation": 0.0},
                reasons=[f"Correlation block: {corr_status.correlated_open} correlated positions"],
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=self.drawdown.update(self._current_capital).level,
                crisis_mode=self.tail_risk.update().crisis_mode,
            )
        factors["correlation"] = corr_status.reduction_factor
        size_multiplier *= corr_status.reduction_factor
        if corr_status.correlated_open > 0:
            reasons.append(f"Correlation: {corr_status.correlated_open} correlated, factor={corr_status.reduction_factor}")

        # 6. Drawdown factor
        dd_status = self.drawdown.update(self._current_capital)
        factors["drawdown"] = dd_status.size_factor
        size_multiplier *= dd_status.size_factor
        if dd_status.level != "NORMAL":
            reasons.append(f"Drawdown {dd_status.current_dd_pct:.1f}% → {dd_status.level}, factor={dd_status.size_factor}")

        # 7. Tail risk / crisis mode
        tr_status = self.tail_risk.update()
        factors["tail_risk"] = tr_status.size_factor
        size_multiplier *= tr_status.size_factor
        if tr_status.crisis_mode:
            reasons.append(f"Crisis mode: VaR={tr_status.var_pct:.2f}%, factor={tr_status.size_factor}")

        # 8. Position sizing
        dd_pct = dd_status.current_dd_pct
        sizing = self.sizer.compute(
            entry=entry,
            stop_loss=stop_loss,
            atr_pct=atr_pct,
            signal_score=adjusted_score,
            drawdown_pct=dd_pct,
            correlated_open=corr_status.correlated_open,
        )

        if sizing.blocked:
            return RiskAssessment(
                decision=TradeDecision.BLOCKED,
                size_multiplier=0.0,
                adjusted_score=adjusted_score,
                risk_pct=0.0,
                factors={**factors, **sizing.factors},
                reasons=[sizing.block_reason] + reasons,
                kill_switch_state=ks_status.state.value,
                cooldown_state=self.cooldown.status(now).state.value,
                drawdown_level=dd_status.level,
                crisis_mode=tr_status.crisis_mode,
            )

        # Determine final decision
        if size_multiplier < 1.0 or adjusted_score < signal_score:
            decision = TradeDecision.REDUCED
        else:
            decision = TradeDecision.APPROVED

        return RiskAssessment(
            decision=decision,
            size_multiplier=round(size_multiplier, 3),
            adjusted_score=round(adjusted_score, 4),
            risk_pct=sizing.risk_pct_used,
            factors={**factors, **sizing.factors},
            reasons=reasons,
            kill_switch_state=ks_status.state.value,
            cooldown_state=self.cooldown.status(now).state.value,
            drawdown_level=dd_status.level,
            crisis_mode=tr_status.crisis_mode,
        )

    def register_position(self, symbol: str, direction: str) -> None:
        """Register a newly opened position."""
        self.correlation.register_position(symbol, direction)
        self.cooldown.record_trade()

    def unregister_position(self, symbol: str) -> None:
        """Unregister a closed position."""
        self.correlation.unregister_position(symbol)

    def get_status(self) -> dict:
        """Get a summary of all risk module statuses."""
        ks = self.kill_switch.update(self._current_capital)
        cd = self.cooldown.status()
        dd = self.drawdown.update(self._current_capital)
        tr = self.tail_risk.update()
        perf = self.performance.compute_stats()

        return {
            "kill_switch": {
                "state": ks.state.value,
                "daily_loss_pct": ks.daily_loss_pct,
                "drawdown_pct": ks.drawdown_pct,
                "consecutive_losses": ks.consecutive_losses,
                "reason": ks.reason,
            },
            "cooldown": {
                "state": cd.state.value,
                "remaining_seconds": cd.remaining_seconds,
                "trades_this_hour": cd.trades_this_hour,
                "consecutive_losses": cd.consecutive_losses,
            },
            "drawdown": {
                "level": dd.level,
                "current_dd_pct": dd.current_dd_pct,
                "size_factor": dd.size_factor,
                "in_recovery": dd.in_recovery,
            },
            "tail_risk": {
                "var_pct": tr.var_pct,
                "cvar_pct": tr.cvar_pct,
                "crisis_mode": tr.crisis_mode,
                "size_factor": tr.size_factor,
            },
            "performance": {
                "total_trades": perf.total_trades,
                "winrate": perf.winrate,
                "expectancy": perf.expectancy,
                "profit_factor": perf.profit_factor,
                "edge_health": perf.edge_health,
                "alerts": [a.value for a in perf.alerts],
            },
            "capital": self._current_capital,
        }
