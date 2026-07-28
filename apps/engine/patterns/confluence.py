"""
Confluence scorer — combines a detected pattern with SMC, price action and HTF context.
"""
from __future__ import annotations

from typing import Any


def _zone_overlap(a: dict[str, float], b: dict[str, float]) -> float:
    """Overlap ratio of two price zones {min, max}."""
    if not a or not b:
        return 0.0
    a_min, a_max = a.get("min", 0.0), a.get("max", 0.0)
    b_min, b_max = b.get("min", 0.0), b.get("max", 0.0)
    if a_max <= a_min or b_max <= b_min:
        return 0.0
    overlap = min(a_max, b_max) - max(a_min, b_min)
    if overlap <= 0:
        return 0.0
    span = min(a_max - a_min, b_max - b_min)
    return max(0.0, min(1.0, overlap / span)) if span > 0 else 0.0


def _level_in_zone(level: float, zone: dict[str, float] | None, tolerance: float = 0.005) -> bool:
    if zone is None:
        return False
    z_min, z_max = zone.get("min"), zone.get("max")
    if z_min is None or z_max is None:
        return False
    mid = (z_min + z_max) / 2.0
    return abs(level - mid) / max(mid, 1e-9) <= tolerance


def _price_zone_from_level(level: float, pct: float = 0.005) -> dict[str, float]:
    return {"min": level * (1 - pct), "max": level * (1 + pct)}


def score_pattern_confluence(
    pattern: dict[str, Any],
    pa: dict[str, Any],
    smc: dict[str, Any],
    mtf_context: dict[str, Any] | None = None,
    regime: dict[str, Any] | None = None,
) -> tuple[float, list[str]]:
    """
    Returns a confluence score (0.0-1.0) and a list of tags for a detected pattern.
    The score is anchored to the pattern's own confidence and boosted by supporting context.
    """
    direction = (pattern.get("direction") or "NEUTRAL").upper()
    if direction == "NEUTRAL":
        return round(pattern.get("confidence", 0.0), 4), []

    base_confidence = float(pattern.get("confidence") or 0.0)
    prz = pattern.get("prz")
    entry = pattern.get("entry")
    d_point = (pattern.get("points") or {}).get("D", {}).get("price", entry)
    zone = prz if prz else (_price_zone_from_level(entry) if entry else None)

    score = base_confidence
    tags: list[str] = []

    # 1. HTF alignment
    mtf = mtf_context or {}
    htf_aligned = mtf.get("htf_aligned")
    mtf_aligned = mtf.get("mtf_aligned")
    if htf_aligned is True:
        score += 0.12
        tags.append("HTF aligned")
    elif mtf_aligned is True:
        score += 0.08
        tags.append("MTF aligned")
    elif htf_aligned is False:
        score -= 0.10
        tags.append("HTF counter-trend")

    # 2. Price action trend / BOS / CHoCH
    pa_trend = (pa.get("trend") or "NEUTRAL").upper()
    if pa_trend == direction:
        score += 0.10
        tags.append("PA trend aligned")
    bos_dir = (pa.get("bos_dir") or "").upper()
    if pa.get("bos") and bos_dir == direction:
        score += 0.08
        tags.append("BOS aligned")
    if pa.get("choch"):
        score += 0.04
        tags.append("CHoCH present")

    # 3. Order Block overlap with PRZ
    ob = smc.get("ob") or {}
    if direction == "BUY" and ob.get("near_bullish_ob"):
        ob_zone = ob["near_bullish_ob"]
        if zone and _zone_overlap(zone, {"min": ob_zone.get("bottom"), "max": ob_zone.get("top")}) > 0.2:
            score += 0.15
            tags.append("Bullish OB in PRZ")
    elif direction == "SELL" and ob.get("near_bearish_ob"):
        ob_zone = ob["near_bearish_ob"]
        if zone and _zone_overlap(zone, {"min": ob_zone.get("bottom"), "max": ob_zone.get("top")}) > 0.2:
            score += 0.15
            tags.append("Bearish OB in PRZ")

    # 4. FVG overlap with PRZ
    fvg = smc.get("fvg") or {}
    if direction == "BUY" and fvg.get("near_bullish_fvg"):
        f = fvg["near_bullish_fvg"]
        if zone and _zone_overlap(zone, {"min": f.get("bottom"), "max": f.get("top")}) > 0.2:
            score += 0.10
            tags.append("Bullish FVG in PRZ")
    elif direction == "SELL" and fvg.get("near_bearish_fvg"):
        f = fvg["near_bearish_fvg"]
        if zone and _zone_overlap(zone, {"min": f.get("bottom"), "max": f.get("top")}) > 0.2:
            score += 0.10
            tags.append("Bearish FVG in PRZ")

    # 5. Liquidity sweep near pattern completion point (D / entry)
    liq = smc.get("liquidity") or {}
    if direction == "BUY" and liq.get("near_eql") and d_point:
        eql_price = float(liq["near_eql"]["price"])
        if abs(float(d_point) - eql_price) / max(eql_price, 1e-9) <= 0.008:
            score += 0.12
            tags.append("Equal lows liquidity sweep")
    elif direction == "SELL" and liq.get("near_eqh") and d_point:
        eqh_price = float(liq["near_eqh"]["price"])
        if abs(float(d_point) - eqh_price) / max(eqh_price, 1e-9) <= 0.008:
            score += 0.12
            tags.append("Equal highs liquidity sweep")

    # 6. Regime supportive
    regime_regime = (regime or {}).get("regime", "UNKNOWN")
    if direction == "BUY" and regime_regime == "TRENDING_BULL":
        score += 0.08
        tags.append("TRENDING_BULL regime")
    elif direction == "SELL" and regime_regime == "TRENDING_BEAR":
        score += 0.08
        tags.append("TRENDING_BEAR regime")
    elif regime_regime == "VOLATILE":
        score -= 0.10
        tags.append("VOLATILE regime")

    final = round(max(0.0, min(1.0, score)), 4)
    return final, tags
