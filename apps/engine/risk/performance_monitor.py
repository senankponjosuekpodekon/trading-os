"""
Performance Monitor — Track strategy performance and detect edge degradation.

Metrics tracked:
  - Win rate
  - Expectancy (avg win × winrate - avg loss × lossrate)
  - Profit factor (gross profit / gross loss)
  - Max consecutive losses
  - Rolling Sharpe-like ratio
  - Edge degradation detection (rolling window comparison)

Alerts:
  - Win rate below threshold
  - Expectancy negative
  - Profit factor < 1.0
  - Edge degradation (recent performance << historical)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from collections import deque
from enum import Enum


class PerformanceAlert(Enum):
    NONE = "NONE"
    LOW_WINRATE = "LOW_WINRATE"
    NEGATIVE_EXPECTANCY = "NEGATIVE_EXPECTANCY"
    LOW_PROFIT_FACTOR = "LOW_PROFIT_FACTOR"
    EDGE_DEGRADATION = "EDGE_DEGRADATION"
    MAX_DRAWDOWN = "MAX_DRAWDOWN"


@dataclass
class PerformanceConfig:
    rolling_window: int = 50           # Trades in rolling window
    min_winrate: float = 0.40         # Alert if below
    min_expectancy: float = 0.0        # Alert if negative
    min_profit_factor: float = 1.0    # Alert if below
    degradation_threshold: float = 0.5  # Alert if recent/historical < 50%
    max_consecutive_losses: int = 5   # Alert if reached
    historical_window: int = 200      # Window for historical baseline


@dataclass
class PerformanceStats:
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    winrate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    expectancy: float = 0.0
    profit_factor: float = 0.0
    max_consecutive_losses: int = 0
    current_consecutive_losses: int = 0
    total_pnl: float = 0.0
    rolling_winrate: float = 0.0
    rolling_expectancy: float = 0.0
    alerts: list[PerformanceAlert] = field(default_factory=list)
    edge_health: str = "UNKNOWN"  # "HEALTHY", "DEGRADING", "DEGRADED"


class PerformanceMonitor:
    """Track trade results and detect strategy edge degradation."""

    def __init__(self, config: Optional[PerformanceConfig] = None):
        self.config = config or PerformanceConfig()
        self._all_trades: list[float] = []  # All PnL values
        self._rolling_trades: deque[float] = deque(maxlen=config.rolling_window if config else 50)
        self._consecutive_losses = 0
        self._max_consecutive_losses = 0
        self._peak_capital: float = 0.0
        self._current_capital: float = 0.0

    def record_trade(self, pnl: float, current_capital: Optional[float] = None) -> None:
        """Record a trade result."""
        self._all_trades.append(pnl)
        self._rolling_trades.append(pnl)

        if pnl < 0:
            self._consecutive_losses += 1
            self._max_consecutive_losses = max(self._max_consecutive_losses, self._consecutive_losses)
        elif pnl > 0:
            self._consecutive_losses = 0

        if current_capital is not None:
            self._current_capital = current_capital
            self._peak_capital = max(self._peak_capital, current_capital)

    def compute_stats(self) -> PerformanceStats:
        """Compute current performance statistics."""
        all_trades = self._all_trades
        rolling = list(self._rolling_trades)

        if not all_trades:
            return PerformanceStats()

        total = len(all_trades)
        wins = [t for t in all_trades if t > 0]
        losses = [t for t in all_trades if t < 0]

        winrate = len(wins) / total if total > 0 else 0.0
        avg_win = sum(wins) / len(wins) if wins else 0.0
        avg_loss = abs(sum(losses) / len(losses)) if losses else 0.0
        expectancy = (avg_win * winrate) - (avg_loss * (1 - winrate))

        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf') if gross_profit > 0 else 0.0

        total_pnl = sum(all_trades)

        # Rolling stats
        r_wins = [t for t in rolling if t > 0]
        r_losses = [t for t in rolling if t < 0]
        r_total = len(rolling)
        r_winrate = len(r_wins) / r_total if r_total > 0 else 0.0
        r_avg_win = sum(r_wins) / len(r_wins) if r_wins else 0.0
        r_avg_loss = abs(sum(r_losses) / len(r_losses)) if r_losses else 0.0
        r_expectancy = (r_avg_win * r_winrate) - (r_avg_loss * (1 - r_winrate))

        # Edge degradation detection
        edge_health = "HEALTHY"
        if len(all_trades) >= self.config.historical_window and r_total >= self.config.rolling_window // 2:
            historical = all_trades[:-len(rolling)] if len(all_trades) > len(rolling) else all_trades
            h_wins = [t for t in historical if t > 0]
            h_losses = [t for t in historical if t < 0]
            h_avg_win = sum(h_wins) / len(h_wins) if h_wins else 0.0
            h_avg_loss = abs(sum(h_losses) / len(h_losses)) if h_losses else 0.0
            h_winrate = len(h_wins) / len(historical) if historical else 0.0
            h_expectancy = (h_avg_win * h_winrate) - (h_avg_loss * (1 - h_winrate))

            if h_expectancy != 0:
                ratio = r_expectancy / h_expectancy if h_expectancy != 0 else 1.0
                if ratio < self.config.degradation_threshold:
                    edge_health = "DEGRADED"
                elif ratio < 0.8:
                    edge_health = "DEGRADING"

        # Alerts
        alerts: list[PerformanceAlert] = []
        if winrate < self.config.min_winrate and total >= 10:
            alerts.append(PerformanceAlert.LOW_WINRATE)
        if expectancy < self.config.min_expectancy and total >= 10:
            alerts.append(PerformanceAlert.NEGATIVE_EXPECTANCY)
        if profit_factor < self.config.min_profit_factor and total >= 10:
            alerts.append(PerformanceAlert.LOW_PROFIT_FACTOR)
        if edge_health == "DEGRADED":
            alerts.append(PerformanceAlert.EDGE_DEGRADATION)
        if self._consecutive_losses >= self.config.max_consecutive_losses:
            alerts.append(PerformanceAlert.MAX_DRAWDOWN)

        return PerformanceStats(
            total_trades=total,
            wins=len(wins),
            losses=len(losses),
            winrate=round(winrate, 4),
            avg_win=round(avg_win, 2),
            avg_loss=round(avg_loss, 2),
            expectancy=round(expectancy, 2),
            profit_factor=round(profit_factor, 2) if profit_factor != float('inf') else float('inf'),
            max_consecutive_losses=self._max_consecutive_losses,
            current_consecutive_losses=self._consecutive_losses,
            total_pnl=round(total_pnl, 2),
            rolling_winrate=round(r_winrate, 4),
            rolling_expectancy=round(r_expectancy, 2),
            alerts=alerts,
            edge_health=edge_health,
        )

    def should_pause(self) -> tuple[bool, str]:
        """Check if strategy should be paused due to performance issues."""
        stats = self.compute_stats()

        if PerformanceAlert.NEGATIVE_EXPECTANCY in stats.alerts:
            return True, f"Negative expectancy: {stats.expectancy}"
        if PerformanceAlert.EDGE_DEGRADATION in stats.alerts:
            return True, f"Edge degraded: rolling expectancy {stats.rolling_expectancy}"
        if PerformanceAlert.MAX_DRAWDOWN in stats.alerts:
            return True, f"Max consecutive losses reached: {stats.current_consecutive_losses}"

        return False, "Performance OK"

    def reset(self) -> None:
        """Reset all tracking."""
        self._all_trades.clear()
        self._rolling_trades.clear()
        self._consecutive_losses = 0
        self._max_consecutive_losses = 0
        self._peak_capital = 0.0
        self._current_capital = 0.0
