"""
Pattern detection coordinator — runs all chart/harmonic pattern detectors on a DataFrame.
"""
from __future__ import annotations

import pandas as pd
from typing import Any

from patterns.double_top import detect_double_top, detect_double_bottom
from patterns.head_shoulders import detect_head_and_shoulders, detect_inverse_head_and_shoulders
from patterns.harmonic import detect_harmonic
from patterns.pattern import MarketPattern
from utils.logger import get_logger

logger = get_logger(__name__)


def detect_all(df: pd.DataFrame, harmonic_tolerance: float = 0.02) -> list[dict[str, Any]]:
    """
    Run every pattern detector and return a list of serialised patterns.
    Returns empty list if df is too small.
    """
    if df is None or len(df) < 15:
        return []

    detectors = [
        detect_double_top,
        detect_double_bottom,
        detect_head_and_shoulders,
        detect_inverse_head_and_shoulders,
        lambda d: detect_harmonic(d, tolerance=harmonic_tolerance),
    ]

    found: list[MarketPattern] = []
    for fn in detectors:
        try:
            result = fn(df)
            if result is None:
                continue
            if isinstance(result, list):
                found.extend(result)
            else:
                found.append(result)
        except Exception as exc:
            logger.warning("pattern_detector_failed", detector=fn.__name__, error=str(exc))
            continue

    # Sort by recency of point D / last point and then confidence
    def _recency(p: MarketPattern) -> int:
        points = p.points or {}
        if "D" in points:
            return int(points["D"].get("idx", 0))
        if "right_peak" in points:
            return int(points["right_peak"].get("idx", 0))
        if "right_shoulder" in points:
            return int(points["right_shoulder"].get("idx", 0))
        if "right_trough" in points:
            return int(points["right_trough"].get("idx", 0))
        return 0

    found.sort(key=lambda p: (_recency(p), p.confidence), reverse=True)
    return [p.to_dict() for p in found]
