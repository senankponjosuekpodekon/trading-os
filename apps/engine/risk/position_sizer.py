"""
Position Sizer — Integrated position sizing based on risk.

Combines:
  - Fixed Fractional (risk % of capital)
  - Volatility factor (ATR-based, reduce in high vol)
  - Score factor (reduce on low-quality signals)
  - Drawdown factor (progressive reduction under drawdown)

Usage:
    sizer = PositionSizer(capital=10_000, risk_pct=1.0)
    size = sizer.compute(
        entry=100.0, stop_loss=98.0,
        atr_pct=1.5, signal_score=0.75,
        drawdown_pct=3.0,
    )
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SizingConfig:
    base_risk_pct: float = 1.0          # % of capital risked per trade
    max_risk_pct: float = 2.0           # hard cap
    min_risk_pct: float = 0.2           # hard floor

    # Volatility factor — reduce size when ATR% is high relative to asset norm
    vol_normal_pct: float = 1.0         # ATR% considered "normal" for this asset
    vol_high_penalty: float = 0.5       # multiplier when ATR% >> normal

    # Score factor — scale by signal quality (0-1)
    score_premium_threshold: float = 0.85   # ≥ → 120% size
    score_standard_threshold: float = 0.70  # ≥ → 100% size
    score_moyen_threshold: float = 0.60     # ≥ → 70% size
    score_low_multiplier: float = 0.4       # < moyen → 40% size

    # Drawdown factor — progressive reduction
    dd_level_1: float = 3.0             # % drawdown → -30% size
    dd_level_2: float = 5.0             # % drawdown → -60% size
    dd_level_3: float = 8.0             # % drawdown → -85% size
    dd_kill: float = 10.0               # % drawdown → 0 (kill-switch handles this)

    # Correlation factor — reduce if correlated positions open
    corr_penalty_per_position: float = 0.15  # -15% per highly-correlated open position
    corr_max_positions: int = 3             # max correlated positions before block


@dataclass
class SizingResult:
    size: float                        # position size in units
    risk_amount: float                 # $ at risk
    risk_pct_used: float               # effective % of capital
    factors: dict = field(default_factory=dict)
    blocked: bool = False
    block_reason: str = ""


class PositionSizer:
    """Integrated position sizer with multi-factor adjustment."""

    def __init__(
        self,
        capital: float,
        risk_pct: float = 1.0,
        config: Optional[SizingConfig] = None,
    ):
        self.capital = max(capital, 0.0)
        self.config = config or SizingConfig()
        self.base_risk_pct = min(
            max(risk_pct, self.config.min_risk_pct),
            self.config.max_risk_pct,
        )

    def _vol_factor(self, atr_pct: float) -> float:
        """Reduce size when volatility is high relative to asset norm."""
        if atr_pct <= 0:
            return 1.0
        normal = self.config.vol_normal_pct
        if atr_pct <= normal:
            return 1.0
        # Linear decay: at 2× normal → vol_high_penalty, at 3× → vol_high_penalty²
        ratio = atr_pct / normal
        factor = max(
            self.config.vol_high_penalty,
            1.0 - (ratio - 1.0) * (1.0 - self.config.vol_high_penalty),
        )
        return round(factor, 3)

    def _score_factor(self, signal_score: float) -> float:
        """Scale position by signal quality (0-1)."""
        if signal_score >= self.config.score_premium_threshold:
            return 1.2
        elif signal_score >= self.config.score_standard_threshold:
            return 1.0
        elif signal_score >= self.config.score_moyen_threshold:
            return 0.7
        else:
            return self.config.score_low_multiplier

    def _drawdown_factor(self, drawdown_pct: float) -> float:
        """Progressive size reduction based on current drawdown."""
        if drawdown_pct >= self.config.dd_kill:
            return 0.0
        if drawdown_pct >= self.config.dd_level_3:
            return 0.15
        if drawdown_pct >= self.config.dd_level_2:
            return 0.4
        if drawdown_pct >= self.config.dd_level_1:
            return 0.7
        return 1.0

    def _correlation_factor(self, correlated_open: int) -> float:
        """Reduce size if there are already correlated positions open."""
        if correlated_open <= 0:
            return 1.0
        if correlated_open >= self.config.corr_max_positions:
            return 0.0  # block
        penalty = correlated_open * self.config.corr_penalty_per_position
        return round(max(0.0, 1.0 - penalty), 3)

    def compute(
        self,
        entry: float,
        stop_loss: float,
        atr_pct: float = 0.0,
        signal_score: float = 0.7,
        drawdown_pct: float = 0.0,
        correlated_open: int = 0,
    ) -> SizingResult:
        """
        Compute position size.

        Args:
            entry: Entry price
            stop_loss: Stop loss price
            atr_pct: ATR as % of price (e.g. 1.5 = 1.5%)
            signal_score: Normalized signal quality (0-1)
            drawdown_pct: Current drawdown in %
            correlated_open: Number of highly-correlated open positions

        Returns:
            SizingResult with size, risk_amount, and factor breakdown
        """
        factors = {}

        # Hard block: drawdown at kill level
        if drawdown_pct >= self.config.dd_kill:
            return SizingResult(
                size=0.0, risk_amount=0.0, risk_pct_used=0.0,
                factors={"drawdown": 0.0},
                blocked=True,
                block_reason=f"Drawdown {drawdown_pct:.1f}% ≥ kill level {self.config.dd_kill:.1f}%",
            )

        # Hard block: too many correlated positions
        if correlated_open >= self.config.corr_max_positions:
            return SizingResult(
                size=0.0, risk_amount=0.0, risk_pct_used=0.0,
                factors={"correlation": 0.0},
                blocked=True,
                block_reason=f"{correlated_open} correlated positions ≥ max {self.config.corr_max_positions}",
            )

        # Stop distance
        stop_distance = abs(entry - stop_loss)
        if stop_distance <= 0:
            return SizingResult(
                size=0.0, risk_amount=0.0, risk_pct_used=0.0,
                factors={},
                blocked=True,
                block_reason="Invalid stop distance (entry == stop_loss)",
            )

        # Compute factors
        vol_f = self._vol_factor(atr_pct)
        score_f = self._score_factor(signal_score)
        dd_f = self._drawdown_factor(drawdown_pct)
        corr_f = self._correlation_factor(correlated_open)

        factors["volatility"] = vol_f
        factors["score"] = score_f
        factors["drawdown"] = dd_f
        factors["correlation"] = corr_f

        # Effective risk %
        effective_risk_pct = self.base_risk_pct * vol_f * score_f * dd_f * corr_f
        effective_risk_pct = min(
            max(effective_risk_pct, self.config.min_risk_pct),
            self.config.max_risk_pct,
        )

        # If drawdown or correlation killed it to near-zero
        if effective_risk_pct <= 0:
            return SizingResult(
                size=0.0, risk_amount=0.0, risk_pct_used=0.0,
                factors=factors,
                blocked=True,
                block_reason="Effective risk reduced to 0 by factors",
            )

        risk_amount = self.capital * effective_risk_pct / 100.0
        size = risk_amount / stop_distance

        return SizingResult(
            size=round(size, 6),
            risk_amount=round(risk_amount, 2),
            risk_pct_used=round(effective_risk_pct, 3),
            factors=factors,
        )

    def update_capital(self, new_capital: float):
        """Update capital after realized PnL."""
        self.capital = max(new_capital, 0.0)
