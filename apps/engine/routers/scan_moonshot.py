"""Moonshot take-profit helpers for micro-cap crypto."""
from __future__ import annotations
from typing import Optional


def _compute_moonshot_tp(
    signal: str,
    entry: Optional[float],
    tp1: Optional[float],
    tp2: Optional[float],
    market_cap_tier: str,
) -> Optional[dict]:
    """For MICRO cap crypto, add moonshot take-profit: sell 50% at 2x entry.

    Returns None if not applicable (non-MICRO or no entry price).
    """
    if market_cap_tier != "MICRO" or entry is None or entry <= 0:
        return None

    if signal == "BUY":
        tp_moonshot = round(entry * 2.0, 6)  # 2x entry
        tp_3x = round(entry * 3.0, 6)       # 3x for trailing moon
    elif signal == "SELL":
        tp_moonshot = round(entry * 0.5, 6)  # 50% of entry (2x inverse)
        tp_3x = round(entry * 0.33, 6)      # 33% of entry (3x inverse)
    else:
        return None

    return {
        "tp_moonshot_2x": tp_moonshot,
        "tp_moonshot_3x": tp_3x,
        "sell_pct_at_2x": 50,  # sell 50% at 2x
        "description": "Moonshot TP: sell 50% at 2x, trail rest to 3x",
    }
