"""Geometry Engine — foundational market structure abstractions."""
from geometry.core import (
    Pivot,
    Swing,
    PriceZone,
    PatternSpec,
    PatternMatch,
    find_pivots,
    alternating_pivots,
    filter_significant,
    leg_ratio,
    zone_overlap,
    score_fib_errors,
    build_swings,
)

__all__ = [
    "Pivot",
    "Swing",
    "PriceZone",
    "PatternSpec",
    "PatternMatch",
    "find_pivots",
    "alternating_pivots",
    "filter_significant",
    "leg_ratio",
    "zone_overlap",
    "score_fib_errors",
    "build_swings",
]
