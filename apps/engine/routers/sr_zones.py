"""
Phase 2 — Support / Résistance : clustering des swing points
"""
import pandas as pd
import numpy as np
from routers.price_action import find_swing_highs, find_swing_lows


def cluster_levels(levels: list[float], tolerance_pct: float = 0.003) -> list[dict]:
    """
    Regroupe les niveaux proches (tolerance_pct = 0.3%) en zones.
    Retourne les zones triées par force (nb de touches).
    """
    if not levels:
        return []

    sorted_levels = sorted(levels)
    clusters: list[list[float]] = []

    for price in sorted_levels:
        placed = False
        for cluster in clusters:
            ref = np.mean(cluster)
            if abs(price - ref) / ref <= tolerance_pct:
                cluster.append(price)
                placed = True
                break
        if not placed:
            clusters.append([price])

    zones = []
    for cluster in clusters:
        mean_price = float(np.mean(cluster))
        zones.append({
            "price":    round(mean_price, 6),
            "strength": len(cluster),
            "min":      round(min(cluster), 6),
            "max":      round(max(cluster), 6),
        })

    return sorted(zones, key=lambda z: z["strength"], reverse=True)


def get_sr_zones(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    left: int = 3,
    right: int = 3,
    tolerance_pct: float = 0.003,
) -> dict:
    """
    Retourne les zones de S&R et si le prix actuel est proche d'une zone.
    """
    sh_mask = find_swing_highs(high, left, right)
    sl_mask = find_swing_lows(low, left, right)

    resistance_levels = [float(high.iloc[i]) for i in range(len(high)) if sh_mask.iloc[i]]
    support_levels    = [float(low.iloc[i])  for i in range(len(low))  if sl_mask.iloc[i]]

    resistances = cluster_levels(resistance_levels, tolerance_pct)
    supports    = cluster_levels(support_levels,    tolerance_pct)

    current = float(close.iloc[-1])
    proximity_pct = 0.005  # 0.5% du prix

    near_support    = next((z for z in supports    if abs(current - z["price"]) / current <= proximity_pct), None)
    near_resistance = next((z for z in resistances if abs(current - z["price"]) / current <= proximity_pct), None)

    return {
        "supports":        supports[:5],
        "resistances":     resistances[:5],
        "near_support":    near_support,
        "near_resistance": near_resistance,
    }


def sr_bonus(sr: dict, signal_direction: str) -> tuple[int, list[str]]:
    """
    Bonus score basé sur la proximité des zones S&R.
    Max : +20 pts
    """
    bonus = 0
    reasons = []

    if signal_direction == "BUY" and sr.get("near_support"):
        z = sr["near_support"]
        pts = min(8 * z["strength"], 20)
        bonus += pts
        reasons.append(f"SR: rebond support ${z['price']:.4f} (force {z['strength']})")

    elif signal_direction == "SELL" and sr.get("near_resistance"):
        z = sr["near_resistance"]
        pts = min(8 * z["strength"], 20)
        bonus += pts
        reasons.append(f"SR: résistance ${z['price']:.4f} (force {z['strength']})")

    elif signal_direction == "BUY" and sr.get("near_resistance"):
        bonus -= 8
        reasons.append("SR: prix proche résistance (contre-signal)")

    elif signal_direction == "SELL" and sr.get("near_support"):
        bonus -= 8
        reasons.append("SR: prix proche support (contre-signal)")

    return bonus, reasons
