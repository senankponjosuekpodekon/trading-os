"""
Direction normalization — bridges the two vocabulary conventions used across the engine.

Candlestick / price-action detectors return "BULLISH" / "BEARISH" / "NEUTRAL".
Pattern / signal / scan code uses "BUY" / "SELL" / "NEUTRAL".

This module centralizes the mapping so comparisons never silently fail.
"""
from __future__ import annotations

_BULLISH = {"BULLISH", "BUY", "LONG"}
_BEARISH = {"BEARISH", "SELL", "SHORT"}


def normalize_direction(value: str | None) -> str:
    """
    Normalize any direction string to the canonical ``BUY`` / ``SELL`` / ``NEUTRAL`` vocabulary.

    >>> normalize_direction("BULLISH")
    'BUY'
    >>> normalize_direction("BEARISH")
    'SELL'
    >>> normalize_direction("BUY")
    'BUY'
    >>> normalize_direction(None)
    'NEUTRAL'
    """
    if value is None:
        return "NEUTRAL"
    v = value.upper().strip()
    if v in _BULLISH:
        return "BUY"
    if v in _BEARISH:
        return "SELL"
    return "NEUTRAL"


def directions_aligned(a: str | None, b: str | None) -> bool:
    """Return True if both directions resolve to the same non-neutral canonical value."""
    na, nb = normalize_direction(a), normalize_direction(b)
    return na != "NEUTRAL" and na == nb


def directions_opposed(a: str | None, b: str | None) -> bool:
    """Return True if the two directions are non-neutral and opposite."""
    na, nb = normalize_direction(a), normalize_direction(b)
    return na != "NEUTRAL" and nb != "NEUTRAL" and na != nb
