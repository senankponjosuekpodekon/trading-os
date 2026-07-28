"""
Phase 3 — Smart Money Concepts (SMC)
- Fair Value Gaps (FVG) : imbalances de prix non comblées
- Order Blocks (OB)     : dernière bougie opposée avant un BOS
- Liquidity Zones       : equal highs/lows (zones de liquidité)
"""
import pandas as pd
import numpy as np


# ─── Fair Value Gaps ──────────────────────────────────────────────────────────

def detect_fvg(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    lookback: int = 50,
) -> dict:
    """
    FVG Bullish : low[i] > high[i-2]  (gap vers le haut sur 3 bougies)
    FVG Bearish : high[i] < low[i-2]  (gap vers le bas sur 3 bougies)
    Retourne les FVG non comblés (price actuel pas encore entré dans le gap).
    """
    n      = len(close)
    start  = max(3, n - lookback)
    current = float(close.iloc[-1])

    bullish_fvg: list[dict] = []
    bearish_fvg: list[dict] = []

    for i in range(start, n - 1):
        h_prev2 = float(high.iloc[i - 2])
        l_curr  = float(low.iloc[i])
        l_prev2 = float(low.iloc[i - 2])
        h_curr  = float(high.iloc[i])

        # Bullish FVG
        if l_curr > h_prev2:
            mid = (l_curr + h_prev2) / 2
            filled = current < l_curr
            bullish_fvg.append({
                "type":    "BULLISH",
                "top":     round(l_curr, 6),
                "bottom":  round(h_prev2, 6),
                "mid":     round(mid, 6),
                "filled":  filled,
                "bar_idx": i,
            })

        # Bearish FVG
        if h_curr < l_prev2:
            mid = (h_curr + l_prev2) / 2
            filled = current > h_curr
            bearish_fvg.append({
                "type":    "BEARISH",
                "top":     round(l_prev2, 6),
                "bottom":  round(h_curr, 6),
                "mid":     round(mid, 6),
                "filled":  filled,
                "bar_idx": i,
            })

    # Garder seulement les FVG non comblés les plus récents
    open_bull = [f for f in bullish_fvg if not f["filled"]][-3:]
    open_bear = [f for f in bearish_fvg if not f["filled"]][-3:]

    # FVG le plus proche du prix actuel
    proximity_pct = 0.01  # 1%
    near_bull = next(
        (f for f in reversed(open_bull) if abs(current - f["mid"]) / current <= proximity_pct), None
    )
    near_bear = next(
        (f for f in reversed(open_bear) if abs(current - f["mid"]) / current <= proximity_pct), None
    )

    return {
        "bullish": open_bull,
        "bearish": open_bear,
        "near_bullish_fvg": near_bull,
        "near_bearish_fvg": near_bear,
        "total_open": len(open_bull) + len(open_bear),
    }


# ─── Order Blocks ─────────────────────────────────────────────────────────────

def detect_order_blocks(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series | None = None,
    lookback: int = 50,
    min_displacement: float = 2.0,
    min_volume_ratio: float = 1.2,
) -> dict:
    """
    Bullish OB : dernière bougie bearish avant un fort mouvement haussier
    Bearish OB : dernière bougie bullish avant un fort mouvement baissier
    Critère : mouvement suivant ≥ 2× ATR
    """
    n     = len(close)
    start = max(4, n - lookback)

    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = float(atr_raw.rolling(14).mean().iloc[-1])
    threshold = atr * 1.5

    current = float(close.iloc[-1])
    current_low = float(low.iloc[-1])
    current_high = float(high.iloc[-1])
    bullish_ob: list[dict] = []
    bearish_ob: list[dict] = []

    vol = volume if volume is not None else pd.Series(np.ones(n), index=close.index)
    avg_volume = float(vol.iloc[max(0, n - 14):].mean()) or 1.0

    for i in range(start, n - 2):
        o, h, l, c = float(open_.iloc[i]), float(high.iloc[i]), float(low.iloc[i]), float(close.iloc[i])
        c_next = float(close.iloc[i + 1])
        move   = abs(c_next - c)

        if move < threshold:
            continue

        displacement_ratio = round(move / atr, 3) if atr else 0.0
        vol_ratio = float(vol.iloc[i]) / avg_volume if avg_volume else 1.0

        # Status : fresh = zone jamais testée, tested_once = prix dedans, mitigated = traversée
        def _status(ob_type: str) -> str:
            if ob_type == "BULLISH":
                if current_low < l:
                    return "mitigated"
                if current_low >= l and current <= h:
                    return "tested_once"
                return "fresh"
            if current_high > h:
                return "mitigated"
            if current_high <= h and current >= l:
                return "tested_once"
            return "fresh"

        is_valid = displacement_ratio >= min_displacement and vol_ratio >= min_volume_ratio

        if c < o and c_next > c:  # Bougie bearish puis move haussier → Bullish OB
            status = _status("BULLISH")
            bullish_ob.append({
                "type":   "BULLISH",
                "top":    round(o, 6),
                "bottom": round(l, 6),
                "mid":    round((o + l) / 2, 6),
                "bar_idx": i,
                "respected": status != "mitigated",
                "status": status,
                "displacement_ratio": displacement_ratio,
                "volume_ratio": round(vol_ratio, 2),
                "valid": is_valid,
            })

        if c > o and c_next < c:  # Bougie bullish puis move baissier → Bearish OB
            status = _status("BEARISH")
            bearish_ob.append({
                "type":   "BEARISH",
                "top":    round(h, 6),
                "bottom": round(c, 6),
                "mid":    round((h + c) / 2, 6),
                "bar_idx": i,
                "respected": status != "mitigated",
                "status": status,
                "displacement_ratio": displacement_ratio,
                "volume_ratio": round(vol_ratio, 2),
                "valid": is_valid,
            })

    # Plus récents en premier, max 3 (exclure mitigated)
    bull_ob = [ob for ob in reversed(bullish_ob) if ob["status"] != "mitigated"][:3]
    bear_ob = [ob for ob in reversed(bearish_ob) if ob["status"] != "mitigated"][:3]

    proximity_pct = 0.008  # 0.8%
    near_bull_ob = next(
        (ob for ob in bull_ob if abs(current - ob["mid"]) / current <= proximity_pct), None
    )
    near_bear_ob = next(
        (ob for ob in bear_ob if abs(current - ob["mid"]) / current <= proximity_pct), None
    )

    return {
        "bullish": bull_ob,
        "bearish": bear_ob,
        "near_bullish_ob": near_bull_ob,
        "near_bearish_ob": near_bear_ob,
    }


# ─── Liquidity Zones ──────────────────────────────────────────────────────────

def detect_liquidity_zones(
    high: pd.Series,
    low: pd.Series,
    lookback: int = 50,
    tolerance_pct: float = 0.002,
) -> dict:
    """
    Equal Highs (EQH) / Equal Lows (EQL) : zones où le prix a testé le même niveau 2+ fois.
    Signe de liquidité accumulée → le prix tendra à y revenir (stop hunt).
    """
    n     = len(high)
    start = max(0, n - lookback)

    highs = [(i, float(high.iloc[i])) for i in range(start, n)]
    lows  = [(i, float(low.iloc[i]))  for i in range(start, n)]

    def find_equals(levels: list[tuple]) -> list[dict]:
        zones = []
        used  = set()
        for i, (idx1, v1) in enumerate(levels):
            if idx1 in used:
                continue
            group = [v1]
            for idx2, v2 in levels[i + 1:]:
                if abs(v2 - v1) / v1 <= tolerance_pct:
                    group.append(v2)
                    used.add(idx2)
            if len(group) >= 2:
                zones.append({
                    "price":   round(float(np.mean(group)), 6),
                    "touches": len(group),
                    "min":     round(min(group), 6),
                    "max":     round(max(group), 6),
                })
                used.add(idx1)
        return sorted(zones, key=lambda z: z["touches"], reverse=True)[:3]

    current       = float(high.iloc[-1])
    equal_highs   = find_equals(highs)
    equal_lows    = find_equals(lows)
    proximity_pct = 0.005

    near_eqh = next((z for z in equal_highs if abs(current - z["price"]) / current <= proximity_pct), None)
    near_eql = next((z for z in equal_lows  if abs(current - z["price"]) / current <= proximity_pct), None)

    return {
        "equal_highs": equal_highs,
        "equal_lows":  equal_lows,
        "near_eqh":    near_eqh,
        "near_eql":    near_eql,
    }


# ─── SMC Bonus ────────────────────────────────────────────────────────────────

def smc_bonus(
    fvg: dict,
    ob: dict,
    liq: dict,
    signal_direction: str,
) -> tuple[int, list[str]]:
    """
    Bonus score SMC. Max : +30 pts
    """
    bonus   = 0
    reasons = []

    # FVG
    if signal_direction == "BUY" and fvg.get("near_bullish_fvg"):
        f = fvg["near_bullish_fvg"]
        bonus += 12
        reasons.append(f"SMC: prix dans FVG haussier ({f['bottom']:.2f}–{f['top']:.2f})")
    elif signal_direction == "SELL" and fvg.get("near_bearish_fvg"):
        f = fvg["near_bearish_fvg"]
        bonus += 12
        reasons.append(f"SMC: prix dans FVG baissier ({f['bottom']:.2f}–{f['top']:.2f})")

    # Order Block
    if signal_direction == "BUY" and ob.get("near_bullish_ob"):
        o = ob["near_bullish_ob"]
        bonus += 15
        reasons.append(f"SMC: Order Block haussier ({o['bottom']:.2f}–{o['top']:.2f})")
    elif signal_direction == "SELL" and ob.get("near_bearish_ob"):
        o = ob["near_bearish_ob"]
        bonus += 15
        reasons.append(f"SMC: Order Block baissier ({o['bottom']:.2f}–{o['top']:.2f})")

    # Liquidité (prix proche d'une zone = risque de stop hunt)
    if signal_direction == "BUY" and liq.get("near_eql"):
        bonus += 5
        reasons.append(f"SMC: Equal Lows liquidité ({liq['near_eql']['price']:.2f}, {liq['near_eql']['touches']} touches)")
    elif signal_direction == "SELL" and liq.get("near_eqh"):
        bonus += 5
        reasons.append(f"SMC: Equal Highs liquidité ({liq['near_eqh']['price']:.2f}, {liq['near_eqh']['touches']} touches)")

    return min(bonus, 30), reasons


# ─── Analyse complète ─────────────────────────────────────────────────────────

def analyze_smc(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series | None = None,
) -> dict:
    fvg = detect_fvg(high, low, close)
    ob  = detect_order_blocks(open_, high, low, close, volume=volume)
    liq = detect_liquidity_zones(high, low)
    return {"fvg": fvg, "ob": ob, "liquidity": liq}
