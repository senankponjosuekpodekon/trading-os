"""
Regime Filter — Strategy compatibility with market regimes.

Each strategy declares which regimes it performs best in.
The filter blocks or penalizes signals that don't match the current regime.

Regimes (from regime.py):
  TRENDING_BULL, TRENDING_BEAR, RANGING, VOLATILE, UNKNOWN

Compatibility:
  1.0 = optimal regime
  0.5 = neutral
  0.0 = avoid
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# Strategy-regime compatibility matrix
# Each strategy maps to a dict of regime → compatibility score (0-1)
DEFAULT_COMPATIBILITY: dict[str, dict[str, float]] = {
    # Trend-following strategies
    "trend_follow": {
        "TRENDING_BULL": 1.0,
        "TRENDING_BEAR": 1.0,
        "RANGING": 0.2,
        "VOLATILE": 0.3,
        "UNKNOWN": 0.5,
    },
    # Mean-reversion strategies
    "mean_revert": {
        "TRENDING_BULL": 0.3,
        "TRENDING_BEAR": 0.3,
        "RANGING": 1.0,
        "VOLATILE": 0.2,
        "UNKNOWN": 0.5,
    },
    # Breakout strategies
    "breakout": {
        "TRENDING_BULL": 0.7,
        "TRENDING_BEAR": 0.7,
        "RANGING": 0.8,
        "VOLATILE": 0.9,
        "UNKNOWN": 0.5,
    },
    # Scalping
    "scalp": {
        "TRENDING_BULL": 0.6,
        "TRENDING_BEAR": 0.6,
        "RANGING": 0.7,
        "VOLATILE": 0.4,
        "UNKNOWN": 0.5,
    },
    # Harmonic patterns (work best in ranging)
    "harmonic": {
        "TRENDING_BULL": 0.4,
        "TRENDING_BEAR": 0.4,
        "RANGING": 1.0,
        "VOLATILE": 0.2,
        "UNKNOWN": 0.5,
    },
    # Reversal patterns (work best at regime transitions)
    "reversal": {
        "TRENDING_BULL": 0.3,
        "TRENDING_BEAR": 0.3,
        "RANGING": 0.5,
        "VOLATILE": 0.8,
        "UNKNOWN": 0.5,
    },
    # Continuation patterns
    "continuation": {
        "TRENDING_BULL": 1.0,
        "TRENDING_BEAR": 1.0,
        "RANGING": 0.3,
        "VOLATILE": 0.4,
        "UNKNOWN": 0.5,
    },
    # Default: neutral
    "default": {
        "TRENDING_BULL": 0.5,
        "TRENDING_BEAR": 0.5,
        "RANGING": 0.5,
        "VOLATILE": 0.5,
        "UNKNOWN": 0.5,
    },
}


@dataclass
class RegimeFilterConfig:
    min_compatibility: float = 0.3    # Block if below
    penalty_threshold: float = 0.5   # Penalize if below but above min
    penalty_factor: float = 0.5      # Score multiplier when penalized


@dataclass
class RegimeFilterResult:
    allowed: bool
    compatibility: float
    adjusted_score: float
    reason: str


class RegimeFilter:
    """Filter or penalize signals based on strategy-regime compatibility."""

    def __init__(self, config: Optional[RegimeFilterConfig] = None):
        self.config = config or RegimeFilterConfig()
        self._compatibility = DEFAULT_COMPATIBILITY.copy()

    def register_strategy(self, name: str, compatibility: dict[str, float]) -> None:
        """Register a custom strategy with its regime compatibility."""
        self._compatibility[name] = compatibility

    # Map real strategy name slugs to compatibility categories
    _STRATEGY_CATEGORY_MAP: dict[str, str] = {
        "ema_trend_+_rsi": "trend_follow",
        "macd_momentum": "trend_follow",
        "swing_trend_follow": "trend_follow",
        "smc_retest_ob/fvg": "reversal",
        "scalper_rsi_reversal": "scalp",
        "brvm_value_swing": "trend_follow",
        "synthetic_mean_reversion": "mean_revert",
    }

    def check(
        self,
        strategy: str,
        regime: str,
        signal_score: float = 1.0,
    ) -> RegimeFilterResult:
        """
        Check if a strategy is compatible with the current regime.

        Args:
            strategy: Strategy name (must be in compatibility matrix)
            regime: Current market regime
            signal_score: Original signal score (0-1)

        Returns:
            RegimeFilterResult with allowed, compatibility, adjusted_score
        """
        # Normalize strategy name to a known category
        strategy = self._STRATEGY_CATEGORY_MAP.get(strategy, strategy)
        compat_map = self._compatibility.get(strategy, self._compatibility["default"])
        compatibility = compat_map.get(regime, 0.5)

        if compatibility < self.config.min_compatibility:
            return RegimeFilterResult(
                allowed=False,
                compatibility=round(compatibility, 3),
                adjusted_score=0.0,
                reason=f"Regime {regime} incompatible with {strategy} (compat={compatibility:.2f} < {self.config.min_compatibility})",
            )

        adjusted = signal_score
        if compatibility < self.config.penalty_threshold:
            adjusted = signal_score * self.config.penalty_factor
            return RegimeFilterResult(
                allowed=True,
                compatibility=round(compatibility, 3),
                adjusted_score=round(adjusted, 4),
                reason=f"Regime {regime} suboptimal for {strategy} (compat={compatibility:.2f}), score reduced",
            )

        return RegimeFilterResult(
            allowed=True,
            compatibility=round(compatibility, 3),
            adjusted_score=round(adjusted, 4),
            reason=f"Regime {regime} compatible with {strategy}",
        )

    def get_compatibility(self, strategy: str, regime: str) -> float:
        """Get raw compatibility score for a strategy-regime pair."""
        compat_map = self._compatibility.get(strategy, self._compatibility["default"])
        return compat_map.get(regime, 0.5)
