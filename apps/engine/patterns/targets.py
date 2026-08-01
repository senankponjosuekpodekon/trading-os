"""
Target Projection — Automatic objective calculation for chart patterns.

Implements classical measurement rules:
  - Head & Shoulders: neckline ± head height
  - Flag/Pennant: breakout ± mast height
  - Double Top/Bottom: neckline ± height
  - Multi-target scaling (TP1=55%, TP2=100%, TP3=140%)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class TargetProjection:
    tp1: float
    tp2: float
    tp3: float
    method: str
    full_distance: float


def multi_targets(entry: float, full_target: float, side: str) -> TargetProjection:
    """
    Generate TP1/TP2/TP3 from a full projection distance.

    TP1 = 55% of distance (quick secure)
    TP2 = 100% of distance (classical target)
    TP3 = 140% of distance (extension/runner)
    """
    distance = abs(full_target - entry)
    if side.lower() in ("long", "buy", "bullish"):
        return TargetProjection(
            tp1=round(entry + distance * 0.55, 6),
            tp2=round(entry + distance * 1.00, 6),
            tp3=round(entry + distance * 1.40, 6),
            method="multi_target",
            full_distance=round(distance, 6),
        )
    else:
        return TargetProjection(
            tp1=round(entry - distance * 0.55, 6),
            tp2=round(entry - distance * 1.00, 6),
            tp3=round(entry - distance * 1.40, 6),
            method="multi_target",
            full_distance=round(distance, 6),
        )


def project_hs_target(
    neckline: float,
    head_price: float,
    direction: str,
    entry: Optional[float] = None,
) -> TargetProjection:
    """
    Head & Shoulders target projection.

    Height = |head_price - neckline|
    Target = neckline ∓ height (bearish: neckline - height, bullish: neckline + height)
    """
    height = abs(head_price - neckline)
    if direction.lower() in ("bearish", "sell"):
        full_target = neckline - height
    else:
        full_target = neckline + height

    ref = entry if entry is not None else neckline
    side = "short" if direction.lower() in ("bearish", "sell") else "long"
    proj = multi_targets(ref, full_target, side)
    proj.method = "hs_measurement"
    return proj


def project_flag_target(
    mast_start: float,
    mast_end: float,
    breakout_price: float,
    direction: str,
    entry: Optional[float] = None,
) -> TargetProjection:
    """
    Flag/Pennant target projection (mast measurement).

    Mast height = |mast_end - mast_start|
    Target = breakout ± mast height
    """
    mast_height = abs(mast_end - mast_start)
    if direction.lower() in ("bullish", "buy", "long"):
        full_target = breakout_price + mast_height
    else:
        full_target = breakout_price - mast_height

    ref = entry if entry is not None else breakout_price
    side = "long" if direction.lower() in ("bullish", "buy", "long") else "short"
    proj = multi_targets(ref, full_target, side)
    proj.method = "flag_mast"
    return proj


def project_double_target(
    neckline: float,
    extreme: float,
    direction: str,
    entry: Optional[float] = None,
) -> TargetProjection:
    """
    Double Top/Bottom target projection.

    Height = |extreme - neckline|
    Target = neckline ∓ height
    """
    height = abs(extreme - neckline)
    if direction.lower() in ("bearish", "sell", "double_top"):
        full_target = neckline - height
    else:
        full_target = neckline + height

    ref = entry if entry is not None else neckline
    side = "short" if direction.lower() in ("bearish", "sell", "double_top") else "long"
    proj = multi_targets(ref, full_target, side)
    proj.method = "double_measurement"
    return proj


def project_harmonic_target(
    point_a: float,
    point_d: float,
    direction: str,
    entry: Optional[float] = None,
) -> TargetProjection:
    """
    Harmonic pattern target projection from Point D.

    TP1 = 38.2% of AD
    TP2 = 61.8% of AD
    TP3 = Point A
    """
    ad_distance = abs(point_d - point_a)
    ref = entry if entry is not None else point_d

    if direction.lower() in ("bullish", "buy", "long"):
        # D is a low, expecting reversal up
        tp1 = ref + ad_distance * 0.382
        tp2 = ref + ad_distance * 0.618
        tp3 = point_a if point_a > ref else ref + ad_distance
    else:
        # D is a high, expecting reversal down
        tp1 = ref - ad_distance * 0.382
        tp2 = ref - ad_distance * 0.618
        tp3 = point_a if point_a < ref else ref - ad_distance

    return TargetProjection(
        tp1=round(tp1, 6),
        tp2=round(tp2, 6),
        tp3=round(tp3, 6),
        method="harmonic_fib",
        full_distance=round(ad_distance, 6),
    )
