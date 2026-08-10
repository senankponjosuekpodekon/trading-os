"""
Pattern detection coordinator — runs all chart/harmonic pattern detectors on a DataFrame.
"""
from __future__ import annotations

import pandas as pd
from typing import Any

from patterns.double_top import detect_double_top, detect_double_bottom
from patterns.head_shoulders import detect_head_and_shoulders, detect_inverse_head_and_shoulders
from patterns.harmonic import detect_harmonic
from patterns.harmonic_v2 import detect_harmonic_patterns, HarmonicPattern
from patterns.flags import detect_flag, detect_pennant
from patterns.compression import detect_all_compression
from patterns.pattern import MarketPattern
from utils.logger import get_logger

logger = get_logger(__name__)


def _harmonic_v2_to_market_pattern(hp: HarmonicPattern) -> MarketPattern:
    """Convert a HarmonicPattern (v2 dataclass) to a MarketPattern."""
    targets_list = []
    if hp.targets:
        if hp.targets.tp1:
            targets_list.append(hp.targets.tp1)
        if hp.targets.tp2:
            targets_list.append(hp.targets.tp2)

    return MarketPattern(
        name=hp.name.lower(),
        category="harmonic",
        direction="BUY" if hp.direction == "bullish" else "SELL",
        confidence=min(1.0, hp.score / 100.0) if hp.score else 0.5,
        points={
            "X": {"price": hp.X, "idx": hp.X_idx},
            "A": {"price": hp.A, "idx": hp.A_idx},
            "B": {"price": hp.B, "idx": hp.B_idx},
            "C": {"price": hp.C, "idx": hp.C_idx},
            "D": {"price": hp.D, "idx": hp.D_idx},
        },
        prz={"low": hp.prz_low, "high": hp.prz_high},
        entry=hp.D,
        stop_loss=hp.prz_low if hp.direction == "bullish" else hp.prz_high,
        targets=targets_list,
        confluence=[],
        reason=f"Harmonic {hp.name} ({hp.direction}) — ratios: {hp.ratios}",
    )


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
        detect_flag,
        detect_pennant,
        detect_all_compression,
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

    # Harmonic v2 — separate converter needed (different dataclass)
    try:
        h2_patterns = detect_harmonic_patterns(df)
        for hp in h2_patterns:
            found.append(_harmonic_v2_to_market_pattern(hp))
    except Exception as exc:
        logger.warning("pattern_detector_failed", detector="detect_harmonic_patterns_v2", error=str(exc))

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
