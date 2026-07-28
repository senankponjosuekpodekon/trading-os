"""
Swing Detection Engine — Phase A+
- Pivot method (higher timeframe swings)
- ATR-based swing filter (ignore noise smaller than 1× ATR)
- SwingScore weighted by volume, duration and break distance
"""
import pandas as pd
import numpy as np


def find_pivot_highs(high: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Swing high pivot : candle higher than `left` before and `right` after."""
    n = len(high)
    result = pd.Series(False, index=high.index)
    for i in range(left, n - right):
        window = high.iloc[i - left: i + right + 1]
        if high.iloc[i] == window.max():
            result.iloc[i] = True
    return result


def find_pivot_lows(low: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Swing low pivot : candle lower than `left` before and `right` after."""
    n = len(low)
    result = pd.Series(False, index=low.index)
    for i in range(left, n - right):
        window = low.iloc[i - left: i + right + 1]
        if low.iloc[i] == window.min():
            result.iloc[i] = True
    return result


def find_atr_swings(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    length: int = 14,
    min_atr_multiple: float = 1.0,
) -> tuple[pd.Series, pd.Series]:
    """
    Returns ATR-filtered swing highs and lows.
    A new swing is confirmed only when the move from the previous swing
    exceeds `min_atr_multiple * ATR(length)`.
    """
    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = atr_raw.rolling(length).mean()

    swing_highs = pd.Series(False, index=high.index)
    swing_lows = pd.Series(False, index=low.index)

    last_swing_idx: int | None = None
    last_swing_type: str | None = None  # "high" | "low"

    for i in range(length, len(close)):
        # locate local pivots
        is_pivot_high = (
            high.iloc[i] == high.iloc[max(0, i - 2):i + 3].max()
            if i >= 2 and i < len(high) - 2
            else False
        )
        is_pivot_low = (
            low.iloc[i] == low.iloc[max(0, i - 2):i + 3].min()
            if i >= 2 and i < len(low) - 2
            else False
        )

        current_atr = atr.iloc[i]
        if pd.isna(current_atr) or current_atr == 0:
            continue

        if is_pivot_high:
            if last_swing_type == "low":
                move = high.iloc[i] - low.iloc[last_swing_idx]
                if move >= min_atr_multiple * current_atr:
                    swing_highs.iloc[i] = True
                    last_swing_idx = i
                    last_swing_type = "high"
            else:
                # first swing or higher than last high
                if last_swing_idx is None or high.iloc[i] > high.iloc[last_swing_idx]:
                    swing_highs.iloc[i] = True
                    last_swing_idx = i
                    last_swing_type = "high"

        if is_pivot_low:
            if last_swing_type == "high":
                move = high.iloc[last_swing_idx] - low.iloc[i]
                if move >= min_atr_multiple * current_atr:
                    swing_lows.iloc[i] = True
                    last_swing_idx = i
                    last_swing_type = "low"
            else:
                if last_swing_idx is None or low.iloc[i] < low.iloc[last_swing_idx]:
                    swing_lows.iloc[i] = True
                    last_swing_idx = i
                    last_swing_type = "low"

    return swing_highs, swing_lows


def calculate_swing_score(
    swing_idx: int,
    swing_price: float,
    prev_swing_idx: int | None,
    prev_swing_price: float | None,
    volume: pd.Series,
    atr: float,
) -> float:
    """
    Score 0-100 describing the quality of a swing point.
    Higher = stronger structural level.
    """
    if prev_swing_idx is None or prev_swing_price is None or not atr:
        return 50.0

    duration = max(1, swing_idx - prev_swing_idx)
    break_distance = abs(swing_price - prev_swing_price)
    distance_score = min(25, (break_distance / atr) * 5)

    avg_volume = volume.iloc[max(0, swing_idx - 5):swing_idx + 1].mean()
    prev_avg_volume = volume.iloc[max(0, prev_swing_idx - 5):prev_swing_idx + 1].mean()
    volume_ratio = avg_volume / prev_avg_volume if prev_avg_volume and prev_avg_volume > 0 else 1.0
    volume_score = min(25, max(0, (volume_ratio - 1) * 25))

    duration_score = min(25, duration / 2)
    return 25.0 + distance_score + volume_score + duration_score


def get_last_swing_points(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series | None = None,
    method: str = "pivot",
    n_swings: int = 6,
) -> tuple[list[dict], list[dict]]:
    """
    Returns the last `n_swings` highs/lows as dicts with optional SwingScore.
    method: "pivot" | "atr"
    """
    vol = volume if volume is not None else pd.Series(np.ones(len(close)), index=close.index)

    if method == "atr":
        sh_bool, sl_bool = find_atr_swings(high, low, close)
    else:
        sh_bool, sl_bool = find_pivot_highs(high), find_pivot_lows(low)

    highs = [(i, float(high.iloc[i])) for i in range(len(high)) if sh_bool.iloc[i]]
    lows = [(i, float(low.iloc[i])) for i in range(len(low)) if sl_bool.iloc[i]]

    # compute ATR for swing score
    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = float(atr_raw.rolling(14).mean().iloc[-1]) if len(close) >= 14 else 0.0

    def build(points: list[tuple], kind: str) -> list[dict]:
        out: list[dict] = []
        for idx, (i, price) in enumerate(points):
            prev = points[idx - 1] if idx > 0 else None
            score = calculate_swing_score(
                i, price,
                prev[0] if prev else None,
                prev[1] if prev else None,
                vol, atr,
            )
            out.append({"idx": i, "price": price, "type": kind, "score": round(score, 1)})
        return out

    high_points = build(highs, "high")[-n_swings:]
    low_points = build(lows, "low")[-n_swings:]
    return high_points, low_points
