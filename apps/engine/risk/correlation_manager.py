"""
Correlation Manager — Detect and limit correlated positions.

Prevents the portfolio from concentrating risk in highly-correlated
assets (e.g. 5 short EUR/USD = 1 large short EUR/USD in disguise).

Features:
  - Rolling correlation matrix from price history
  - Cluster detection (groups of correlated assets)
  - Progressive size reduction per correlated position
  - Hard block when max correlated positions reached
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
import pandas as pd


@dataclass
class CorrelationConfig:
    correlation_threshold: float = 0.70   # |ρ| ≥ → "highly correlated"
    moderate_threshold: float = 0.50      # |ρ| ≥ → "moderately correlated"
    rolling_window: int = 50              # bars for rolling correlation
    max_correlated_positions: int = 3     # hard block beyond this
    reduction_per_position: float = 0.20  # -20% size per correlated open


@dataclass
class CorrelationStatus:
    symbol: str
    correlated_open: int
    correlation_cluster: list[str] = field(default_factory=list)
    max_correlation: float = 0.0
    blocked: bool = False
    reduction_factor: float = 1.0


class CorrelationManager:
    """Track open positions and detect correlations between symbols."""

    def __init__(self, config: Optional[CorrelationConfig] = None):
        self.config = config or CorrelationConfig()
        self._open_positions: dict[str, dict] = {}  # symbol → {direction, ...}
        self._correlation_matrix: Optional[pd.DataFrame] = None
        self._price_history: dict[str, pd.Series] = {}

    def update_price_history(self, symbol: str, closes: pd.Series) -> None:
        """Store or update price history for a symbol."""
        self._price_history[symbol] = closes.copy()

    def compute_correlation_matrix(self) -> Optional[pd.DataFrame]:
        """Compute rolling correlation matrix from stored price histories."""
        if len(self._price_history) < 2:
            return None

        # Align all series to same length
        min_len = min(len(s) for s in self._price_history.values())
        if min_len < 10:
            return None

        returns = {}
        for sym, closes in self._price_history.items():
            aligned = closes.iloc[-min_len:]
            returns[sym] = aligned.pct_change().dropna()

        df = pd.DataFrame(returns)
        if df.empty or len(df.columns) < 2:
            return None

        self._correlation_matrix = df.corr()
        return self._correlation_matrix

    def get_correlation(self, symbol_a: str, symbol_b: str) -> float:
        """Get correlation between two symbols. Returns 0 if unknown."""
        if self._correlation_matrix is None:
            self.compute_correlation_matrix()
        if self._correlation_matrix is None:
            return 0.0
        if symbol_a not in self._correlation_matrix.columns:
            return 0.0
        if symbol_b not in self._correlation_matrix.columns:
            return 0.0
        val = self._correlation_matrix.loc[symbol_a, symbol_b]
        if pd.isna(val):
            return 0.0
        return float(val)

    def register_position(self, symbol: str, direction: str, **metadata) -> None:
        """Register a new open position."""
        self._open_positions[symbol] = {"direction": direction, **metadata}

    def unregister_position(self, symbol: str) -> None:
        """Remove a closed position."""
        self._open_positions.pop(symbol, None)

    def clear_positions(self) -> None:
        """Clear all open positions (e.g. session reset)."""
        self._open_positions.clear()

    def check(self, symbol: str, direction: str) -> CorrelationStatus:
        """
        Check if opening a new position on `symbol` is allowed,
        given currently open positions.

        Args:
            symbol: Symbol to check
            direction: "BUY" or "SELL"

        Returns:
            CorrelationStatus with correlated count, cluster, and reduction factor
        """
        correlated_open = 0
        cluster = []
        max_corr = 0.0

        for open_sym, _pos in self._open_positions.items():
            if open_sym == symbol:
                # Same symbol — always counts as correlated
                correlated_open += 1
                cluster.append(open_sym)
                max_corr = 1.0
                continue

            corr = self.get_correlation(symbol, open_sym)
            abs_corr = abs(corr)

            if abs_corr >= self.config.correlation_threshold:
                correlated_open += 1
                cluster.append(open_sym)
                max_corr = max(max_corr, abs_corr)

                # If directions agree on positively-correlated assets,
                # or directions disagree on negatively-correlated assets,
                # the risk is amplified.
                # (We count it regardless — correlation = risk concentration)

        blocked = correlated_open >= self.config.max_correlated_positions
        reduction = 1.0
        if not blocked and correlated_open > 0:
            reduction = max(0.0, 1.0 - correlated_open * self.config.reduction_per_position)

        return CorrelationStatus(
            symbol=symbol,
            correlated_open=correlated_open,
            correlation_cluster=cluster,
            max_correlation=round(max_corr, 3),
            blocked=blocked,
            reduction_factor=round(reduction, 3),
        )

    def get_clusters(self) -> list[list[str]]:
        """Identify clusters of highly correlated symbols from the matrix."""
        if self._correlation_matrix is None:
            self.compute_correlation_matrix()
        if self._correlation_matrix is None:
            return []

        visited: set[str] = set()
        clusters: list[list[str]] = []
        symbols = list(self._correlation_matrix.columns)

        for sym in symbols:
            if sym in visited:
                continue
            cluster = [sym]
            visited.add(sym)
            for other in symbols:
                if other in visited:
                    continue
                corr = abs(self.get_correlation(sym, other))
                if corr >= self.config.correlation_threshold:
                    cluster.append(other)
                    visited.add(other)
            if len(cluster) > 1:
                clusters.append(cluster)

        return clusters
