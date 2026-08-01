"""
Candle dataclass — standardized candle representation with derived properties.

Used by pattern detectors to avoid duplicating body/shadow/ratio calculations.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Candle:
    """Immutable candle representation."""
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    @property
    def body(self) -> float:
        """Absolute body size."""
        return abs(self.close - self.open)

    @property
    def body_signed(self) -> float:
        """Signed body (positive=bullish, negative=bearish)."""
        return self.close - self.open

    @property
    def range_(self) -> float:
        """Full candle range (high - low)."""
        return self.high - self.low

    @property
    def upper_shadow(self) -> float:
        """Wick above the body."""
        return self.high - max(self.open, self.close)

    @property
    def lower_shadow(self) -> float:
        """Wick below the body."""
        return min(self.open, self.close) - self.low

    @property
    def body_ratio(self) -> float:
        """Body as fraction of total range (0-1)."""
        r = self.range_
        return self.body / r if r > 0 else 0.0

    @property
    def upper_shadow_ratio(self) -> float:
        """Upper shadow as fraction of total range (0-1)."""
        r = self.range_
        return self.upper_shadow / r if r > 0 else 0.0

    @property
    def lower_shadow_ratio(self) -> float:
        """Lower shadow as fraction of total range (0-1)."""
        r = self.range_
        return self.lower_shadow / r if r > 0 else 0.0

    @property
    def is_bullish(self) -> bool:
        return self.close > self.open

    @property
    def is_bearish(self) -> bool:
        return self.close < self.open

    @property
    def is_doji(self) -> bool:
        """True if body is < 10% of range."""
        return self.body_ratio < 0.1

    @property
    def is_hammer_like(self) -> bool:
        """True if lower shadow ≥ 2× body and upper shadow ≤ 0.3× body."""
        if self.body <= 0:
            return False
        return (
            self.lower_shadow >= self.body * 2
            and self.upper_shadow <= self.body * 0.3
        )

    @property
    def is_shooting_star_like(self) -> bool:
        """True if upper shadow ≥ 2× body and lower shadow ≤ 0.3× body."""
        if self.body <= 0:
            return False
        return (
            self.upper_shadow >= self.body * 2
            and self.lower_shadow <= self.body * 0.3
        )

    @property
    def midpoint(self) -> float:
        """Midpoint of the candle body."""
        return (self.open + self.close) / 2.0

    def wick_rejection_strength(self, direction: str = "auto") -> float:
        """
        Wick rejection strength (0-1).

        Measures how strongly price rejected from one end of the candle.
        A value near 1 means a long wick with tiny body — strong rejection.

        Args:
            direction: "BUY" (rejection from low), "SELL" (rejection from high),
                       or "auto" (uses the larger shadow)
        """
        r = self.range_
        if r <= 0:
            return 0.0

        if direction == "auto":
            if self.lower_shadow >= self.upper_shadow:
                direction = "BUY"
            else:
                direction = "SELL"

        if direction == "BUY":
            # Strong rejection from low: long lower wick, small body
            wick = self.lower_shadow
        else:
            # Strong rejection from high: long upper wick, small body
            wick = self.upper_shadow

        # Normalize: wick / range gives the fraction of range that was wick
        # Subtract body_ratio to penalize large bodies
        strength = (wick / r) - self.body_ratio * 0.5
        return max(0.0, min(1.0, strength))


def candle_from_row(row) -> Candle:
    """Create a Candle from a pandas DataFrame row or dict-like object."""
    return Candle(
        timestamp=float(row.get("timestamp", 0)) if hasattr(row, "get") else 0.0,
        open=float(row["open"]),
        high=float(row["high"]),
        low=float(row["low"]),
        close=float(row["close"]),
        volume=float(row.get("volume", 0)) if hasattr(row, "get") else 0.0,
    )


def candles_from_df(df) -> list[Candle]:
    """Convert a pandas DataFrame with OHLC(V) columns to a list of Candles."""
    cols = df.columns
    has_ts = "timestamp" in cols or "time" in cols or "date" in cols
    has_vol = "volume" in cols

    candles = []
    for _, row in df.iterrows():
        ts = 0.0
        if has_ts:
            ts_col = "timestamp" if "timestamp" in cols else ("time" if "time" in cols else "date")
            ts = float(row[ts_col])
        candles.append(Candle(
            timestamp=ts,
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row["volume"]) if has_vol else 0.0,
        ))
    return candles
