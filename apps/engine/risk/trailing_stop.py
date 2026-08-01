"""
Trailing Stop — Dynamic stop-loss management.

Modes:
  1. Break-even: Move stop to entry when price moves favorably by N ATR
  2. ATR trailing: Trail stop at N ATR behind current price
  3. Structure trailing: Trail behind recent swing high/low

Combines all three: break-even first, then ATR trailing, with structure as floor.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from enum import Enum

import pandas as pd


class TrailingMode(Enum):
    INITIAL = "INITIAL"       # Original stop loss
    BREAK_EVEN = "BREAK_EVEN" # Moved to entry
    TRAILING = "TRAILING"     # Actively trailing


@dataclass
class TrailingConfig:
    break_even_atr_multiple: float = 1.0   # Move to BE when price moves 1 ATR favorable
    trail_atr_multiple: float = 2.0        # Trail at 2 ATR behind
    trail_min_step_pct: float = 0.1        # Minimum trailing step (0.1%)
    structure_lookback: int = 5             # Bars to look back for swing


@dataclass
class TrailingUpdate:
    new_stop: float
    mode: TrailingMode
    reason: str
    moved: bool


class TrailingStop:
    """Manage a dynamic trailing stop for an open position."""

    def __init__(
        self,
        entry: float,
        initial_stop: float,
        direction: str,  # "BUY" or "SELL"
        config: Optional[TrailingConfig] = None,
    ):
        self.entry = entry
        self.stop = initial_stop
        self.direction = direction.upper()
        self.config = config or TrailingConfig()
        self.mode = TrailingMode.INITIAL
        self._moved_to_be = False

    def update(
        self,
        current_price: float,
        atr: float = 0.0,
        recent_high: Optional[float] = None,
        recent_low: Optional[float] = None,
    ) -> TrailingUpdate:
        """
        Update the trailing stop based on current price and ATR.

        Args:
            current_price: Current market price
            atr: Current ATR value (14-period typical)
            recent_high: Recent swing high (for structure trailing)
            recent_low: Recent swing low (for structure trailing)

        Returns:
            TrailingUpdate with new stop, mode, and whether it moved.
        """
        old_stop = self.stop
        atr_val = atr if atr > 0 else 0.0

        if self.direction == "BUY":
            return self._update_long(current_price, atr_val, recent_high, recent_low, old_stop)
        else:
            return self._update_short(current_price, atr_val, recent_high, recent_low, old_stop)

    def _update_long(
        self,
        price: float,
        atr: float,
        recent_high: Optional[float],
        recent_low: Optional[float],
        old_stop: float,
    ) -> TrailingUpdate:
        """Update trailing stop for a long position."""
        favorable_move = price - self.entry

        # Phase 1: Move to break-even
        if not self._moved_to_be and atr > 0:
            if favorable_move >= self.config.break_even_atr_multiple * atr:
                self.stop = max(self.stop, self.entry)
                self.mode = TrailingMode.BREAK_EVEN
                self._moved_to_be = True
                if self.stop > old_stop:
                    return TrailingUpdate(
                        new_stop=round(self.stop, 6),
                        mode=self.mode,
                        reason=f"Break-even: price moved {favorable_move:.4f} ≥ {self.config.break_even_atr_multiple} ATR",
                        moved=True,
                    )

        # Phase 2: ATR trailing
        if self._moved_to_be and atr > 0:
            new_stop = price - self.config.trail_atr_multiple * atr

            # Structure trailing: use recent swing low as floor
            if recent_low is not None:
                new_stop = max(new_stop, recent_low)

            # Only move stop forward (never backward for longs)
            min_step = price * self.config.trail_min_step_pct / 100
            if new_stop > self.stop + min_step:
                self.stop = new_stop
                self.mode = TrailingMode.TRAILING
                return TrailingUpdate(
                    new_stop=round(self.stop, 6),
                    mode=self.mode,
                    reason=f"ATR trailing: {self.config.trail_atr_multiple} ATR behind price",
                    moved=True,
                )

        return TrailingUpdate(
            new_stop=round(self.stop, 6),
            mode=self.mode,
            reason="No change",
            moved=False,
        )

    def _update_short(
        self,
        price: float,
        atr: float,
        recent_high: Optional[float],
        recent_low: Optional[float],
        old_stop: float,
    ) -> TrailingUpdate:
        """Update trailing stop for a short position."""
        favorable_move = self.entry - price

        # Phase 1: Move to break-even
        if not self._moved_to_be and atr > 0:
            if favorable_move >= self.config.break_even_atr_multiple * atr:
                self.stop = min(self.stop, self.entry)
                self.mode = TrailingMode.BREAK_EVEN
                self._moved_to_be = True
                if self.stop < old_stop:
                    return TrailingUpdate(
                        new_stop=round(self.stop, 6),
                        mode=self.mode,
                        reason=f"Break-even: price moved {favorable_move:.4f} ≥ {self.config.break_even_atr_multiple} ATR",
                        moved=True,
                    )

        # Phase 2: ATR trailing
        if self._moved_to_be and atr > 0:
            new_stop = price + self.config.trail_atr_multiple * atr

            # Structure trailing: use recent swing high as ceiling
            if recent_high is not None:
                new_stop = min(new_stop, recent_high)

            # Only move stop forward (never backward for shorts)
            min_step = price * self.config.trail_min_step_pct / 100
            if new_stop < self.stop - min_step:
                self.stop = new_stop
                self.mode = TrailingMode.TRAILING
                return TrailingUpdate(
                    new_stop=round(self.stop, 6),
                    mode=self.mode,
                    reason=f"ATR trailing: {self.config.trail_atr_multiple} ATR behind price",
                    moved=True,
                )

        return TrailingUpdate(
            new_stop=round(self.stop, 6),
            mode=self.mode,
            reason="No change",
            moved=False,
        )

    def is_stopped_out(self, current_price: float) -> bool:
        """Check if current price has hit the stop."""
        if self.direction == "BUY":
            return current_price <= self.stop
        else:
            return current_price >= self.stop

    @property
    def current_stop(self) -> float:
        return self.stop

    @property
    def current_mode(self) -> TrailingMode:
        return self.mode
