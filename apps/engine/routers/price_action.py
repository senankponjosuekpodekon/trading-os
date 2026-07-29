"""
Price Action Phase 1 — Swing Points + Structure de marché (BOS / CHoCH)
La PA ne génère pas de signal seul : elle booste le score via price_action_bonus()
"""
import numpy as np
import pandas as pd

from indicators.swing import find_pivot_highs, find_pivot_lows, get_last_swing_points


# ─── Swing Points ─────────────────────────────────────────────────────────────

def find_swing_highs(high: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Retourne True aux indices qui sont des swing highs."""
    return find_pivot_highs(high, left=left, right=right)


def find_swing_lows(low: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Retourne True aux indices qui sont des swing lows."""
    return find_pivot_lows(low, left=left, right=right)


def get_last_swings(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    n_swings: int = 5,
    volume: pd.Series | None = None,
):
    """Retourne les n derniers swing highs et swing lows + scores."""
    high_points, low_points = get_last_swing_points(
        high, low, close, volume=volume, method="pivot", n_swings=n_swings
    )
    swing_highs = [(p["idx"], p["price"]) for p in high_points]
    swing_lows = [(p["idx"], p["price"]) for p in low_points]
    return swing_highs, swing_lows, high_points, low_points


# ─── Structure de marché ───────────────────────────────────────────────────────

def detect_market_structure(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series | None = None,
) -> dict:
    """
    Détecte :
    - HH / HL  → uptrend
    - LH / LL  → downtrend
    - BOS (Break of Structure)
    - CHoCH (Change of Character)
    """
    swing_highs, swing_lows, high_points, low_points = get_last_swings(
        high, low, close, n_swings=6, volume=volume
    )

    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return {"trend": "NEUTRAL", "bos": False, "choch": False, "structure": "insufficient data"}

    # Comparer les 2 derniers swing highs et lows
    sh_vals = [v for _, v in swing_highs[-3:]]
    sl_vals = [v for _, v in swing_lows[-3:]]

    hh = all(sh_vals[i] < sh_vals[i+1] for i in range(len(sh_vals)-1))  # Higher Highs
    hl = all(sl_vals[i] < sl_vals[i+1] for i in range(len(sl_vals)-1))  # Higher Lows
    lh = all(sh_vals[i] > sh_vals[i+1] for i in range(len(sh_vals)-1))  # Lower Highs
    ll = all(sl_vals[i] > sl_vals[i+1] for i in range(len(sl_vals)-1))  # Lower Lows

    if hh and hl:
        trend = "BULLISH"
        structure = "HH + HL (uptrend)"
    elif lh and ll:
        trend = "BEARISH"
        structure = "LH + LL (downtrend)"
    elif hh and ll:
        trend = "NEUTRAL"
        structure = "HH + LL (consolidation)"
    elif lh and hl:
        trend = "NEUTRAL"
        structure = "LH + HL (consolidation)"
    else:
        trend = "NEUTRAL"
        structure = "Mixed structure"

    last_close = float(close.iloc[-1])
    last_sh    = swing_highs[-1][1] if swing_highs else None
    last_sl    = swing_lows[-1][1]  if swing_lows  else None

    # BOS : cassure du dernier swing high/low
    bos = False
    bos_dir = None
    if last_sh and last_close > last_sh:
        bos = True
        bos_dir = "BULLISH"
    elif last_sl and last_close < last_sl:
        bos = True
        bos_dir = "BEARISH"

    # CHoCH : changement de structure (ancien trend inversé)
    choch = False
    if trend == "BEARISH" and last_close > (last_sh or 0):
        choch = True
    elif trend == "BULLISH" and last_sl and last_close < last_sl:
        choch = True

    return {
        "trend":     trend,
        "structure": structure,
        "bos":       bos,
        "bos_dir":   bos_dir,
        "bos_score": round(bos_quality_score(
            bos, bos_dir, swing_highs, swing_lows, close, volume
        ), 1),
        "choch":     choch,
        "last_swing_high": last_sh,
        "last_swing_low":  last_sl,
        "swing_highs": [{"idx": i, "price": v, "score": hp.get("score")} for (i, v), hp in zip(swing_highs[-3:], high_points[-3:])],
        "swing_lows":  [{"idx": i, "price": v, "score": lp.get("score")} for (i, v), lp in zip(swing_lows[-3:], low_points[-3:])],
    }


def bos_quality_score(
    bos: bool,
    bos_dir: str | None,
    swing_highs: list[tuple],
    swing_lows: list[tuple],
    close: pd.Series,
    volume: pd.Series | None = None,
) -> float:
    """
    Score 0-100 de la qualité du BOS.
    Prend en compte :
    - distance de cassure par rapport au swing précédent
    - volume sur la bougie de cassure
    - score du swing cassé
    """
    if not bos or not swing_highs or not swing_lows or len(close) < 2:
        return 0.0

    last_idx = len(close) - 1
    last_close = float(close.iloc[-1])
    # compute true range manually for this small series
    prev_close = close.shift(1)
    high = pd.Series(close).combine(prev_close, max)
    low = pd.Series(close).combine(prev_close, min)
    tr = high - low
    atr = float(tr.rolling(14).mean().iloc[-1]) if len(close) >= 14 else float(tr.mean())
    if not atr or atr == 0:
        return 50.0

    if bos_dir == "BULLISH" and len(swing_highs) >= 2:
        prev_swing_price = swing_highs[-2][1]
        break_distance = last_close - prev_swing_price
    elif bos_dir == "BEARISH" and len(swing_lows) >= 2:
        prev_swing_price = swing_lows[-2][1]
        break_distance = prev_swing_price - last_close
    else:
        return 0.0

    distance_score = min(40, max(0, (break_distance / atr) * 10))

    vol = volume if volume is not None else pd.Series(np.ones(len(close)), index=close.index)
    cur_vol = float(vol.iloc[last_idx])
    avg_vol = float(vol.iloc[max(0, last_idx - 14):last_idx + 1].mean())
    volume_score = min(30, max(0, ((cur_vol / avg_vol - 1) * 30))) if avg_vol and avg_vol > 0 else 0.0

    # momentum alignment : close is extending in direction
    extension_score = 20.0 if break_distance > 0 else 0.0
    return min(100.0, distance_score + volume_score + extension_score + 10.0)


# ─── Bonus score Price Action ─────────────────────────────────────────────────

def price_action_bonus(pa: dict, signal_direction: str) -> tuple[int, list[str]]:
    """
    Retourne (bonus_score, reasons[]).
    signal_direction : 'BUY' | 'SELL'
    Max bonus : +35 points
    """
    bonus = 0
    reasons = []

    trend = pa.get("trend", "NEUTRAL")

    # Alignement trend + signal
    if signal_direction == "BUY" and trend == "BULLISH":
        bonus += 15
        reasons.append(f"PA: trend bullish ({pa.get('structure','')})")
    elif signal_direction == "SELL" and trend == "BEARISH":
        bonus += 15
        reasons.append(f"PA: trend bearish ({pa.get('structure','')})")
    elif trend == "NEUTRAL":
        pass
    else:
        bonus -= 10
        reasons.append(f"PA: contre-tendance ({trend})")

    # BOS dans le sens du signal
    if pa.get("bos") and pa.get("bos_dir") == signal_direction:
        bonus += 12
        reasons.append(f"PA: BOS {pa['bos_dir']}")

    # CHoCH = renforcement si dans le sens du signal
    if pa.get("choch"):
        if signal_direction == "BUY" and trend != "BULLISH":
            bonus += 8
            reasons.append("PA: CHoCH bullish potentiel")
        elif signal_direction == "SELL" and trend != "BEARISH":
            bonus += 8
            reasons.append("PA: CHoCH bearish potentiel")

    return bonus, reasons
