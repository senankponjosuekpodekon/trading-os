"""
Phase 2 — Candlestick Patterns : Pin Bar, Engulfing, Doji, Inside Bar,
Morning Star, Evening Star, Tweezers, Three White Soldiers, Three Black Crows.
"""
import pandas as pd

from utils.direction import directions_aligned, directions_opposed


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


def detect_morning_star(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Morning Star (3 bougies, retournement haussier):
      1. Grande bougie baissière
      2. Petite bougie (gap down, corps réduit)
      3. Grande bougie haussière (clôture au-dessus du milieu de la 1ère)
    """
    if idx < 2:
        return None
    o1, c1 = float(open_.iloc[idx - 2]), float(close.iloc[idx - 2])
    o2, c2, h2, l2 = float(open_.iloc[idx - 1]), float(close.iloc[idx - 1]), float(high.iloc[idx - 1]), float(low.iloc[idx - 1])
    o3, c3 = float(open_.iloc[idx]), float(close.iloc[idx])

    # 1. Bearish candle
    if c1 >= o1:
        return None
    body1 = abs(c1 - o1)

    # 2. Small body, gap down from candle 1
    body2 = abs(c2 - o2)
    rng2 = h2 - l2
    if rng2 == 0:
        return None
    if body2 / rng2 > 0.35:
        return None
    if c2 > o1 and o2 > o1:  # should gap or at least be below
        return None

    # 3. Bullish candle, closes above midpoint of candle 1
    if c3 <= o3:
        return None
    body3 = abs(c3 - o3)
    if body3 < body1 * 0.5:
        return None
    mid1 = (o1 + c1) / 2.0
    if c3 < mid1:
        return None

    return "BULLISH"


def detect_evening_star(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Evening Star (3 bougies, retournement baissier):
      1. Grande bougie haussière
      2. Petite bougie (gap up, corps réduit)
      3. Grande bougie baissière (clôture sous le milieu de la 1ère)
    """
    if idx < 2:
        return None
    o1, c1 = float(open_.iloc[idx - 2]), float(close.iloc[idx - 2])
    o2, c2, h2, l2 = float(open_.iloc[idx - 1]), float(close.iloc[idx - 1]), float(high.iloc[idx - 1]), float(low.iloc[idx - 1])
    o3, c3 = float(open_.iloc[idx]), float(close.iloc[idx])

    # 1. Bullish candle
    if c1 <= o1:
        return None
    body1 = abs(c1 - o1)

    # 2. Small body, gap up from candle 1
    body2 = abs(c2 - o2)
    rng2 = h2 - l2
    if rng2 == 0:
        return None
    if body2 / rng2 > 0.35:
        return None
    if c2 < c1 and o2 < c1:
        return None

    # 3. Bearish candle, closes below midpoint of candle 1
    if c3 >= o3:
        return None
    body3 = abs(c3 - o3)
    if body3 < body1 * 0.5:
        return None
    mid1 = (o1 + c1) / 2.0
    if c3 > mid1:
        return None

    return "BEARISH"


def detect_tweezers(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Tweezers : deux bougies consécutives avec mèches presque identiques.
    Tweezer Bottom (BULLISH) : deux lows presque égaux après une baisse.
    Tweezer Top (BEARISH) : deux highs presque égaux après une hausse.
    """
    if idx < 1:
        return None
    h1, l1 = float(high.iloc[idx - 1]), float(low.iloc[idx - 1])
    h2, l2 = float(high.iloc[idx]), float(low.iloc[idx])
    o1, c1 = float(open_.iloc[idx - 1]), float(close.iloc[idx - 1])
    o2, c2 = float(open_.iloc[idx]), float(close.iloc[idx])

    tolerance = 0.001  # 0.1% tolerance

    # Tweezer bottom: both lows nearly equal, prior bearish, current bullish
    if c1 < o1 and c2 > o2:
        if l1 > 0 and abs(l2 - l1) / l1 <= tolerance:
            return "BULLISH"

    # Tweezer top: both highs nearly equal, prior bullish, current bearish
    if c1 > o1 and c2 < o2:
        if h1 > 0 and abs(h2 - h1) / h1 <= tolerance:
            return "BEARISH"

    return None


def detect_three_white_soldiers(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Three White Soldiers : 3 bougies haussières consécutives,
    chacune clôturant plus haut que la précédente, avec petits upper shadows.
    """
    if idx < 2:
        return None
    for i in range(idx - 2, idx + 1):
        o, c = float(open_.iloc[i]), float(close.iloc[i])
        if c <= o:
            return None
        h = float(high.iloc[i])
        upper_wick = h - max(o, c)
        body = abs(c - o)
        if body > 0 and upper_wick > body * 0.5:
            return None

    # Each candle closes higher than previous
    c0, c1, c2 = float(close.iloc[idx - 2]), float(close.iloc[idx - 1]), float(close.iloc[idx])
    if c2 > c1 > c0:
        return "BULLISH"
    return None


def detect_three_black_crows(open_: pd.Series, high: pd.Series, low: pd.Series, close: pd.Series, idx: int) -> str | None:
    """
    Three Black Crows : 3 bougies baissières consécutives,
    chacune clôturant plus bas que la précédente, avec petits lower shadows.
    """
    if idx < 2:
        return None
    for i in range(idx - 2, idx + 1):
        o, c = float(open_.iloc[i]), float(close.iloc[i])
        if c >= o:
            return None
        l = float(low.iloc[i])
        lower_wick = min(o, c) - l
        body = abs(c - o)
        if body > 0 and lower_wick > body * 0.5:
            return None

    # Each candle closes lower than previous
    c0, c1, c2 = float(close.iloc[idx - 2]), float(close.iloc[idx - 1]), float(close.iloc[idx])
    if c2 < c1 < c0:
        return "BEARISH"
    return None


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
        "pin_bar":            None,
        "engulfing":          None,
        "doji":               False,
        "inside_bar":         False,
        "morning_star":       None,
        "evening_star":       None,
        "tweezers":           None,
        "three_white_soldiers": None,
        "three_black_crows":  None,
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
        if not found["morning_star"]:
            found["morning_star"] = detect_morning_star(open_, high, low, close, i)
        if not found["evening_star"]:
            found["evening_star"] = detect_evening_star(open_, high, low, close, i)
        if not found["tweezers"]:
            found["tweezers"] = detect_tweezers(open_, high, low, close, i)
        if not found["three_white_soldiers"]:
            found["three_white_soldiers"] = detect_three_white_soldiers(open_, high, low, close, i)
        if not found["three_black_crows"]:
            found["three_black_crows"] = detect_three_black_crows(open_, high, low, close, i)

    return found


def patterns_bonus(patterns: dict, signal_direction: str) -> tuple[int, list[str]]:
    """
    Bonus score basé sur les patterns détectés.
    Max : +25 pts
    """
    bonus   = 0
    reasons = []

    pin = patterns.get("pin_bar")
    if directions_aligned(pin, signal_direction):
        bonus += 15
        reasons.append(f"Pattern: Pin Bar {pin}")
    elif directions_opposed(pin, signal_direction):
        bonus -= 8
        reasons.append(f"Pattern: Pin Bar contre-tendance ({pin})")

    eng = patterns.get("engulfing")
    if directions_aligned(eng, signal_direction):
        bonus += 15
        reasons.append(f"Pattern: Engulfing {eng}")
    elif directions_opposed(eng, signal_direction):
        bonus -= 8
        reasons.append(f"Pattern: Engulfing contre-tendance ({eng})")

    if patterns.get("doji"):
        bonus += 3
        reasons.append("Pattern: Doji (indécision)")

    if patterns.get("inside_bar"):
        bonus += 5
        reasons.append("Pattern: Inside Bar (compression)")

    # 3-candle reversal patterns
    ms = patterns.get("morning_star")
    if directions_aligned(ms, signal_direction):
        bonus += 20
        reasons.append(f"Pattern: Morning Star {ms}")
    elif directions_opposed(ms, signal_direction):
        bonus -= 10
        reasons.append(f"Pattern: Morning Star contre-tendance ({ms})")

    es = patterns.get("evening_star")
    if directions_aligned(es, signal_direction):
        bonus += 20
        reasons.append(f"Pattern: Evening Star {es}")
    elif directions_opposed(es, signal_direction):
        bonus -= 10
        reasons.append(f"Pattern: Evening Star contre-tendance ({es})")

    tw = patterns.get("tweezers")
    if directions_aligned(tw, signal_direction):
        bonus += 12
        reasons.append(f"Pattern: Tweezers {tw}")

    tws = patterns.get("three_white_soldiers")
    if directions_aligned(tws, signal_direction):
        bonus += 18
        reasons.append(f"Pattern: Three White Soldiers {tws}")

    tbc = patterns.get("three_black_crows")
    if directions_aligned(tbc, signal_direction):
        bonus += 18
        reasons.append(f"Pattern: Three Black Crows {tbc}")

    return min(bonus, 25), reasons
