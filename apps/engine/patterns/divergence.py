"""
RSI Divergence Detection — Confirmations for harmonic patterns and reversals.

Detects regular and hidden divergences between price and RSI:
  - Regular bullish: Lower Low price + Higher Low RSI → reversal up
  - Regular bearish: Higher High price + Lower High RSI → reversal down
  - Hidden bullish: Higher Low price + Lower Low RSI → continuation up
  - Hidden bearish: Lower High price + Higher High RSI → continuation down
"""
from __future__ import annotations

import pandas as pd
import numpy as np


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Compute RSI using EMA smoothing (Wilder's method)."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _find_swing_lows(
    df: pd.DataFrame, lookback: int = 5
) -> list[tuple[int, float, float]]:
    """Find recent swing lows: (index, price_low, rsi_at_low)."""
    lows = []
    low_col = df["low"].values
    rsi_col = df["rsi"].values if "rsi" in df.columns else None
    n = len(df)

    for i in range(lookback, n - lookback):
        window = low_col[i - lookback : i + lookback + 1]
        if low_col[i] == np.min(window):
            rsi_val = float(rsi_col[i]) if rsi_col is not None else 0.0
            lows.append((i, float(low_col[i]), rsi_val))
    return lows


def _find_swing_highs(
    df: pd.DataFrame, lookback: int = 5
) -> list[tuple[int, float, float]]:
    """Find recent swing highs: (index, price_high, rsi_at_high)."""
    highs = []
    high_col = df["high"].values
    rsi_col = df["rsi"].values if "rsi" in df.columns else None
    n = len(df)

    for i in range(lookback, n - lookback):
        window = high_col[i - lookback : i + lookback + 1]
        if high_col[i] == np.max(window):
            rsi_val = float(rsi_col[i]) if rsi_col is not None else 0.0
            highs.append((i, float(high_col[i]), rsi_val))
    return highs


def detect_rsi_divergence(
    df: pd.DataFrame,
    rsi_period: int = 14,
    lookback: int = 5,
    min_separation: int = 10,
) -> dict:
    """
    Detect RSI divergence in the most recent price action.

    Returns dict with:
      - has_divergence: bool
      - divergence_type: "regular_bullish" | "regular_bearish" | "hidden_bullish" | "hidden_bearish" | None
      - rsi_current: float
      - price_current: float
      - details: dict with pivot info
    """
    df = df.copy()
    if "rsi" not in df.columns:
        df["rsi"] = compute_rsi(df["close"], rsi_period)

    if len(df) < lookback * 2 + min_separation:
        return {
            "has_divergence": False,
            "divergence_type": None,
            "rsi_current": float(df["rsi"].iloc[-1]) if len(df) > 0 else 0,
            "price_current": float(df["close"].iloc[-1]) if len(df) > 0 else 0,
            "details": {},
        }

    swing_lows = _find_swing_lows(df, lookback)
    swing_highs = _find_swing_highs(df, lookback)

    result = {
        "has_divergence": False,
        "divergence_type": None,
        "rsi_current": float(df["rsi"].iloc[-1]),
        "price_current": float(df["close"].iloc[-1]),
        "details": {},
    }

    # Check regular bullish: Lower Low price + Higher Low RSI
    if len(swing_lows) >= 2:
        recent = swing_lows[-1]
        for prev in reversed(swing_lows[:-1]):
            if recent[0] - prev[0] < min_separation:
                continue
            if recent[1] < prev[1] and recent[2] > prev[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "regular_bullish"
                result["details"] = {
                    "prev_low": {"idx": prev[0], "price": prev[1], "rsi": prev[2]},
                    "curr_low": {"idx": recent[0], "price": recent[1], "rsi": recent[2]},
                }
                return result
            break

    # Check regular bearish: Higher High price + Lower High RSI
    if len(swing_highs) >= 2:
        recent = swing_highs[-1]
        for prev in reversed(swing_highs[:-1]):
            if recent[0] - prev[0] < min_separation:
                continue
            if recent[1] > prev[1] and recent[2] < prev[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "regular_bearish"
                result["details"] = {
                    "prev_high": {"idx": prev[0], "price": prev[1], "rsi": prev[2]},
                    "curr_high": {"idx": recent[0], "price": recent[1], "rsi": recent[2]},
                }
                return result
            break

    # Check hidden bullish: Higher Low price + Lower Low RSI → continuation up
    if len(swing_lows) >= 2:
        recent = swing_lows[-1]
        for prev in reversed(swing_lows[:-1]):
            if recent[0] - prev[0] < min_separation:
                continue
            if recent[1] > prev[1] and recent[2] < prev[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "hidden_bullish"
                result["details"] = {
                    "prev_low": {"idx": prev[0], "price": prev[1], "rsi": prev[2]},
                    "curr_low": {"idx": recent[0], "price": recent[1], "rsi": recent[2]},
                }
                return result
            break

    # Check hidden bearish: Lower High price + Higher High RSI → continuation down
    if len(swing_highs) >= 2:
        recent = swing_highs[-1]
        for prev in reversed(swing_highs[:-1]):
            if recent[0] - prev[0] < min_separation:
                continue
            if recent[1] < prev[1] and recent[2] > prev[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "hidden_bearish"
                result["details"] = {
                    "prev_high": {"idx": prev[0], "price": prev[1], "rsi": prev[2]},
                    "curr_high": {"idx": recent[0], "price": recent[1], "rsi": recent[2]},
                }
                return result
            break

    return result


def check_rsi_divergence_at_d(
    df: pd.DataFrame,
    d_idx: int,
    d_price: float,
    direction: str,
    rsi_period: int = 14,
    lookback: int = 8,
) -> dict:
    """
    Check for RSI divergence specifically at a harmonic pattern's Point D.

    For bullish (D is a low): Lower Low price + Higher Low RSI
    For bearish (D is a high): Higher High price + Lower High RSI
    """
    df = df.copy()
    if "rsi" not in df.columns:
        df["rsi"] = compute_rsi(df["close"], rsi_period)

    result = {
        "has_divergence": False,
        "divergence_type": None,
        "rsi_at_d": float(df["rsi"].iloc[d_idx]) if d_idx < len(df) else None,
    }

    if direction == "bullish":
        # Find previous swing low before D
        start = max(0, d_idx - lookback * 3)
        window = df.iloc[start : d_idx + 1]
        lows = _find_swing_lows(window, lookback)

        if len(lows) >= 2:
            prev_low = lows[-2]
            curr_low = lows[-1]
            if curr_low[1] < prev_low[1] and curr_low[2] > prev_low[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "regular_bullish"
                result["details"] = {
                    "prev": {"idx": prev_low[0], "price": prev_low[1], "rsi": prev_low[2]},
                    "curr": {"idx": curr_low[0], "price": curr_low[1], "rsi": curr_low[2]},
                }

    elif direction == "bearish":
        start = max(0, d_idx - lookback * 3)
        window = df.iloc[start : d_idx + 1]
        highs = _find_swing_highs(window, lookback)

        if len(highs) >= 2:
            prev_high = highs[-2]
            curr_high = highs[-1]
            if curr_high[1] > prev_high[1] and curr_high[2] < prev_high[2]:
                result["has_divergence"] = True
                result["divergence_type"] = "regular_bearish"
                result["details"] = {
                    "prev": {"idx": prev_high[0], "price": prev_high[1], "rsi": prev_high[2]},
                    "curr": {"idx": curr_high[0], "price": curr_high[1], "rsi": curr_high[2]},
                }

    return result
