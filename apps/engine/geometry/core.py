"""
Geometry Engine — low-level market structure primitives.
Provides pivot, swing, price-zone and ratio helpers used by pattern detectors.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable
import pandas as pd
import numpy as np

from indicators.swing import find_pivot_highs, find_pivot_lows


@dataclass(frozen=True)
class Pivot:
    idx: int
    price: float
    type: str  # 'high' | 'low'


@dataclass(frozen=True)
class Swing:
    start: Pivot
    end: Pivot
    direction: str  # 'up' | 'down'

    @property
    def length(self) -> float:
        return abs(self.end.price - self.start.price)


@dataclass(frozen=True)
class PriceZone:
    min: float
    max: float

    def overlap(self, other: "PriceZone") -> float:
        if self.max <= self.min or other.max <= other.min:
            return 0.0
        overlap_len = min(self.max, other.max) - max(self.min, other.min)
        if overlap_len <= 0:
            return 0.0
        span = min(self.max - self.min, other.max - other.min)
        return max(0.0, min(1.0, overlap_len / span)) if span > 0 else 0.0

    def contains(self, level: float, tolerance: float = 0.005) -> bool:
        mid = (self.min + self.max) / 2.0
        return abs(level - mid) / max(mid, 1e-9) <= tolerance


@dataclass(frozen=True)
class PatternSpec:
    name: str
    direction: str  # BUY | SELL | BOTH
    checks: list[Callable[[list[Pivot], float], dict[str, Any] | None]] = field(default_factory=list)


@dataclass
class PatternMatch:
    name: str
    direction: str
    confidence: float
    pivots: list[Pivot]
    ratios: dict[str, float] = field(default_factory=dict)


def _atr(close: pd.Series, length: int = 14) -> pd.Series:
    prev = close.shift(1)
    tr = pd.concat([close - prev, (close - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(length, min_periods=1).mean()


def find_pivots(df: pd.DataFrame, left: int = 3, right: int = 3) -> list[Pivot]:
    """Return all significant pivot highs and lows sorted by index."""
    high = df["high"]
    low = df["low"]
    h_mask = find_pivot_highs(high, left=left, right=right)
    l_mask = find_pivot_lows(low, left=left, right=right)

    pts: list[Pivot] = []
    for idx in h_mask.index:
        if h_mask.loc[idx]:
            pts.append(Pivot(int(idx), float(high.loc[idx]), "high"))
    for idx in l_mask.index:
        if l_mask.loc[idx]:
            pts.append(Pivot(int(idx), float(low.loc[idx]), "low"))
    pts.sort(key=lambda p: p.idx)
    return pts


def alternating_pivots(pts: list[Pivot]) -> list[Pivot]:
    """Remove consecutive pivots of same type, keeping the more extreme one."""
    filtered: list[Pivot] = []
    for p in pts:
        if not filtered or filtered[-1].type != p.type:
            filtered.append(p)
        else:
            last = filtered[-1]
            if p.type == "high" and p.price > last.price:
                filtered[-1] = p
            elif p.type == "low" and p.price < last.price:
                filtered[-1] = p
    return filtered


def filter_significant(
    pts: list[Pivot],
    close: pd.Series,
    min_atr_multiple: float = 0.5,
) -> list[Pivot]:
    """Filter insignificant pivots by ATR-based amplitude relative to last opposite pivot."""
    atr_s = _atr(close)
    significant: list[Pivot] = []
    last_opp: Pivot | None = None
    for p in pts:
        if last_opp is None:
            significant.append(p)
            last_opp = p
            continue
        current_atr = max(
            float(atr_s.iloc[p.idx]) if not pd.isna(atr_s.iloc[p.idx]) else 0.0,
            close.std() * 0.5,
        )
        amplitude = abs(p.price - last_opp.price)
        if amplitude >= min_atr_multiple * current_atr:
            significant.append(p)
            last_opp = p
    return significant


def build_swings(pts: list[Pivot]) -> list[Swing]:
    """Build directional swings from alternating pivots."""
    swings: list[Swing] = []
    for i in range(1, len(pts)):
        direction = "up" if pts[i].price > pts[i - 1].price else "down"
        swings.append(Swing(pts[i - 1], pts[i], direction))
    return swings


def leg_ratio(start: float, end: float, base: float) -> float:
    """Return retracement/extension ratio |end-start|/base."""
    if base == 0:
        return 0.0
    return abs(end - start) / base


def zone_overlap(a: dict[str, float], b: dict[str, float]) -> float:
    """Overlap ratio of two {min, max} price zones."""
    return PriceZone(a.get("min", 0.0), a.get("max", 0.0)).overlap(
        PriceZone(b.get("min", 0.0), b.get("max", 0.0))
    )


def score_fib_errors(errors: list[float], tolerance: float) -> float:
    """Convert average ratio error to a 0-1 confidence."""
    if not errors or tolerance <= 0:
        return 0.0
    avg = sum(errors) / len(errors)
    return round(max(0.0, min(1.0, 1.0 - avg / tolerance)), 4)
