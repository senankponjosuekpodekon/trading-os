"""
Harmonic pattern detection — simplified XABCD scanner.
Supports ABCD, Gartley, Bat, Butterfly, Crab (Shark & 5-0 placeholders).
"""
from __future__ import annotations

import pandas as pd

from indicators.swing import find_pivot_highs, find_pivot_lows
from patterns.pattern import MarketPattern
from utils.logger import get_logger

logger = get_logger(__name__)


FIB = {
    "0.382": 0.382,
    "0.5": 0.5,
    "0.618": 0.618,
    "0.786": 0.786,
    "0.886": 0.886,
    "1.272": 1.272,
    "1.618": 1.618,
    "2.24": 2.24,
    "2.618": 2.618,
    "3.618": 3.618,
}


def _atr(close: pd.Series, length: int = 14) -> pd.Series:
    prev = close.shift(1)
    tr = pd.concat([close - prev, (close - prev).abs()], axis=1).max(axis=1)
    return tr.rolling(length, min_periods=1).mean()


def _alternating_pivots(df: pd.DataFrame, left: int = 3, right: int = 3, min_atr_multiple: float = 0.5) -> list[dict]:
    """Returns significant alternating pivot points sorted by index with type 'high'/'low'."""
    high = df["high"]
    low = df["low"]
    close = df["close"]
    h_mask = find_pivot_highs(high, left=left, right=right)
    l_mask = find_pivot_lows(low, left=left, right=right)

    pts: list[dict] = []
    for idx in h_mask.index:
        if h_mask.loc[idx]:
            pts.append({"idx": int(idx), "price": float(high.loc[idx]), "type": "high"})
    for idx in l_mask.index:
        if l_mask.loc[idx]:
            pts.append({"idx": int(idx), "price": float(low.loc[idx]), "type": "low"})
    pts.sort(key=lambda p: p["idx"])

    # Remove consecutive same-type, keep the more extreme one
    filtered: list[dict] = []
    for p in pts:
        if not filtered or filtered[-1]["type"] != p["type"]:
            filtered.append(p)
        else:
            if p["type"] == "high" and p["price"] > filtered[-1]["price"]:
                filtered[-1] = p
            elif p["type"] == "low" and p["price"] < filtered[-1]["price"]:
                filtered[-1] = p

    # Filter insignificant pivots (noise) by ATR amplitude vs previous opposite pivot
    atr_s = _atr(close)
    significant: list[dict] = []
    last_opp: dict | None = None
    for p in filtered:
        if last_opp is None:
            significant.append(p)
            last_opp = p
            continue
        idx = p["idx"]
        current_atr = max(float(atr_s.iloc[idx]) if not pd.isna(atr_s.iloc[idx]) else 0.0,
                          float(close.rolling(14, min_periods=3).std().iloc[idx]) * 0.5
                          if not pd.isna(close.rolling(14, min_periods=3).std().iloc[idx]) else 0.0)
        amplitude = abs(p["price"] - last_opp["price"])
        if amplitude >= min_atr_multiple * current_atr:
            significant.append(p)
            last_opp = p
    return significant


def _ratio_error(actual: float, target: float) -> float:
    if target == 0 or actual == 0:
        return 1.0
    return abs(actual - target) / target


def _score(errors: list[float], tolerance: float) -> float:
    """Convert average ratio errors to a 0-1 confidence."""
    if not errors or tolerance <= 0:
        return 0.0
    avg = sum(errors) / len(errors)
    return round(max(0.0, min(1.0, 1.0 - avg / tolerance)), 4)


def _check_abcd(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    ab = abs(b["price"] - a["price"])
    bc = abs(c["price"] - b["price"])
    cd = abs(d["price"] - c["price"])
    if ab == 0:
        return None

    bc_ab = bc / ab
    cd_ab = cd / ab

    bc_ok = any(_ratio_error(bc_ab, t) <= tolerance for t in (FIB["0.618"], FIB["0.786"]))
    cd_ok = any(_ratio_error(cd_ab, t) <= tolerance for t in (FIB["1.272"], FIB["1.618"]))

    if not (bc_ok and cd_ok):
        return None

    direction = "BUY" if d["type"] == "low" else "SELL"
    errors = [
        min(_ratio_error(cd_ab, t) for t in (FIB["1.272"], FIB["1.618"])),
        min(_ratio_error(bc_ab, t) for t in (FIB["0.618"], FIB["0.786"])),
    ]
    conf = _score(errors, tolerance)
    return {
        "name": "abcd",
        "direction": direction,
        "confidence": conf,
        "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
        "prz": {"min": round(min(c["price"], d["price"]), 6),
                "max": round(max(c["price"], d["price"]), 6)},
        "entry": round(d["price"], 6),
        "stop_loss": round(b["price"], 6),
        "targets": [round(d["price"] + cd * 0.382, 6), round(d["price"] + cd * 0.618, 6)]
                   if direction == "BUY" else
                   [round(d["price"] - cd * 0.382, 6), round(d["price"] - cd * 0.618, 6)],
        "reason": f"ABCD: CD/AB={round(cd_ab,3)}, BC/AB={round(bc_ab,3)}",
    }


def _check_gartley(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    xa = abs(a["price"] - x["price"])
    ab = abs(b["price"] - a["price"])
    bc = abs(c["price"] - b["price"])
    cd = abs(d["price"] - c["price"])
    ad = abs(d["price"] - x["price"])
    if xa == 0 or ab == 0 or bc == 0:
        return None

    ab_xa = ab / xa
    bc_ab = bc / ab
    cd_bc = cd / bc
    ad_xa = ad / xa

    if _ratio_error(ab_xa, FIB["0.618"]) > tolerance:
        return None
    if not any(_ratio_error(bc_ab, t) <= tolerance for t in (FIB["0.382"], FIB["0.886"])):
        return None
    if not any(_ratio_error(cd_bc, t) <= tolerance for t in (FIB["1.272"], FIB["1.618"])):
        return None
    if _ratio_error(ad_xa, FIB["0.786"]) > tolerance:
        return None

    direction = "BUY" if d["type"] == "low" else "SELL"
    errors = [
        _ratio_error(ab_xa, FIB["0.618"]),
        min(_ratio_error(bc_ab, t) for t in (FIB["0.382"], FIB["0.886"])),
        min(_ratio_error(cd_bc, t) for t in (FIB["1.272"], FIB["1.618"])),
        _ratio_error(ad_xa, FIB["0.786"]),
    ]
    conf = _score(errors, tolerance)
    return {
        "name": "gartley",
        "direction": direction,
        "confidence": conf,
        "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
        "prz": {"min": round(min(c["price"], d["price"]), 6),
                "max": round(max(c["price"], d["price"]), 6)},
        "entry": round(d["price"], 6),
        "stop_loss": round(x["price"], 6),
        "targets": [round(d["price"] + cd * 0.382, 6), round(d["price"] + cd * 0.618, 6)]
                   if direction == "BUY" else
                   [round(d["price"] - cd * 0.382, 6), round(d["price"] - cd * 0.618, 6)],
        "reason": f"Gartley: AB/XA={round(ab_xa,3)}, AD/XA={round(ad_xa,3)}",
    }


def _check_bat(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    xa = abs(a["price"] - x["price"])
    ab = abs(b["price"] - a["price"])
    bc = abs(c["price"] - b["price"])
    cd = abs(d["price"] - c["price"])
    ad = abs(d["price"] - x["price"])
    if xa == 0 or ab == 0 or bc == 0:
        return None

    ab_xa = ab / xa
    bc_ab = bc / ab
    cd_bc = cd / bc
    ad_xa = ad / xa

    if not any(_ratio_error(ab_xa, t) <= tolerance for t in (FIB["0.382"], FIB["0.5"])):
        return None
    if not any(_ratio_error(bc_ab, t) <= tolerance for t in (FIB["0.382"], FIB["0.886"])):
        return None
    if not any(_ratio_error(cd_bc, t) <= tolerance for t in (FIB["1.618"], FIB["2.618"])):
        return None
    if _ratio_error(ad_xa, FIB["0.886"]) > tolerance:
        return None

    direction = "BUY" if d["type"] == "low" else "SELL"
    errors = [
        min(_ratio_error(ab_xa, t) for t in (FIB["0.382"], FIB["0.5"])),
        min(_ratio_error(bc_ab, t) for t in (FIB["0.382"], FIB["0.886"])),
        min(_ratio_error(cd_bc, t) for t in (FIB["1.618"], FIB["2.618"])),
        _ratio_error(ad_xa, FIB["0.886"]),
    ]
    conf = _score(errors, tolerance)
    return {
        "name": "bat",
        "direction": direction,
        "confidence": conf,
        "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
        "prz": {"min": round(min(c["price"], d["price"]), 6),
                "max": round(max(c["price"], d["price"]), 6)},
        "entry": round(d["price"], 6),
        "stop_loss": round(x["price"], 6),
        "targets": [round(d["price"] + cd * 0.382, 6), round(d["price"] + cd * 0.618, 6)]
                   if direction == "BUY" else
                   [round(d["price"] - cd * 0.382, 6), round(d["price"] - cd * 0.618, 6)],
        "reason": f"Bat: AB/XA={round(ab_xa,3)}, AD/XA={round(ad_xa,3)}",
    }


def _check_butterfly(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    """Bullish / bearish Butterfly (Pesavento) on XABCD pivots."""
    xa = abs(a["price"] - x["price"])
    ab = abs(b["price"] - a["price"])
    bc = abs(c["price"] - b["price"])
    cd = abs(d["price"] - c["price"])
    ad = abs(d["price"] - x["price"])
    if xa == 0 or ab == 0 or bc == 0:
        return None

    ab_xa = ab / xa
    bc_ab = bc / ab
    cd_bc = cd / bc
    ad_xa = ad / xa

    if _ratio_error(ab_xa, FIB["0.786"]) > tolerance:
        return None
    if not any(_ratio_error(bc_ab, t) <= tolerance for t in (FIB["0.382"], FIB["0.886"])):
        return None
    if not any(_ratio_error(cd_bc, t) <= tolerance for t in (FIB["1.618"], FIB["2.24"])):
        return None
    if _ratio_error(ad_xa, FIB["1.272"]) > tolerance:
        return None

    direction = "BUY" if d["type"] == "low" else "SELL"
    errors = [
        _ratio_error(ab_xa, FIB["0.786"]),
        min(_ratio_error(bc_ab, t) for t in (FIB["0.382"], FIB["0.886"])),
        min(_ratio_error(cd_bc, t) for t in (FIB["1.618"], FIB["2.24"])),
        _ratio_error(ad_xa, FIB["1.272"]),
    ]
    conf = _score(errors, tolerance)
    return {
        "name": "butterfly",
        "direction": direction,
        "confidence": conf,
        "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
        "prz": {"min": round(min(c["price"], d["price"]), 6),
                "max": round(max(c["price"], d["price"]), 6)},
        "entry": round(d["price"], 6),
        "stop_loss": round(x["price"], 6),
        "targets": [round(d["price"] + cd * 0.382, 6), round(d["price"] + cd * 0.618, 6)]
                   if direction == "BUY" else
                   [round(d["price"] - cd * 0.382, 6), round(d["price"] - cd * 0.618, 6)],
        "reason": f"Butterfly: AB/XA={round(ab_xa,3)}, AD/XA={round(ad_xa,3)}",
    }


def _check_crab(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    """Bullish / bearish Crab (Pesavento) on XABCD pivots."""
    xa = abs(a["price"] - x["price"])
    ab = abs(b["price"] - a["price"])
    bc = abs(c["price"] - b["price"])
    cd = abs(d["price"] - c["price"])
    ad = abs(d["price"] - x["price"])
    if xa == 0 or ab == 0 or bc == 0:
        return None

    ab_xa = ab / xa
    bc_ab = bc / ab
    cd_bc = cd / bc
    ad_xa = ad / xa

    if not any(_ratio_error(ab_xa, t) <= tolerance for t in (FIB["0.382"], FIB["0.5"], FIB["0.618"])):
        return None
    if not any(_ratio_error(bc_ab, t) <= tolerance for t in (FIB["0.382"], FIB["0.886"])):
        return None
    if not any(_ratio_error(cd_bc, t) <= tolerance for t in (FIB["2.618"], FIB["3.618"])):
        return None
    if _ratio_error(ad_xa, FIB["1.618"]) > tolerance:
        return None

    direction = "BUY" if d["type"] == "low" else "SELL"
    errors = [
        min(_ratio_error(ab_xa, t) for t in (FIB["0.382"], FIB["0.5"], FIB["0.618"])),
        min(_ratio_error(bc_ab, t) for t in (FIB["0.382"], FIB["0.886"])),
        min(_ratio_error(cd_bc, t) for t in (FIB["2.618"], FIB["3.618"])),
        _ratio_error(ad_xa, FIB["1.618"]),
    ]
    conf = _score(errors, tolerance)
    return {
        "name": "crab",
        "direction": direction,
        "confidence": conf,
        "points": {"X": x, "A": a, "B": b, "C": c, "D": d},
        "prz": {"min": round(min(c["price"], d["price"]), 6),
                "max": round(max(c["price"], d["price"]), 6)},
        "entry": round(d["price"], 6),
        "stop_loss": round(x["price"], 6),
        "targets": [round(d["price"] + cd * 0.382, 6), round(d["price"] + cd * 0.618, 6)]
                   if direction == "BUY" else
                   [round(d["price"] - cd * 0.382, 6), round(d["price"] - cd * 0.618, 6)],
        "reason": f"Crab: AB/XA={round(ab_xa,3)}, AD/XA={round(ad_xa,3)}",
    }


def _check_shark(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    """Shark pattern placeholder — kept for symmetry; full implementation in Phase C."""
    return None


def _check_5_0(x: dict, a: dict, b: dict, c: dict, d: dict, tolerance: float) -> dict | None:
    """5-0 pattern placeholder — kept for symmetry; full implementation in Phase C."""
    return None


def detect_harmonic(df: pd.DataFrame, tolerance: float = 0.02) -> list[MarketPattern]:
    """
    Scanne les 5 derniers pivots alternés et retourne tous les patterns harmoniques détectés,
    du plus récent au plus ancien.
    """
    if len(df) < 15:
        return []

    pts = _alternating_pivots(df)
    if len(pts) < 5:
        return []

    found: list[MarketPattern] = []
    # Iterate over the most recent 5-point windows
    for i in range(len(pts) - 4):
        x, a, b, c, d = pts[i:i + 5]
        # Validate direction consistency: X and A should be opposite types
        if x["type"] == a["type"] or b["type"] == a["type"] or c["type"] == b["type"] or d["type"] == c["type"]:
            continue
        for check in (_check_abcd, _check_gartley, _check_bat,
                      _check_butterfly, _check_crab, _check_shark, _check_5_0):
            try:
                res = check(x, a, b, c, d, tolerance)
            except Exception as exc:
                logger.warning("harmonic_check_failed", pattern=check.__name__, error=str(exc))
                continue
            if res:
                found.append(
                    MarketPattern(
                        name=res["name"],
                        category="reversal",
                        direction=res["direction"],
                        confidence=res["confidence"],
                        points=res["points"],
                        prz=res["prz"],
                        entry=res["entry"],
                        stop_loss=res["stop_loss"],
                        targets=res["targets"],
                        reason=res["reason"],
                    )
                )
    # Return the most recent pattern for each name (latest D)
    by_name: dict[str, MarketPattern] = {}
    for p in found:
        d_idx = int(p.points.get("D", {}).get("idx", 0))
        if p.name not in by_name or d_idx > int(by_name[p.name].points.get("D", {}).get("idx", 0)):
            by_name[p.name] = p
    return list(by_name.values())
