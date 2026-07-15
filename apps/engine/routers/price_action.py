"""
Price Action Phase 1 — Swing Points + Structure de marché (BOS / CHoCH)
La PA ne génère pas de signal seul : elle booste le score via price_action_bonus()
"""
import pandas as pd


# ─── Swing Points ─────────────────────────────────────────────────────────────

def find_swing_highs(high: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Retourne True aux indices qui sont des swing highs."""
    n = len(high)
    result = pd.Series(False, index=high.index)
    for i in range(left, n - right):
        window = high.iloc[i - left: i + right + 1]
        if high.iloc[i] == window.max():
            result.iloc[i] = True
    return result


def find_swing_lows(low: pd.Series, left: int = 3, right: int = 3) -> pd.Series:
    """Retourne True aux indices qui sont des swing lows."""
    n = len(low)
    result = pd.Series(False, index=low.index)
    for i in range(left, n - right):
        window = low.iloc[i - left: i + right + 1]
        if low.iloc[i] == window.min():
            result.iloc[i] = True
    return result


def get_last_swings(high: pd.Series, low: pd.Series, n_swings: int = 5):
    """Retourne les n derniers swing highs et swing lows."""
    sh = find_swing_highs(high)
    sl = find_swing_lows(low)

    swing_highs = [(i, float(high.iloc[i])) for i in range(len(high)) if sh.iloc[i]][-n_swings:]
    swing_lows  = [(i, float(low.iloc[i]))  for i in range(len(low))  if sl.iloc[i]][-n_swings:]

    return swing_highs, swing_lows


# ─── Structure de marché ───────────────────────────────────────────────────────

def detect_market_structure(high: pd.Series, low: pd.Series, close: pd.Series):
    """
    Détecte :
    - HH / HL  → uptrend
    - LH / LL  → downtrend
    - BOS (Break of Structure)
    - CHoCH (Change of Character)
    """
    swing_highs, swing_lows = get_last_swings(high, low, n_swings=6)

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
        "choch":     choch,
        "last_swing_high": last_sh,
        "last_swing_low":  last_sl,
        "swing_highs": [{"idx": i, "price": v} for i, v in swing_highs[-3:]],
        "swing_lows":  [{"idx": i, "price": v} for i, v in swing_lows[-3:]],
    }


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
