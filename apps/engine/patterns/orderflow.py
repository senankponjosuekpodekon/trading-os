"""
Order Flow Filters — Confirm breakouts with delta, imbalances, and absorption.

Provides filters for:
  - Neckline breaks (H&S / Inverse H&S)
  - Flag/Pennant breakouts
  - General breakout validation

Order flow data is typically provided by external feeds (e.g. Bookmap, Sierra,
or a custom L2/delta feed). This module accepts pre-computed order flow metrics
and returns confirmation/rejection.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from enum import Enum


class BreakoutType(Enum):
    NECKLINE_BEARISH = "neckline_bearish"
    NECKLINE_BULLISH = "neckline_bullish"
    FLAG_BULLISH = "flag_bullish"
    FLAG_BEARISH = "flag_bearish"
    GENERAL_BULLISH = "general_bullish"
    GENERAL_BEARISH = "general_bearish"


@dataclass
class OrderFlowData:
    delta: float = 0.0           # buy volume - sell volume
    stacked_imbalances: int = 0  # count of stacked imbalances
    absorption: bool = False     # absorption detected
    volume_ratio: float = 1.0   # volume vs average
    cvd_trend: str = "neutral"  # "up", "down", "neutral"


@dataclass
class OrderFlowResult:
    confirmed: bool
    confidence: float            # 0-1
    reason: str
    delta: float
    stacked_imbalances: int


@dataclass
class OrderFlowConfig:
    min_delta_bullish: float = 1200.0
    min_delta_bearish: float = -1200.0
    min_stacked_imbalances: int = 2
    min_volume_ratio: float = 1.3
    absorption_grab_threshold: float = 0.6  # If absorption + low volume ratio → likely grab


def confirm_breakout(
    breakout_type: BreakoutType,
    of: OrderFlowData,
    config: Optional[OrderFlowConfig] = None,
) -> OrderFlowResult:
    """
    Confirm a breakout using order flow data.

    Rules:
      - Bullish breakout: positive delta + stacked buy imbalances + volume
      - Bearish breakout: negative delta + stacked sell imbalances + volume
      - Absorption + low volume → likely grab (false breakout)
    """
    cfg = config or OrderFlowConfig()

    is_bullish = breakout_type in (
        BreakoutType.NECKLINE_BULLISH,
        BreakoutType.FLAG_BULLISH,
        BreakoutType.GENERAL_BULLISH,
    )

    # Absorption + low volume → likely grab
    if of.absorption and of.volume_ratio < cfg.absorption_grab_threshold:
        return OrderFlowResult(
            confirmed=False,
            confidence=0.3,
            reason=f"Absorption + low volume (ratio={of.volume_ratio:.2f}) → likely grab, not breakout",
            delta=of.delta,
            stacked_imbalances=of.stacked_imbalances,
        )

    # Volume check
    if of.volume_ratio < cfg.min_volume_ratio:
        return OrderFlowResult(
            confirmed=False,
            confidence=0.4,
            reason=f"Volume too low (ratio={of.volume_ratio:.2f} < {cfg.min_volume_ratio}) — no initiative",
            delta=of.delta,
            stacked_imbalances=of.stacked_imbalances,
        )

    # Delta check
    if is_bullish:
        if of.delta < cfg.min_delta_bullish:
            return OrderFlowResult(
                confirmed=False,
                confidence=0.35,
                reason=f"Delta too low for bullish breakout ({of.delta:.0f} < {cfg.min_delta_bullish:.0f})",
                delta=of.delta,
                stacked_imbalances=of.stacked_imbalances,
            )
    else:
        if of.delta > cfg.min_delta_bearish:
            return OrderFlowResult(
                confirmed=False,
                confidence=0.35,
                reason=f"Delta too high for bearish breakout ({of.delta:.0f} > {cfg.min_delta_bearish:.0f})",
                delta=of.delta,
                stacked_imbalances=of.stacked_imbalances,
            )

    # Stacked imbalances check
    if of.stacked_imbalances < cfg.min_stacked_imbalances:
        return OrderFlowResult(
            confirmed=False,
            confidence=0.5,
            reason=f"Insufficient stacked imbalances ({of.stacked_imbalances} < {cfg.min_stacked_imbalances})",
            delta=of.delta,
            stacked_imbalances=of.stacked_imbalances,
        )

    # CVD trend alignment
    cvd_aligned = (
        (is_bullish and of.cvd_trend == "up") or
        (not is_bullish and of.cvd_trend == "down")
    )

    confidence = 0.7
    if cvd_aligned:
        confidence += 0.15
    if of.volume_ratio > 2.0:
        confidence += 0.10
    confidence = min(confidence, 1.0)

    return OrderFlowResult(
        confirmed=True,
        confidence=round(confidence, 2),
        reason=f"Breakout confirmed: delta={of.delta:.0f}, stacked={of.stacked_imbalances}, vol_ratio={of.volume_ratio:.2f}, cvd={of.cvd_trend}",
        delta=of.delta,
        stacked_imbalances=of.stacked_imbalances,
    )


def orderflow_confirm_break(
    direction: str,
    delta: float,
    stacked_imb: int,
    absorption: bool,
    volume_ratio: float = 1.0,
) -> bool:
    """
    Simple boolean confirmation for backward compatibility.

    direction: "bullish" or "bearish"
    """
    of = OrderFlowData(
        delta=delta,
        stacked_imbalances=stacked_imb,
        absorption=absorption,
        volume_ratio=volume_ratio,
    )
    breakout_type = (
        BreakoutType.GENERAL_BULLISH if direction == "bullish"
        else BreakoutType.GENERAL_BEARISH
    )
    result = confirm_breakout(breakout_type, of)
    return result.confirmed
