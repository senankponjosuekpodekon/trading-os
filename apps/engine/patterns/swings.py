"""
Swing Detection — ZigZag and Fractals for robust pivot identification.

ZigZag: filters noise by keeping only moves above a threshold percentage.
Fractals (Bill Williams): identifies local extremes over a window.

Both produce pivot points used by harmonic detection, H&S, double tops, etc.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from dataclasses import dataclass


@dataclass
class Pivot:
    index: int
    price: float
    type: str  # "high" or "low"


def detect_fractals(
    df: pd.DataFrame,
    n: int = 2,
) -> pd.DataFrame:
    """
    Detect Bill Williams fractals.

    Fractal high: high[i] is the maximum of high[i-n .. i+n]
    Fractal low:  low[i] is the minimum of low[i-n .. i+n]

    Adds columns: fractal_high, fractal_low
    """
    df = df.copy()
    highs = df["high"].values
    lows = df["low"].values
    length = len(df)

    fractal_high = np.full(length, False)
    fractal_low = np.full(length, False)

    for i in range(n, length - n):
        if highs[i] == np.max(highs[i - n : i + n + 1]):
            fractal_high[i] = True
        if lows[i] == np.min(lows[i - n : i + n + 1]):
            fractal_low[i] = True

    df["fractal_high"] = fractal_high
    df["fractal_low"] = fractal_low
    return df


def zigzag(
    df: pd.DataFrame,
    threshold_pct: float = 0.005,
    price_col: str = "close",
) -> pd.DataFrame:
    """
    Simple ZigZag indicator based on a percentage threshold.

    Only keeps pivots where the price moved at least threshold_pct
    from the last pivot. Alternates between highs and lows.

    Adds column: zigzag (NaN except at pivot points, value = price at pivot)
    """
    df = df.copy()
    prices = df[price_col].values
    length = len(prices)
    zz = np.full(length, np.nan)

    if length < 2:
        df["zigzag"] = zz
        return df

    last_pivot = prices[0]
    last_pivot_idx = 0
    trend = 0  # 1 = up, -1 = down

    for i in range(1, length):
        change = (prices[i] - last_pivot) / last_pivot if last_pivot != 0 else 0

        if trend == 0:
            if abs(change) >= threshold_pct:
                trend = 1 if change > 0 else -1
                zz[last_pivot_idx] = last_pivot
                last_pivot = prices[i]
                last_pivot_idx = i
        elif trend == 1:
            if prices[i] > last_pivot:
                last_pivot = prices[i]
                last_pivot_idx = i
            elif (last_pivot - prices[i]) / last_pivot >= threshold_pct:
                zz[last_pivot_idx] = last_pivot
                trend = -1
                last_pivot = prices[i]
                last_pivot_idx = i
        elif trend == -1:
            if prices[i] < last_pivot:
                last_pivot = prices[i]
                last_pivot_idx = i
            elif (prices[i] - last_pivot) / last_pivot >= threshold_pct:
                zz[last_pivot_idx] = last_pivot
                trend = 1
                last_pivot = prices[i]
                last_pivot_idx = i

    zz[last_pivot_idx] = last_pivot
    df["zigzag"] = zz
    return df


def zigzag_with_highs_lows(
    df: pd.DataFrame,
    threshold_pct: float = 0.005,
) -> pd.DataFrame:
    """
    ZigZag using actual highs and lows instead of close.

    More accurate for pattern detection since swing highs/lows
    are defined by extremes, not closes.
    """
    df = df.copy()
    highs = df["high"].values
    lows = df["low"].values
    length = len(df)
    zz = np.full(length, np.nan)
    zz_type = np.full(length, "", dtype=object)

    if length < 2:
        df["zigzag"] = zz
        df["zigzag_type"] = zz_type
        return df

    # Start with first bar
    last_pivot_idx = 0
    last_pivot_price = highs[0]
    using_high = True
    trend = 0

    for i in range(1, length):
        if trend == 0:
            # Determine initial direction
            up_move = (highs[i] - last_pivot_price) / last_pivot_price
            down_move = (last_pivot_price - lows[i]) / last_pivot_price
            if up_move >= threshold_pct:
                trend = 1
                zz[last_pivot_idx] = last_pivot_price
                zz_type[last_pivot_idx] = "low" if not using_high else "high"
                last_pivot_price = highs[i]
                last_pivot_idx = i
                using_high = True
            elif down_move >= threshold_pct:
                trend = -1
                zz[last_pivot_idx] = last_pivot_price
                zz_type[last_pivot_idx] = "high" if using_high else "low"
                last_pivot_price = lows[i]
                last_pivot_idx = i
                using_high = False
        elif trend == 1:
            # Looking for higher highs, then reversal
            if highs[i] > last_pivot_price:
                last_pivot_price = highs[i]
                last_pivot_idx = i
            elif (last_pivot_price - lows[i]) / last_pivot_price >= threshold_pct:
                zz[last_pivot_idx] = last_pivot_price
                zz_type[last_pivot_idx] = "high"
                trend = -1
                last_pivot_price = lows[i]
                last_pivot_idx = i
                using_high = False
        elif trend == -1:
            if lows[i] < last_pivot_price:
                last_pivot_price = lows[i]
                last_pivot_idx = i
            elif (highs[i] - last_pivot_price) / last_pivot_price >= threshold_pct:
                zz[last_pivot_idx] = last_pivot_price
                zz_type[last_pivot_idx] = "low"
                trend = 1
                last_pivot_price = highs[i]
                last_pivot_idx = i
                using_high = True

    zz[last_pivot_idx] = last_pivot_price
    zz_type[last_pivot_idx] = "high" if using_high else "low"
    df["zigzag"] = zz
    df["zigzag_type"] = zz_type
    return df


def extract_pivots(df: pd.DataFrame, zz_col: str = "zigzag") -> list[Pivot]:
    """Extract Pivot objects from a DataFrame with a zigzag column."""
    pivots: list[Pivot] = []
    zz = df[zz_col]
    for idx in zz.index[zz.notna()]:
        price = float(zz.loc[idx])
        # Determine type from zigzag_type if available
        if "zigzag_type" in df.columns:
            ptype = str(df.loc[idx, "zigzag_type"]) or "high"
        else:
            ptype = "high" if price >= float(df.loc[idx, "close"]) else "low"
        pivots.append(Pivot(index=int(idx), price=price, type=ptype))
    return pivots
