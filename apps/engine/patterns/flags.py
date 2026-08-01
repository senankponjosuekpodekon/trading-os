"""
Flags and Pennants detection — continuation patterns.

Flag: sharp impulsive move (pole) followed by a shallow counter-trend channel.
Pennant: sharp impulsive move followed by a symmetrical triangle compression.

Both signal continuation of the prior trend after breakout.
"""
from __future__ import annotations

import pandas as pd
import numpy as np

from patterns.pattern import MarketPattern
from patterns.double_top import _pattern_buffer


def _detect_impulse(
    df: pd.DataFrame,
    min_bars: int = 3,
    max_bars: int = 10,
    min_strength: float = 2.0,
) -> tuple[str, int, int, float] | None:
    """
    Detect a strong impulsive move in the most recent bars.

    Returns: (direction, start_idx, end_idx, strength_ratio) or None.
    strength_ratio = impulse_body / avg_body_of_prior_bars
    """
    close = df["close"]
    open_ = df["open"]
    n = len(df)

    for impulse_len in range(min_bars, min(max_bars + 1, n)):
        end = n - 1
        start = n - 1 - impulse_len

        impulse_body = abs(float(close.iloc[end]) - float(open_.iloc[start]))
        if impulse_body <= 0:
            continue

        # Average body of bars before the impulse
        prior_start = max(0, start - impulse_len)
        prior_bodies = (open_.iloc[prior_start:start] - close.iloc[prior_start:start]).abs()
        avg_prior = float(prior_bodies.mean()) if len(prior_bodies) > 0 else impulse_body

        if avg_prior <= 0:
            continue

        strength = impulse_body / avg_prior
        if strength < min_strength:
            continue

        direction = "BUY" if float(close.iloc[end]) > float(open_.iloc[start]) else "SELL"
        return (direction, start, end, strength)

    return None


def detect_flag(
    df: pd.DataFrame,
    min_pole_strength: float = 2.0,
    max_flag_bars: int = 15,
    max_retracement: float = 0.5,
) -> MarketPattern | None:
    """
    Detect a bull/bear flag continuation pattern.

    A flag consists of:
      1. A strong impulsive move (pole)
      2. A shallow counter-trend consolidation (flag)
      3. The consolidation retraces ≤ 50% of the impulse
    """
    n = len(df)
    if n < 20:
        return None

    impulse = _detect_impulse(df, min_strength=min_pole_strength)
    if impulse is None:
        return None

    direction, pole_start, pole_end, strength = impulse

    # Flag area = bars after the pole
    flag_df = df.iloc[pole_end + 1:]
    if len(flag_df) < 3 or len(flag_df) > max_flag_bars:
        return None

    pole_high = float(df["high"].iloc[pole_start:pole_end + 1].max())
    pole_low = float(df["low"].iloc[pole_start:pole_end + 1].min())
    pole_size = pole_high - pole_low
    if pole_size <= 0:
        return None

    # Check retracement depth
    if direction == "BUY":
        retracement = (pole_high - float(flag_df["low"].min())) / pole_size
        # Flag should slope slightly downward (counter-trend)
        flag_slope = float(flag_df["close"].iloc[-1]) - float(flag_df["close"].iloc[0])
        if flag_slope > 0:
            # Slight upward drift is acceptable but reduce confidence
            pass
    else:
        retracement = (float(flag_df["high"].max()) - pole_low) / pole_size
        flag_slope = float(flag_df["close"].iloc[-1]) - float(flag_df["close"].iloc[0])

    if retracement > max_retracement:
        return None

    # Flag channel: check that highs and lows form a rough channel
    flag_high = float(flag_df["high"].max())
    flag_low = float(flag_df["low"].min())
    flag_range = flag_high - flag_low
    if flag_range <= 0:
        return None

    # Flag should be tighter than the pole
    flag_to_pole_ratio = flag_range / pole_size
    if flag_to_pole_ratio > 0.6:
        return None  # Flag too wide

    buffer = _pattern_buffer(df)

    if direction == "BUY":
        entry = float(flag_df["close"].iloc[-1])
        stop_loss = flag_low - buffer
        # Target = pole projection from breakout
        target = entry + pole_size
        confidence = min(0.60 + strength * 0.05 + (1 - retracement) * 0.10, 0.85)
    else:
        entry = float(flag_df["close"].iloc[-1])
        stop_loss = flag_high + buffer
        target = entry - pole_size
        confidence = min(0.60 + strength * 0.05 + (1 - retracement) * 0.10, 0.85)

    return MarketPattern(
        name="flag",
        category="continuation",
        direction=direction,
        confidence=round(confidence, 4),
        points={
            "pole_start": {"idx": int(pole_start), "price": round(float(df["close"].iloc[pole_start]), 6)},
            "pole_end": {"idx": int(pole_end), "price": round(float(df["close"].iloc[pole_end]), 6)},
            "flag_high": round(flag_high, 6),
            "flag_low": round(flag_low, 6),
            "retracement": round(retracement, 4),
            "pole_strength": round(strength, 2),
        },
        prz={"min": round(flag_low, 6), "max": round(flag_high, 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6), round(target + (target - entry) * 0.5, 6)],
        reason=f"Flag {direction}: pole strength {strength:.1f}×, retracement {retracement:.1%}, flag/pole ratio {flag_to_pole_ratio:.2f}",
    )


def detect_pennant(
    df: pd.DataFrame,
    min_pole_strength: float = 2.0,
    max_pennant_bars: int = 20,
    max_retracement: float = 0.5,
) -> MarketPattern | None:
    """
    Detect a bull/bear pennant continuation pattern.

    A pennant consists of:
      1. A strong impulsive move (pole)
      2. A symmetrical triangle consolidation (converging highs/lows)
      3. Breakout in the direction of the pole
    """
    n = len(df)
    if n < 20:
        return None

    impulse = _detect_impulse(df, min_strength=min_pole_strength)
    if impulse is None:
        return None

    direction, pole_start, pole_end, strength = impulse

    pennant_df = df.iloc[pole_end + 1:]
    if len(pennant_df) < 5 or len(pennant_df) > max_pennant_bars:
        return None

    pole_high = float(df["high"].iloc[pole_start:pole_end + 1].max())
    pole_low = float(df["low"].iloc[pole_start:pole_end + 1].min())
    pole_size = pole_high - pole_low
    if pole_size <= 0:
        return None

    # Check for converging trendlines (symmetrical triangle)
    highs = pennant_df["high"].values
    lows = pennant_df["low"].values
    x = np.arange(len(highs))

    # Fit linear regression to highs (should slope down) and lows (should slope up)
    if len(highs) < 3:
        return None

    high_slope = np.polyfit(x, highs, 1)[0]
    low_slope = np.polyfit(x, lows, 1)[0]

    # Pennant: highs decreasing, lows increasing (converging)
    if high_slope >= 0 or low_slope <= 0:
        return None

    # Check retracement
    if direction == "BUY":
        retracement = (pole_high - float(pennant_df["low"].min())) / pole_size
    else:
        retracement = (float(pennant_df["high"].max()) - pole_low) / pole_size

    if retracement > max_retracement:
        return None

    # Convergence rate
    high_at_start = highs[0]
    high_at_end = highs[-1]
    low_at_start = lows[0]
    low_at_end = lows[-1]
    range_start = high_at_start - low_at_start
    range_end = high_at_end - low_at_end
    if range_start <= 0:
        return None

    compression_ratio = range_end / range_start if range_start > 0 else 1.0
    if compression_ratio > 0.8:
        return None  # Not enough convergence

    buffer = _pattern_buffer(df)
    entry = float(pennant_df["close"].iloc[-1])

    if direction == "BUY":
        stop_loss = float(pennant_df["low"].min()) - buffer
        target = entry + pole_size
        confidence = min(0.60 + strength * 0.05 + (1 - compression_ratio) * 0.15, 0.85)
    else:
        stop_loss = float(pennant_df["high"].max()) + buffer
        target = entry - pole_size
        confidence = min(0.60 + strength * 0.05 + (1 - compression_ratio) * 0.15, 0.85)

    return MarketPattern(
        name="pennant",
        category="continuation",
        direction=direction,
        confidence=round(confidence, 4),
        points={
            "pole_start": {"idx": int(pole_start), "price": round(float(df["close"].iloc[pole_start]), 6)},
            "pole_end": {"idx": int(pole_end), "price": round(float(df["close"].iloc[pole_end]), 6)},
            "pennant_high_start": round(high_at_start, 6),
            "pennant_high_end": round(high_at_end, 6),
            "pennant_low_start": round(low_at_start, 6),
            "pennant_low_end": round(low_at_end, 6),
            "compression_ratio": round(compression_ratio, 4),
            "pole_strength": round(strength, 2),
        },
        prz={"min": round(low_at_end, 6), "max": round(high_at_end, 6)},
        entry=round(entry, 6),
        stop_loss=round(stop_loss, 6),
        targets=[round(target, 6), round(target + (target - entry) * 0.5, 6)],
        reason=f"Pennant {direction}: pole strength {strength:.1f}×, compression {compression_ratio:.2f}, retracement {retracement:.1%}",
    )
