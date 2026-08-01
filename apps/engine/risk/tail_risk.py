"""
Tail Risk — Value at Risk (VaR) and Conditional VaR (CVaR).

Uses historical method (non-parametric) to estimate:
  - VaR: Maximum expected loss at a given confidence level
  - CVaR (Expected Shortfall): Average loss beyond VaR
  - Crisis mode: Dynamic threshold adjustment when tail risk is elevated

All values are expressed as % of portfolio.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from collections import deque
import numpy as np


@dataclass
class TailRiskConfig:
    var_confidence: float = 0.95        # 95th percentile VaR
    cvar_confidence: float = 0.95       # 95th percentile CVaR
    rolling_window: int = 252           # Trading days in window (~1 year)
    min_observations: int = 30          # Minimum data before computing
    crisis_var_threshold: float = 5.0   # % — if VaR exceeds, enter crisis mode
    crisis_size_reduction: float = 0.5  # Reduce position size by 50% in crisis


@dataclass
class TailRiskStatus:
    var_pct: float                      # VaR as % of portfolio
    cvar_pct: float                     # CVaR as % of portfolio
    crisis_mode: bool
    size_factor: float                  # 1.0 normal, <1.0 in crisis
    observations: int
    reason: str = ""


class TailRiskManager:
    """Compute VaR/CVaR and manage crisis mode."""

    def __init__(self, config: Optional[TailRiskConfig] = None):
        self.config = config or TailRiskConfig()
        self._returns: deque[float] = deque(maxlen=config.rolling_window if config else 252)
        self._crisis_mode = False

    def record_return(self, portfolio_return_pct: float) -> None:
        """Record a daily portfolio return (in %)."""
        self._returns.append(portfolio_return_pct)

    def compute_var(self) -> float:
        """Compute VaR as a positive percentage (loss)."""
        if len(self._returns) < self.config.min_observations:
            return 0.0
        returns = np.array(self._returns)
        # VaR at 95% confidence = 5th percentile of returns (negative)
        # Express as positive loss percentage
        percentile = (1 - self.config.var_confidence) * 100
        var = float(np.percentile(returns, percentile))
        return abs(var) if var < 0 else 0.0

    def compute_cvar(self) -> float:
        """Compute CVaR (Expected Shortfall) as a positive percentage."""
        if len(self._returns) < self.config.min_observations:
            return 0.0
        returns = np.array(self._returns)
        percentile = (1 - self.config.cvar_confidence) * 100
        var_threshold = np.percentile(returns, percentile)
        tail = returns[returns <= var_threshold]
        if len(tail) == 0:
            return 0.0
        cvar = float(np.mean(tail))
        return abs(cvar) if cvar < 0 else 0.0

    def update(self) -> TailRiskStatus:
        """Compute current tail risk status and check for crisis mode."""
        var = self.compute_var()
        cvar = self.compute_cvar()

        # Crisis mode check
        if var >= self.config.crisis_var_threshold:
            if not self._crisis_mode:
                self._crisis_mode = True
        elif var < self.config.crisis_var_threshold * 0.7:
            # Exit crisis mode when VaR drops well below threshold
            self._crisis_mode = False

        size_factor = 1.0
        reason = ""

        if self._crisis_mode:
            size_factor = self.config.crisis_size_reduction
            reason = f"Crisis mode: VaR {var:.2f}% ≥ {self.config.crisis_var_threshold:.1f}%"

        return TailRiskStatus(
            var_pct=round(var, 2),
            cvar_pct=round(cvar, 2),
            crisis_mode=self._crisis_mode,
            size_factor=round(size_factor, 3),
            observations=len(self._returns),
            reason=reason,
        )

    def get_size_factor(self) -> float:
        """Convenience: get current size multiplier based on tail risk."""
        return self.update().size_factor

    def reset(self) -> None:
        """Clear all recorded returns."""
        self._returns.clear()
        self._crisis_mode = False
