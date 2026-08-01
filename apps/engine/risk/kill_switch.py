"""
Kill-Switch — Automatic trading halt on excessive losses.

Triggers:
  - Daily loss exceeds threshold (e.g. 2.5% of capital)
  - Max drawdown exceeds threshold (e.g. 10%)
  - Consecutive losses exceed threshold (e.g. 3)

States:
  - ACTIVE: Normal trading
  - HALTED: All new trades blocked
  - RECOVERY: Limited trading after cooldown period
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional


class KillSwitchState(Enum):
    ACTIVE = "ACTIVE"
    HALTED = "HALTED"
    RECOVERY = "RECOVERY"


@dataclass
class KillSwitchConfig:
    max_daily_loss_pct: float = 2.5        # % of capital
    max_drawdown_pct: float = 10.0         # % from peak
    max_consecutive_losses: int = 3
    recovery_cooldown_minutes: int = 60    # time before RECOVERY mode
    recovery_max_risk_pct: float = 0.5     # reduced risk in recovery
    recovery_max_trades: int = 2           # max trades in recovery period
    recovery_duration_minutes: int = 120   # how long recovery lasts before ACTIVE


@dataclass
class KillSwitchStatus:
    state: KillSwitchState
    daily_loss_pct: float = 0.0
    drawdown_pct: float = 0.0
    consecutive_losses: int = 0
    triggered_at: Optional[datetime] = None
    reason: str = ""
    recovery_trades_used: int = 0
    recovery_started_at: Optional[datetime] = None


class KillSwitch:
    """Monitors losses and halts trading when thresholds are breached."""

    def __init__(
        self,
        initial_capital: float,
        config: Optional[KillSwitchConfig] = None,
    ):
        self.config = config or KillSwitchConfig()
        self.peak_capital = initial_capital
        self.current_capital = initial_capital
        self.day_start_capital = initial_capital
        self.consecutive_losses = 0
        self.state = KillSwitchState.ACTIVE
        self.triggered_at: Optional[datetime] = None
        self.reason = ""
        self.recovery_trades_used = 0
        self.recovery_started_at: Optional[datetime] = None
        self._last_day_reset: Optional[datetime] = None

    def _check_recovery_transition(self, now: datetime) -> None:
        """Transition from HALTED → RECOVERY after cooldown, RECOVERY → ACTIVE after duration."""
        if self.state == KillSwitchState.HALTED and self.triggered_at:
            elapsed = (now - self.triggered_at).total_seconds() / 60
            if elapsed >= self.config.recovery_cooldown_minutes:
                self.state = KillSwitchState.RECOVERY
                self.recovery_started_at = now
                self.recovery_trades_used = 0

        if self.state == KillSwitchState.RECOVERY and self.recovery_started_at:
            elapsed = (now - self.recovery_started_at).total_seconds() / 60
            if elapsed >= self.config.recovery_duration_minutes:
                self.state = KillSwitchState.ACTIVE
                self.recovery_started_at = None
                self.recovery_trades_used = 0

    def _maybe_reset_day(self, now: datetime) -> None:
        """Reset daily loss tracking at day boundary."""
        if self._last_day_reset is None:
            self._last_day_reset = now
            self.day_start_capital = self.current_capital
            return
        if now.date() != self._last_day_reset.date():
            self.day_start_capital = self.current_capital
            self._last_day_reset = now

    def update(
        self,
        current_capital: float,
        now: Optional[datetime] = None,
    ) -> KillSwitchStatus:
        """
        Update capital tracking and check kill-switch conditions.

        Args:
            current_capital: Current portfolio capital (realized)
            now: Current timestamp (defaults to utcnow)
        """
        now = now or datetime.utcnow()
        self.current_capital = max(current_capital, 0.0)
        self.peak_capital = max(self.peak_capital, self.current_capital)
        self._maybe_reset_day(now)
        self._check_recovery_transition(now)

        daily_loss_pct = (
            (self.day_start_capital - self.current_capital) / self.day_start_capital * 100
            if self.day_start_capital > 0 else 0.0
        )
        drawdown_pct = (
            (self.peak_capital - self.current_capital) / self.peak_capital * 100
            if self.peak_capital > 0 else 0.0
        )

        # Only check triggers if ACTIVE
        if self.state == KillSwitchState.ACTIVE:
            if drawdown_pct >= self.config.max_drawdown_pct:
                self.state = KillSwitchState.HALTED
                self.triggered_at = now
                self.reason = f"Max drawdown {drawdown_pct:.1f}% ≥ {self.config.max_drawdown_pct:.1f}%"
            elif daily_loss_pct >= self.config.max_daily_loss_pct:
                self.state = KillSwitchState.HALTED
                self.triggered_at = now
                self.reason = f"Daily loss {daily_loss_pct:.1f}% ≥ {self.config.max_daily_loss_pct:.1f}%"
            elif self.consecutive_losses >= self.config.max_consecutive_losses:
                self.state = KillSwitchState.HALTED
                self.triggered_at = now
                self.reason = f"Consecutive losses {self.consecutive_losses} ≥ {self.config.max_consecutive_losses}"

        return KillSwitchStatus(
            state=self.state,
            daily_loss_pct=round(daily_loss_pct, 2),
            drawdown_pct=round(drawdown_pct, 2),
            consecutive_losses=self.consecutive_losses,
            triggered_at=self.triggered_at,
            reason=self.reason,
            recovery_trades_used=self.recovery_trades_used,
            recovery_started_at=self.recovery_started_at,
        )

    def record_trade_result(self, pnl: float) -> None:
        """Record a trade result to track consecutive losses."""
        if pnl < 0:
            self.consecutive_losses += 1
        elif pnl > 0:
            self.consecutive_losses = 0

    def can_trade(self, now: Optional[datetime] = None) -> tuple[bool, str]:
        """Check if new trades are allowed."""
        now = now or datetime.utcnow()
        self._check_recovery_transition(now)

        if self.state == KillSwitchState.HALTED:
            return False, f"Kill-switch HALTED: {self.reason}"

        if self.state == KillSwitchState.RECOVERY:
            if self.recovery_trades_used >= self.config.recovery_max_trades:
                return False, "Recovery trade limit reached"
            return True, "RECOVERY mode — reduced risk"

        return True, "ACTIVE"

    def consume_recovery_trade(self) -> None:
        """Mark a recovery trade as used."""
        if self.state == KillSwitchState.RECOVERY:
            self.recovery_trades_used += 1

    def reset(self) -> None:
        """Manual reset to ACTIVE state (admin override)."""
        self.state = KillSwitchState.ACTIVE
        self.triggered_at = None
        self.reason = ""
        self.recovery_trades_used = 0
        self.recovery_started_at = None
        self.consecutive_losses = 0
