"""
Double Top / Double Bottom detection.
"""
from __future__ import annotations

import pandas as pd

from indicators.swing import find_pivot_highs, find_pivot_lows
from patterns.pattern import MarketPattern


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period, min_periods=1).mean()


def _pattern_buffer(df: pd.DataFrame) -> float:
    """ATR(14)-based buffer for stop-loss/PRZ, consistent with the rest of the codebase."""
    atr_s = _atr(df["high"], df["low"], df["close"])
    atr_val = float(atr_s.iloc[-1]) if not pd.isna(atr_s.iloc[-1]) else 0.0
    if atr_val <= 0:
        atr_val = float(df["high"].iloc[-1] - df["low"].iloc[-1])
    return atr_val * 0.3


def detect_double_top(
    df: pd.DataFrame,
    tolerance: float = 0.02,
    left: int = 2,
    right: int = 2,
) -> MarketPattern | None:
    """
    Détecte un double top sur les deux derniers swing highs.
    tolerance : écart relatif autorisé entre les deux pics (ex. 0.02 = 2 %).
    """
    if len(df) < 10:
        return None

    high = df["high"]
    pivots = find_pivot_highs(high, left=left, right=right)
    idxs = pivots[pivots].index.to_list()
    if len(idxs) < 2:
        return None

    # Deux derniers swing highs
    i1, i2 = idxs[-2], idxs[-1]
    p1, p2 = float(high.loc[i1]), float(high.loc[i2])
    avg = (p1 + p2) / 2.0
    if avg == 0:
        return None

    if abs(p1 - p2) / avg > tolerance:
        return None

    # Creux entre les deux pics = neckline
    between = df.loc[i1:i2]
    if between.empty:
        return None
    neckline = float(between["low"].min())
    if neckline >= min(p1, p2):
        return None

    measured = avg - neckline
    buffer = _pattern_buffer(df)

    return MarketPattern(
        name="double_top",
        category="reversal",
        direction="SELL",
        confidence=round(min(0.5 + measured / avg, 0.9), 4),
        points={"left_peak": {"idx": int(i1), "price": round(p1, 6)},
                "right_peak": {"idx": int(i2), "price": round(p2, 6)},
                "neckline": round(neckline, 6)},
        prz={"min": round(min(p1, p2) - buffer, 6), "max": round(max(p1, p2) + buffer, 6)},
        entry=round(neckline, 6),
        stop_loss=round(max(p1, p2) + buffer, 6),
        targets=[round(neckline - measured * 0.618, 6), round(neckline - measured, 6)],
        reason=f"Double top: deux pics égaux {round(avg,2)} avec neckline {round(neckline,2)}",
    )


def detect_double_bottom(
    df: pd.DataFrame,
    tolerance: float = 0.02,
    left: int = 2,
    right: int = 2,
) -> MarketPattern | None:
    """Détecte un double bottom sur les deux derniers swing lows."""
    if len(df) < 10:
        return None

    low = df["low"]
    pivots = find_pivot_lows(low, left=left, right=right)
    idxs = pivots[pivots].index.to_list()
    if len(idxs) < 2:
        return None

    i1, i2 = idxs[-2], idxs[-1]
    p1, p2 = float(low.loc[i1]), float(low.loc[i2])
    avg = (p1 + p2) / 2.0
    if avg == 0:
        return None

    if abs(p1 - p2) / avg > tolerance:
        return None

    between = df.loc[i1:i2]
    if between.empty:
        return None
    neckline = float(between["high"].max())
    if neckline <= max(p1, p2):
        return None

    measured = neckline - avg
    buffer = _pattern_buffer(df)

    return MarketPattern(
        name="double_bottom",
        category="reversal",
        direction="BUY",
        confidence=round(min(0.5 + measured / avg, 0.9), 4),
        points={"left_trough": {"idx": int(i1), "price": round(p1, 6)},
                "right_trough": {"idx": int(i2), "price": round(p2, 6)},
                "neckline": round(neckline, 6)},
        prz={"min": round(min(p1, p2) - buffer, 6), "max": round(max(p1, p2) + buffer, 6)},
        entry=round(neckline, 6),
        stop_loss=round(min(p1, p2) - buffer, 6),
        targets=[round(neckline + measured * 0.618, 6), round(neckline + measured, 6)],
        reason=f"Double bottom: deux creux égaux {round(avg,2)} avec neckline {round(neckline,2)}",
    )
