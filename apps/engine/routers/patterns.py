"""
Phase 2 — Candlestick Patterns : Pin Bar, Engulfing, Doji, Inside Bar
"""
import pandas as pd


def detect_pin_bar(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Pin Bar : petite body, longue mèche dans un sens.
    Retourne 'BULLISH', 'BEARISH' ou None.
    """
    o, h, l, c = float(open_.iloc[idx]), float(high.iloc[idx]), float(low.iloc[idx]), float(close.iloc[idx])
    body   = abs(c - o)
    rng    = h - l
    if rng == 0:
        return None
    upper_wick = h - max(o, c)
    lower_wick = min(o, c) - l

    if rng < 0.0001:
        return None

    body_ratio = body / rng

    if body_ratio < 0.35:
        if lower_wick >= 2 * upper_wick and lower_wick >= 0.55 * rng:
            return "BULLISH"
        if upper_wick >= 2 * lower_wick and upper_wick >= 0.55 * rng:
            return "BEARISH"
    return None


def detect_engulfing(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Engulfing : bougie courante englobe la précédente.
    """
    if idx < 1:
        return None
    o1, c1 = float(open_.iloc[idx - 1]), float(close.iloc[idx - 1])
    o2, c2 = float(open_.iloc[idx]),     float(close.iloc[idx])

    prev_body = abs(c1 - o1)
    curr_body = abs(c2 - o2)
    if prev_body == 0:
        return None

    if c2 > o2 and o1 > c1:  # Bullish engulfing
        if o2 <= c1 and c2 >= o1 and curr_body > prev_body:
            return "BULLISH"
    if c2 < o2 and o1 < c1:  # Bearish engulfing
        if o2 >= c1 and c2 <= o1 and curr_body > prev_body:
            return "BEARISH"
    return None


def detect_doji(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> bool:
    """Doji : body < 10% du range."""
    o, h, l, c = float(open_.iloc[idx]), float(high.iloc[idx]), float(low.iloc[idx]), float(close.iloc[idx])
    rng = h - l
    if rng == 0:
        return False
    return abs(c - o) / rng < 0.1


def detect_inside_bar(high: pd.Series, low: pd.Series, idx: int) -> bool:
    """Inside Bar : high/low entièrement dans la bougie précédente."""
    if idx < 1:
        return False
    return float(high.iloc[idx]) < float(high.iloc[idx - 1]) and float(low.iloc[idx]) > float(low.iloc[idx - 1])


def scan_last_patterns(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    lookback: int = 3,
) -> dict:
    """
    Scanne les N dernières bougies pour détecter des patterns.
    Retourne un dict résumé des patterns trouvés.
    """
    n = len(close)
    found = {
        "pin_bar":    None,
        "engulfing":  None,
        "doji":       False,
        "inside_bar": False,
    }

    for i in range(n - 1, max(n - lookback - 1, 0), -1):
        if not found["pin_bar"]:
            found["pin_bar"]   = detect_pin_bar(open_, high, low, close, i)
        if not found["engulfing"]:
            found["engulfing"] = detect_engulfing(open_, high, low, close, i)
        if not found["doji"]:
            found["doji"]      = detect_doji(open_, high, low, close, i)
        if not found["inside_bar"]:
            found["inside_bar"] = detect_inside_bar(high, low, i)

    return found


def patterns_bonus(patterns: dict, signal_direction: str) -> tuple[int, list[str]]:
    """
    Bonus score basé sur les patterns détectés.
    Max : +25 pts
    """
    bonus   = 0
    reasons = []

    pin = patterns.get("pin_bar")
    if pin == signal_direction:
        bonus += 15
        reasons.append(f"Pattern: Pin Bar {pin}")
    elif pin and pin != signal_direction:
        bonus -= 8
        reasons.append(f"Pattern: Pin Bar contre-tendance ({pin})")

    eng = patterns.get("engulfing")
    if eng == signal_direction:
        bonus += 15
        reasons.append(f"Pattern: Engulfing {eng}")
    elif eng and eng != signal_direction:
        bonus -= 8
        reasons.append(f"Pattern: Engulfing contre-tendance ({eng})")

    if patterns.get("doji"):
        bonus += 3
        reasons.append("Pattern: Doji (indécision)")

    if patterns.get("inside_bar"):
        bonus += 5
        reasons.append("Pattern: Inside Bar (compression)")

    return min(bonus, 25), reasons
