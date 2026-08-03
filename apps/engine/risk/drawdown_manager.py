"""
Drawdown Manager — Progressive drawdown management.

Reduces position size progressively as drawdown deepens:
  - 3-5% DD → -30% size (caution)
  - 5-8% DD → -60% size (defensive)
  - 8-10% DD → -85% size (survival)
  - ≥10% DD → 0 (kill-switch territory)

Also tracks recovery: if capital recovers past a threshold,
gradually restores full sizing.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class DrawdownConfig:
    level_1_pct: float = 3.0       # caution
    level_2_pct: float = 5.0       # defensive
    level_3_pct: float = 8.0       # survival
    kill_pct: float = 10.0         # stop

    level_1_factor: float = 0.70   # -30% size
    level_2_factor: float = 0.40   # -60% size
    level_3_factor: float = 0.15   # -85% size

    # Recovery: when DD shrinks back below a level, restore gradually
    recovery_step: float = 0.10    # +10% size per level cleared


@dataclass
class DrawdownStatus:
    current_dd_pct: float
    peak_capital: float
    current_capital: float
    size_factor: float
    level: str  # "NORMAL", "CAUTION", "DEFENSIVE", "SURVIVAL", "KILL"
    in_recovery: bool = False


class DrawdownManager:
    """Track peak capital and compute progressive size reduction."""

    def __init__(
        self,
        initial_capital: float,
        config: Optional[DrawdownConfig] = None,
    ):
        self.config = config or DrawdownConfig()
        self.peak_capital = initial_capital
        self.current_capital = initial_capital
        self._prev_dd_level = 0  # track for recovery detection

    def update(self, current_capital: float) -> DrawdownStatus:
        """Update capital and compute current drawdown status."""
        self.current_capital = max(current_capital, 0.0)
        self.peak_capital = max(self.peak_capital, self.current_capital)

        dd_pct = (
            (self.peak_capital - self.current_capital) / self.peak_capital * 100
            if self.peak_capital > 0 else 0.0
        )

        # Determine level
        if dd_pct >= self.config.kill_pct:
            level = "KILL"
            factor = 0.0
            level_num = 4
        elif dd_pct >= self.config.level_3_pct:
            level = "SURVIVAL"
            factor = self.config.level_3_factor
            level_num = 3
        elif dd_pct >= self.config.level_2_pct:
            level = "DEFENSIVE"
            factor = self.config.level_2_factor
            level_num = 2
        elif dd_pct >= self.config.level_1_pct:
            level = "CAUTION"
            factor = self.config.level_1_factor
            level_num = 1
        else:
            level = "NORMAL"
            factor = 1.0
            level_num = 0

        # Recovery: if we've improved since last check, add recovery bonus
        in_recovery = False
        if level_num < self._prev_dd_level and level_num > 0:
            # We moved down a level (improvement) but still in DD
            recovery_bonus = self.config.recovery_step * (self._prev_dd_level - level_num)
            factor = min(1.0, factor + recovery_bonus)
            in_recovery = True

        self._prev_dd_level = level_num

        return DrawdownStatus(
            current_dd_pct=round(dd_pct, 2),
            peak_capital=round(self.peak_capital, 2),
            current_capital=round(self.current_capital, 2),
            size_factor=round(factor, 3),
            level=level,
            in_recovery=in_recovery,
        )

    def get_size_factor(self, current_capital: float) -> float:
        """Convenience: just get the size multiplier."""
        return self.update(current_capital).size_factor
