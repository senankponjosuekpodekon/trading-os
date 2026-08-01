"""
Compression and Triangle detection — breakout patterns.

Detects:
  - Symmetrical triangle (converging trendlines)
  - Ascending triangle (flat highs, rising lows)
  - Descending triangle (flat lows, declining highs)
  - Range compression (volatility squeeze preceding breakout)
"""
from __future__ import annotations

import logging
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

from patterns.pattern import MarketPattern
from patterns.double_top import _pattern_buffer


def _fit_slope(values: np.ndarray) -> float:
    """Linear regression slope of values."""
    x = np.arange(len(values))
    if len(values) < 2:
        return 0.0
    return float(np.polyfit(x, values, 1)[0])


def detect_symmetrical_triangle(
    df: pd.DataFrame,
    min_bars: int = 10,
    max_bars: int = 40,
    min_convergence: float = 0.3,
) -> MarketPattern | None:
    """
    Symmetrical triangle: highs descending, lows ascending, converging.
    Direction determined by the breakout (or assumed from prior trend).
    """
    n = len(df)
    if n < min_bars:
        return None

    window = df.iloc[-min(max_bars, n):]
    if len(window) < min_bars:
        return None

    highs = window["high"].values
    lows = window["low"].values

    high_slope = _fit_slope(highs)
    low_slope = _fit_slope(lows)

    # Highs must descend, lows must ascend
    if high_slope >= 0 or low_slope <= 0:
        return None

    # Convergence: range at end vs range at start
    range_start = highs[0] - lows[0]
    range_end = highs[-1] - lows[-1]
    if range_start <= 0:
        return None

    compression = 1.0 - (range_end / range_start)
    if compression < min_convergence:
        return None

    # Apex projection
    high_line_end = highs[-1]
    low_line_end = lows[-1]
    apex = (high_line_end + low_line_end) / 2.0

    # Determine direction from prior trend
    prior_trend = float(df["close"].iloc[-1]) - float(df["close"].iloc[-max_bars])
    direction = "BUY" if prior_trend > 0 else "SELL"

    buffer = _pattern_buffer(df)
    entry = float(df["close"].iloc[-1])

    if direction == "BUY":
        stop_loss = low_line_end - buffer
        target = entry + (range_start * 0.618)
    else:
        stop_loss = high_line_end + buffer
        target = entry - (range_start * 0.618)

    confidence = min(0.55 + compression * 0.25, 0.80)

    return MarketPattern(
        name="symmetrical_triangle",
        category="continuation",
        direction=direction,
        confidence=round(confidence, 4),
        points={
            "high_start": round(float(highs[0]), 6),
            "high_end": round(float(highs[-1]), 6),
            "low_start": round(float(lows[0]), 6),
            "low_end": round(float(lows[-1]), 6),
            "apex": round(apex, 6),
            "compression": round(compression, 4),
        },
        prz={"min": round(float(lows[-1]), 6), "max": round(float(highs[-1]), 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6)],
        reason=f"Symmetrical triangle: compression {compression:.1%}, high slope {high_slope:.4f}, low slope {low_slope:.4f}",
    )


def detect_ascending_triangle(
    df: pd.DataFrame,
    min_bars: int = 10,
    max_bars: int = 40,
    flat_tolerance: float = 0.003,
) -> MarketPattern | None:
    """
    Ascending triangle: flat resistance highs, rising support lows.
    Bullish continuation/breakout pattern.
    """
    n = len(df)
    if n < min_bars:
        return None

    window = df.iloc[-min(max_bars, n):]
    if len(window) < min_bars:
        return None

    highs = window["high"].values
    lows = window["low"].values

    # Highs should be roughly flat
    high_mean = float(np.mean(highs))
    high_deviation = float(np.std(highs)) / high_mean if high_mean > 0 else 1.0
    if high_deviation > flat_tolerance:
        return None

    # Lows should be ascending
    low_slope = _fit_slope(lows)
    if low_slope <= 0:
        return None

    resistance = high_mean
    buffer = _pattern_buffer(df)
    entry = float(df["close"].iloc[-1])

    # Check if we've broken resistance
    broken = float(df["close"].iloc[-1]) > resistance
    if not broken:
        # Pending breakout — still valid as a forming pattern
        pass

    stop_loss = float(lows[-1]) - buffer
    target = resistance + (resistance - float(lows[0]))

    confidence = min(0.60 + low_slope * 100, 0.80)
    if broken:
        confidence = min(confidence + 0.10, 0.90)

    return MarketPattern(
        name="ascending_triangle",
        category="continuation",
        direction="BUY",
        confidence=round(confidence, 4),
        points={
            "resistance": round(resistance, 6),
            "low_start": round(float(lows[0]), 6),
            "low_end": round(float(lows[-1]), 6),
            "low_slope": round(low_slope, 6),
            "broken": broken,
        },
        prz={"min": round(float(lows[-1]), 6), "max": round(resistance, 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6)],
        reason=f"Ascending triangle: resistance {resistance:.2f}, low slope {low_slope:.4f}, broken={broken}",
    )


def detect_descending_triangle(
    df: pd.DataFrame,
    min_bars: int = 10,
    max_bars: int = 40,
    flat_tolerance: float = 0.003,
) -> MarketPattern | None:
    """
    Descending triangle: flat support lows, declining resistance highs.
    Bearish continuation/breakout pattern.
    """
    n = len(df)
    if n < min_bars:
        return None

    window = df.iloc[-min(max_bars, n):]
    if len(window) < min_bars:
        return None

    highs = window["high"].values
    lows = window["low"].values

    # Lows should be roughly flat
    low_mean = float(np.mean(lows))
    low_deviation = float(np.std(lows)) / low_mean if low_mean > 0 else 1.0
    if low_deviation > flat_tolerance:
        return None

    # Highs should be descending
    high_slope = _fit_slope(highs)
    if high_slope >= 0:
        return None

    support = low_mean
    buffer = _pattern_buffer(df)
    entry = float(df["close"].iloc[-1])

    broken = float(df["close"].iloc[-1]) < support
    if not broken:
        pass

    stop_loss = float(highs[-1]) + buffer
    target = support - (float(highs[0]) - support)

    confidence = min(0.60 + abs(high_slope) * 100, 0.80)
    if broken:
        confidence = min(confidence + 0.10, 0.90)

    return MarketPattern(
        name="descending_triangle",
        category="continuation",
        direction="SELL",
        confidence=round(confidence, 4),
        points={
            "support": round(support, 6),
            "high_start": round(float(highs[0]), 6),
            "high_end": round(float(highs[-1]), 6),
            "high_slope": round(high_slope, 6),
            "broken": broken,
        },
        prz={"min": round(support, 6), "max": round(float(highs[-1]), 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6)],
        reason=f"Descending triangle: support {support:.2f}, high slope {high_slope:.4f}, broken={broken}",
    )


def detect_range_compression(
    df: pd.DataFrame,
    window: int = 20,
    min_compression: float = 0.4,
) -> MarketPattern | None:
    """
    Range compression / volatility squeeze.

    Detects when recent range is significantly tighter than the preceding period.
    Indicates an impending breakout (direction TBD from context).
    """
    n = len(df)
    if n < window * 2:
        return None

    recent = df.iloc[-window:]
    prior = df.iloc[-window * 2:-window]

    recent_range = float(recent["high"].max() - recent["low"].min())
    prior_range = float(prior["high"].max() - prior["low"].min())

    if prior_range <= 0:
        return None

    compression = 1.0 - (recent_range / prior_range)
    if compression < min_compression:
        return None

    # Direction from recent close vs midpoint
    mid = (float(recent["high"].max()) + float(recent["low"].min())) / 2.0
    close = float(df["close"].iloc[-1])
    direction = "BUY" if close > mid else "SELL"

    buffer = _pattern_buffer(df)
    entry = close

    if direction == "BUY":
        stop_loss = float(recent["low"].min()) - buffer
        target = entry + prior_range * 0.5
    else:
        stop_loss = float(recent["high"].max()) + buffer
        target = entry - prior_range * 0.5

    confidence = min(0.50 + compression * 0.30, 0.75)

    return MarketPattern(
        name="range_compression",
        category="breakout",
        direction=direction,
        confidence=round(confidence, 4),
        points={
            "recent_range": round(recent_range, 6),
            "prior_range": round(prior_range, 6),
            "compression": round(compression, 4),
        },
        prz={"min": round(float(recent["low"].min()), 6), "max": round(float(recent["high"].max()), 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6)],
        reason=f"Range compression: {compression:.1%} tighter than prior {window} bars",
    )


def detect_all_compression(df: pd.DataFrame) -> list[MarketPattern]:
    """Detect all compression/triangle patterns in the given DataFrame."""
    results: list[MarketPattern] = []

    for detector in (
        detect_symmetrical_triangle,
        detect_ascending_triangle,
        detect_descending_triangle,
        detect_range_compression,
    ):
        try:
            pattern = detector(df)
            if pattern is not None:
                results.append(pattern)
        except Exception as exc:
            logger.warning("compression_detector_failed", detector=detector.__name__, error=str(exc))

    return results
