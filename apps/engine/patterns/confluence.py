"""
Confluence scorer — combines a detected pattern with SMC, price action and HTF context.

Uses a weighted multi-criteria scoring model (0.0-1.0):
  - Pattern base confidence (anchor, weight 0.30)
  - HTF/MTF alignment (weight 0.15)
  - Price action structure (weight 0.15)
  - Order Block / FVG overlap (weight 0.15)
  - Liquidity sweep (weight 0.10)
  - Regime compatibility (weight 0.10)
  - S/R zone proximity (weight 0.05)
"""
from __future__ import annotations

from typing import Any

from utils.direction import normalize_direction


# ── Weight configuration ─────────────────────────────────────
WEIGHTS = {
    "base":       0.30,
    "htf":        0.15,
    "pa":         0.15,
    "ob_fvg":     0.15,
    "liquidity":  0.10,
    "regime":     0.10,
    "sr":         0.05,
}


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


def _score_htf(mtf_context: dict, direction: str) -> tuple[float, list[str]]:
    """Score HTF/MTF alignment (0-1)."""
    mtf = mtf_context or {}
    tags: list[str] = []
    htf_aligned = mtf.get("htf_aligned")
    mtf_aligned = mtf.get("mtf_aligned")

    if htf_aligned is True:
        tags.append("HTF aligned")
        return 1.0, tags
    elif mtf_aligned is True:
        tags.append("MTF aligned")
        return 0.7, tags
    elif htf_aligned is False:
        tags.append("HTF counter-trend")
        return 0.0, tags
    return 0.5, tags


def _score_pa(pa: dict, direction: str) -> tuple[float, list[str]]:
    """Score price action structure (0-1)."""
    tags: list[str] = []
    score = 0.0

    pa_trend = normalize_direction(pa.get("trend"))
    if pa_trend == direction and pa_trend != "NEUTRAL":
        score += 0.5
        tags.append("PA trend aligned")

    bos_dir = normalize_direction(pa.get("bos_dir"))
    if pa.get("bos") and bos_dir == direction and bos_dir != "NEUTRAL":
        score += 0.3
        tags.append("BOS aligned")

    if pa.get("choch"):
        score += 0.2
        tags.append("CHoCH present")

    return min(1.0, score), tags


def _score_ob_fvg(smc: dict, direction: str, zone: dict | None) -> tuple[float, list[str]]:
    """Score Order Block + FVG overlap with PRZ (0-1)."""
    tags: list[str] = []
    score = 0.0

    ob = smc.get("ob") or {}
    if direction == "BUY" and ob.get("near_bullish_ob"):
        ob_zone = ob["near_bullish_ob"]
        overlap = _zone_overlap(zone or {}, {"min": ob_zone.get("bottom"), "max": ob_zone.get("top")})
        if overlap > 0.2:
            score += 0.6
            tags.append("Bullish OB in PRZ")
    elif direction == "SELL" and ob.get("near_bearish_ob"):
        ob_zone = ob["near_bearish_ob"]
        overlap = _zone_overlap(zone or {}, {"min": ob_zone.get("bottom"), "max": ob_zone.get("top")})
        if overlap > 0.2:
            score += 0.6
            tags.append("Bearish OB in PRZ")

    fvg = smc.get("fvg") or {}
    if direction == "BUY" and fvg.get("near_bullish_fvg"):
        f = fvg["near_bullish_fvg"]
        overlap = _zone_overlap(zone or {}, {"min": f.get("bottom"), "max": f.get("top")})
        if overlap > 0.2:
            score += 0.4
            tags.append("Bullish FVG in PRZ")
    elif direction == "SELL" and fvg.get("near_bearish_fvg"):
        f = fvg["near_bearish_fvg"]
        overlap = _zone_overlap(zone or {}, {"min": f.get("bottom"), "max": f.get("top")})
        if overlap > 0.2:
            score += 0.4
            tags.append("Bearish FVG in PRZ")

    return min(1.0, score), tags


def _score_liquidity(smc: dict, direction: str, d_point: float | None) -> tuple[float, list[str]]:
    """Score liquidity sweep near pattern completion (0-1)."""
    tags: list[str] = []
    liq = smc.get("liquidity") or {}

    if direction == "BUY" and liq.get("near_eql") and d_point:
        eql_price = float(liq["near_eql"]["price"])
        if abs(float(d_point) - eql_price) / max(eql_price, 1e-9) <= 0.008:
            tags.append("Equal lows liquidity sweep")
            return 1.0, tags
    elif direction == "SELL" and liq.get("near_eqh") and d_point:
        eqh_price = float(liq["near_eqh"]["price"])
        if abs(float(d_point) - eqh_price) / max(eqh_price, 1e-9) <= 0.008:
            tags.append("Equal highs liquidity sweep")
            return 1.0, tags

    return 0.0, tags


def _score_regime(regime: dict, direction: str) -> tuple[float, list[str]]:
    """Score regime compatibility (0-1)."""
    tags: list[str] = []
    regime_regime = (regime or {}).get("regime", "UNKNOWN")

    if direction == "BUY" and regime_regime == "TRENDING_BULL":
        tags.append("TRENDING_BULL regime")
        return 1.0, tags
    elif direction == "SELL" and regime_regime == "TRENDING_BEAR":
        tags.append("TRENDING_BEAR regime")
        return 1.0, tags
    elif regime_regime == "VOLATILE":
        tags.append("VOLATILE regime")
        return 0.2, tags
    elif regime_regime in ("RANGING", "CHOPPY"):
        tags.append(f"{regime_regime} regime")
        return 0.4, tags
    return 0.5, tags


def _score_sr(sr: dict | None, direction: str, entry: float | None) -> tuple[float, list[str]]:
    """Score S/R zone proximity (0-1)."""
    tags: list[str] = []
    sr = sr or {}
    if entry is None:
        return 0.5, tags

    if direction == "BUY" and sr.get("near_support"):
        tags.append("Near support")
        return 1.0, tags
    elif direction == "SELL" and sr.get("near_resistance"):
        tags.append("Near resistance")
        return 1.0, tags
    return 0.5, tags


def score_pattern_confluence(
    pattern: dict[str, Any],
    pa: dict[str, Any],
    smc: dict[str, Any],
    mtf_context: dict[str, Any] | None = None,
    regime: dict[str, Any] | None = None,
    sr: dict[str, Any] | None = None,
) -> tuple[float, list[str]]:
    """
    Returns a weighted confluence score (0.0-1.0) and a list of tags.

    Scoring model:
      base (0.30) + htf (0.15) + pa (0.15) + ob_fvg (0.15) +
      liquidity (0.10) + regime (0.10) + sr (0.05)

    Each sub-score is 0-1, multiplied by its weight, then summed.
    """
    direction = (pattern.get("direction") or "NEUTRAL").upper()
    if direction == "NEUTRAL":
        return round(pattern.get("confidence", 0.0), 4), []

    base_confidence = float(pattern.get("confidence") or 0.0)
    prz = pattern.get("prz")
    entry = pattern.get("entry")
    d_point = (pattern.get("points") or {}).get("D", {}).get("price", entry)
    zone = prz if prz else (_price_zone_from_level(entry) if entry else None)

    # Compute sub-scores
    htf_score, htf_tags = _score_htf(mtf_context or {}, direction)
    pa_score, pa_tags = _score_pa(pa, direction)
    ob_fvg_score, ob_fvg_tags = _score_ob_fvg(smc, direction, zone)
    liq_score, liq_tags = _score_liquidity(smc, direction, d_point)
    reg_score, reg_tags = _score_regime(regime or {}, direction)
    sr_score, sr_tags = _score_sr(sr, direction, entry)

    # Weighted sum
    final = (
        base_confidence * WEIGHTS["base"] +
        htf_score * WEIGHTS["htf"] +
        pa_score * WEIGHTS["pa"] +
        ob_fvg_score * WEIGHTS["ob_fvg"] +
        liq_score * WEIGHTS["liquidity"] +
        reg_score * WEIGHTS["regime"] +
        sr_score * WEIGHTS["sr"]
    )

    tags = htf_tags + pa_tags + ob_fvg_tags + liq_tags + reg_tags + sr_tags
    final = round(max(0.0, min(1.0, final)), 4)
    return final, tags
