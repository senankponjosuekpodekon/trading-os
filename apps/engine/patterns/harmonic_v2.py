"""
Harmonic Pattern Detector v2 — Gartley, Bat, Butterfly, Crab, Cypher, Shark.

Uses ZigZag pivots for robust swing identification, then validates
Fibonacci ratios for each pattern type.

All patterns are XABCD structures with specific ratio constraints.
Tolerance is configurable (default ±2%).
"""
from __future__ import annotations

import logging
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional, List

from patterns.swings import zigzag_with_highs_lows, extract_pivots, Pivot
from patterns.targets import project_harmonic_target, TargetProjection

logger = logging.getLogger(__name__)


@dataclass
class HarmonicPattern:
    name: str
    direction: str          # "bullish" or "bearish"
    X: float
    A: float
    B: float
    C: float
    D: float
    X_idx: int
    A_idx: int
    B_idx: int
    C_idx: int
    D_idx: int
    score: float = 0.0
    prz_low: float = 0.0
    prz_high: float = 0.0
    targets: Optional[TargetProjection] = None
    ratios: dict = field(default_factory=dict)


# ── Ratio helpers ──────────────────────────────────────────────

def _ratio(a: float, b: float) -> float:
    if b == 0:
        return 0.0
    return abs(a / b)


def _is_close(value: float, target: float, tol: float = 0.02) -> bool:
    return abs(value - target) <= tol


def _is_between(value: float, low: float, high: float, tol: float = 0.02) -> bool:
    return (low - tol) <= value <= (high + tol)


# ── Pattern validators ────────────────────────────────────────

def _check_gartley(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    return (
        _is_close(_ratio(ab, xa), 0.618, tol) and
        _is_between(_ratio(bc, ab), 0.382, 0.886, tol) and
        _is_between(_ratio(cd, bc), 1.272, 1.618, tol) and
        _is_close(_ratio(ad, xa), 0.786, tol)
    )


def _check_bat(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    return (
        _is_between(_ratio(ab, xa), 0.382, 0.50, tol) and
        _is_between(_ratio(bc, ab), 0.382, 0.886, tol) and
        _is_between(_ratio(cd, bc), 1.618, 2.618, tol) and
        _is_close(_ratio(ad, xa), 0.886, tol)
    )


def _check_butterfly(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    return (
        _is_close(_ratio(ab, xa), 0.786, tol) and
        _is_between(_ratio(bc, ab), 0.382, 0.886, tol) and
        _is_between(_ratio(cd, bc), 1.618, 2.24, tol) and
        _is_between(_ratio(ad, xa), 1.27, 1.618, tol)
    )


def _check_crab(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    return (
        _is_between(_ratio(ab, xa), 0.382, 0.618, tol) and
        _is_between(_ratio(bc, ab), 0.382, 0.886, tol) and
        _is_between(_ratio(cd, bc), 2.24, 3.618, tol) and
        _is_close(_ratio(ad, xa), 1.618, tol)
    )


def _check_cypher(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    """Cypher: AB = 0.382-0.618 XA, BC = 1.272-1.414 XC, AD = 0.786 XC"""
    xc = abs(xa - 0)  # XC is full range X to C
    return (
        _is_between(_ratio(ab, xa), 0.382, 0.618, tol) and
        _is_between(_ratio(bc, xc), 1.272, 1.414, tol) and
        _is_close(_ratio(ad, xc), 0.786, tol)
    )


def _check_shark(xa, ab, bc, cd, ad, tol=0.02) -> bool:
    """Shark: 5-0 pattern variant. BC = 1.618-2.24 XC, CD = 0.886 XC"""
    xc = abs(xa - 0)
    return (
        _is_between(_ratio(ab, xa), 0.382, 0.618, tol) and
        _is_between(_ratio(bc, xc), 1.618, 2.24, tol) and
        _is_close(_ratio(cd, xc), 0.886, tol)
    )


_PATTERNS = {
    "Gartley": _check_gartley,
    "Bat": _check_bat,
    "Butterfly": _check_butterfly,
    "Crab": _check_crab,
    "Cypher": _check_cypher,
    "Shark": _check_shark,
}

_QUALITY_BONUS = {
    "Crab": 0.15,
    "Gartley": 0.12,
    "Bat": 0.12,
    "Butterfly": 0.10,
    "Cypher": 0.10,
    "Shark": 0.08,
}


def detect_harmonic_patterns(
    df: pd.DataFrame,
    threshold_pct: float = 0.006,
    tol: float = 0.02,
) -> List[HarmonicPattern]:
    """
    Detect harmonic patterns in a DataFrame.

    1. Compute ZigZag with highs/lows
    2. Extract pivots
    3. Slide a 5-pivot window (X A B C D)
    4. Validate ratios for each pattern type
    """
    df = zigzag_with_highs_lows(df, threshold_pct=threshold_pct)
    pivots = extract_pivots(df, "zigzag")

    if len(pivots) < 5:
        return []

    patterns: List[HarmonicPattern] = []

    for i in range(len(pivots) - 4):
        X, A, B, C, D = pivots[i : i + 5]

        xa = abs(A.price - X.price)
        ab = abs(B.price - A.price)
        bc = abs(C.price - B.price)
        cd = abs(D.price - C.price)
        ad = abs(D.price - A.price)

        if xa == 0:
            continue

        # Direction: bullish if D is a low (reversal up expected)
        direction = "bullish" if D.type == "low" else "bearish"

        detected_name = None
        for name, checker in _PATTERNS.items():
            try:
                if checker(xa, ab, bc, cd, ad, tol):
                    detected_name = name
                    break
            except Exception as exc:
                logger.warning("harmonic_check_failed", pattern=name, error=str(exc))
                continue

        if detected_name is None:
            continue

        # PRZ: 0.15% around D
        prz_range = abs(D.price) * 0.0015
        prz_low = min(D.price - prz_range, D.price + prz_range)
        prz_high = max(D.price - prz_range, D.price + prz_range)

        # Targets
        targets = project_harmonic_target(
            point_a=A.price,
            point_d=D.price,
            direction=direction,
        )

        pattern = HarmonicPattern(
            name=detected_name,
            direction=direction,
            X=X.price, A=A.price, B=B.price, C=C.price, D=D.price,
            X_idx=X.index, A_idx=A.index, B_idx=B.index, C_idx=C.index, D_idx=D.index,
            prz_low=round(prz_low, 6),
            prz_high=round(prz_high, 6),
            targets=targets,
            ratios={
                "ab_xa": round(_ratio(ab, xa), 4),
                "bc_ab": round(_ratio(bc, ab), 4),
                "cd_bc": round(_ratio(cd, bc), 4),
                "ad_xa": round(_ratio(ad, xa), 4),
            },
        )
        patterns.append(pattern)

    return patterns


def score_harmonic_pattern(
    pattern: HarmonicPattern,
    divergence: Optional[dict] = None,
    structure_confluence: bool = False,
    orderflow_confirmation: bool = False,
) -> float:
    """
    Score a harmonic pattern based on type, divergence, and confluence.

    Base: 0.40 (valid pattern)
    Type bonus: 0.08-0.15
    RSI divergence: +0.20
    Structure confluence: +0.12
    Order flow confirmation: +0.13
    Max: 1.0
    """
    score = 0.40
    score += _QUALITY_BONUS.get(pattern.name, 0.08)

    if divergence and divergence.get("has_divergence"):
        score += 0.20

    if structure_confluence:
        score += 0.12

    if orderflow_confirmation:
        score += 0.13

    return min(score, 1.0)
