"""
Head & Shoulders (H&S) and Inverse Head & Shoulders detection.
Simplified version: uses three consecutive swing highs/lows.

Includes neckline break confirmation:
  - hs_breakdown: price closes below neckline (confirms bearish H&S)
  - ihs_breakout: price closes above neckline (confirms bullish inverse H&S)
"""
from __future__ import annotations

import pandas as pd

from indicators.swing import find_pivot_highs, find_pivot_lows
from patterns.pattern import MarketPattern
from patterns.double_top import _pattern_buffer


def _in_range(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) / max(abs(b), 1e-9) <= tolerance


def _check_neckline_break(
    df: pd.DataFrame,
    neckline: float,
    rs_idx: int,
    direction: str,
    confirm_bars: int = 5,
) -> bool:
    """
    Check if price has broken the neckline after the right shoulder.

    Args:
        df: Full OHLC DataFrame
        neckline: Neckline price level
        rs_idx: Index of the right shoulder pivot
        direction: "SELL" (H&S, break below) or "BUY" (IH&S, break above)
        confirm_bars: Max bars after right shoulder to check for break

    Returns:
        True if a candle closed beyond the neckline within confirm_bars.
    """
    after = df.loc[rs_idx:].head(confirm_bars + 1)
    if after.empty:
        return False

    for _, row in after.iterrows():
        close = float(row["close"])
        if direction == "SELL" and close < neckline:
            return True
        if direction == "BUY" and close > neckline:
            return True
    return False


def detect_head_and_shoulders(
    df: pd.DataFrame,
    tolerance: float = 0.03,
    left: int = 2,
    right: int = 2,
    require_break: bool = False,
) -> MarketPattern | None:
    """
    Détecte un Head & Shoulders baissier (3 swing highs: left shoulder, head, right shoulder).
    Les épaules doivent être approximativement au même niveau, la tête plus haute.

    Args:
        require_break: If True, only return pattern if neckline has been broken (confirmed).
    """
    if len(df) < 15:
        return None

    high = df["high"]
    pivots = find_pivot_highs(high, left=left, right=right)
    idxs = pivots[pivots].index.to_list()
    if len(idxs) < 3:
        return None

    ls_idx, h_idx, rs_idx = idxs[-3], idxs[-2], idxs[-1]
    ls, h, rs = float(high.loc[ls_idx]), float(high.loc[h_idx]), float(high.loc[rs_idx])
    shoulder_avg = (ls + rs) / 2.0

    if not _in_range(ls, rs, tolerance):
        return None
    if h <= shoulder_avg * (1 + tolerance):
        return None

    # Neckline = creux entre les épaules / tête
    between = df.loc[ls_idx:rs_idx]
    if between.empty:
        return None
    neckline = float(between["low"].min())

    # Neckline break confirmation
    broken = _check_neckline_break(df, neckline, rs_idx, "SELL")
    if require_break and not broken:
        return None

    measured = h - neckline
    buffer = _pattern_buffer(df)

    confidence = min(0.55 + measured / h, 0.85)
    if broken:
        confidence = min(confidence + 0.10, 0.95)  # boost confirmed patterns

    return MarketPattern(
        name="head_and_shoulders",
        category="reversal",
        direction="SELL",
        confidence=round(confidence, 4),
        points={
            "left_shoulder": {"idx": int(ls_idx), "price": round(ls, 6)},
            "head": {"idx": int(h_idx), "price": round(h, 6)},
            "right_shoulder": {"idx": int(rs_idx), "price": round(rs, 6)},
            "neckline": round(neckline, 6),
            "neckline_broken": broken,
        },
        prz={"min": round(neckline, 6), "max": round(shoulder_avg + buffer, 6)},
        entry=round(neckline, 6),
        stop_loss=round(shoulder_avg + buffer, 6),
        targets=[round(neckline - measured * 0.618, 6), round(neckline - measured, 6)],
        reason=f"Head & Shoulders: épaules {round(shoulder_avg,2)}, tête {round(h,2)}, neckline {round(neckline,2)}, break={'confirmed' if broken else 'pending'}",
    )


def detect_inverse_head_and_shoulders(
    df: pd.DataFrame,
    tolerance: float = 0.03,
    left: int = 2,
    right: int = 2,
    require_break: bool = False,
) -> MarketPattern | None:
    """
    Détecte un Inverse Head & Shoulders haussier.

    Args:
        require_break: If True, only return pattern if neckline has been broken (confirmed).
    """
    if len(df) < 15:
        return None

    low = df["low"]
    pivots = find_pivot_lows(low, left=left, right=right)
    idxs = pivots[pivots].index.to_list()
    if len(idxs) < 3:
        return None

    ls_idx, h_idx, rs_idx = idxs[-3], idxs[-2], idxs[-1]
    ls, h, rs = float(low.loc[ls_idx]), float(low.loc[h_idx]), float(low.loc[rs_idx])
    shoulder_avg = (ls + rs) / 2.0

    if not _in_range(ls, rs, tolerance):
        return None
    if h >= shoulder_avg * (1 - tolerance):
        return None

    between = df.loc[ls_idx:rs_idx]
    if between.empty:
        return None
    neckline = float(between["high"].max())

    # Neckline break confirmation
    broken = _check_neckline_break(df, neckline, rs_idx, "BUY")
    if require_break and not broken:
        return None

    measured = neckline - h
    buffer = _pattern_buffer(df)

    confidence = min(0.55 + measured / neckline, 0.85)
    if broken:
        confidence = min(confidence + 0.10, 0.95)

    return MarketPattern(
        name="inverse_head_and_shoulders",
        category="reversal",
        direction="BUY",
        confidence=round(confidence, 4),
        points={
            "left_shoulder": {"idx": int(ls_idx), "price": round(ls, 6)},
            "head": {"idx": int(h_idx), "price": round(h, 6)},
            "right_shoulder": {"idx": int(rs_idx), "price": round(rs, 6)},
            "neckline": round(neckline, 6),
            "neckline_broken": broken,
        },
        prz={"min": round(shoulder_avg - buffer, 6), "max": round(neckline, 6)},
        entry=round(neckline, 6),
        stop_loss=round(shoulder_avg - buffer, 6),
        targets=[round(neckline + measured * 0.618, 6), round(neckline + measured, 6)],
        reason=f"Inverse H&S: épaules {round(shoulder_avg,2)}, tête {round(h,2)}, neckline {round(neckline,2)}, break={'confirmed' if broken else 'pending'}",
    )
