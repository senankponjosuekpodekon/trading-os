"""
Chart Pattern Scoring — Unified scoring for chart patterns + risk integration.

Combines pattern detection, confluence context, order flow, and liquidity
into a single score that feeds into the DisciplineController for position sizing.

Scoring tiers:
  ≥ 0.85 → aggressive risk (0.6-0.8% capital, 120-140% size)
  0.70-0.84 → standard risk (0.45-0.60% capital, 100% size)
  0.60-0.69 → reduced risk (0.25-0.40% capital, 60-80% size)
  < 0.60 → skip (0%)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class RiskTier(Enum):
    AGGRESSIVE = "aggressive"
    STANDARD = "standard"
    REDUCED = "reduced"
    SKIP = "skip"


@dataclass
class PatternContext:
    """Contextual information for scoring a chart pattern."""
    pattern_type: str
    direction: str  # "bullish" or "bearish"

    # Pattern-specific confirmations
    neckline_break_confirmed: bool = False
    volume_confirmation: bool = False
    retest_occurred: bool = False

    # Confluence
    orderflow_alignment: bool = False
    structure_alignment: bool = False  # BOS / CHoCH
    regime_compatible: bool = False
    htf_aligned: bool = False
    mtf_aligned: bool = False

    # Liquidity
    liquidity_grab: bool = False
    liquidity_run: bool = False
    near_liquidity_pool: bool = False

    # Harmonic
    rsi_divergence: bool = False
    prz_confluence: bool = False  # D point at a structural level

    # Order flow metrics
    orderflow_confidence: float = 0.0  # 0-1 from orderflow.py

    # Additional
    rr_ratio: float = 0.0  # risk/reward ratio


@dataclass
class PatternScoreResult:
    score: float
    tier: RiskTier
    risk_pct: float
    size_multiplier: float
    reasons: list[str] = field(default_factory=list)
    components: dict = field(default_factory=dict)


# ── Base scores per pattern type ──────────────────────────────

_BASE_SCORES = {
    "hs_breakdown": 0.35,
    "ihs_breakout": 0.35,
    "bull_flag_breakout": 0.30,
    "bear_flag_breakout": 0.30,
    "double_top": 0.28,
    "double_bottom": 0.28,
    "gartley": 0.40,
    "bat": 0.38,
    "butterfly": 0.36,
    "crab": 0.42,
    "cypher": 0.36,
    "shark": 0.34,
    "triangle_breakout": 0.25,
    "compression_breakout": 0.25,
}


def score_chart_pattern(ctx: PatternContext) -> PatternScoreResult:
    """
    Score a chart pattern based on its type and contextual confirmations.

    Returns a PatternScoreResult with:
      - score: 0-1
      - tier: RiskTier
      - risk_pct: % of capital to risk
      - size_multiplier: relative position size
      - reasons: list of contributing factors
    """
    score = _BASE_SCORES.get(ctx.pattern_type, 0.20)
    reasons: list[str] = []
    components: dict = {}

    # Neckline break confirmation
    if ctx.neckline_break_confirmed:
        score += 0.15
        reasons.append("Neckline break confirmed")
        components["neckline_break"] = 0.15

    # Volume confirmation
    if ctx.volume_confirmation:
        score += 0.12
        reasons.append("Volume confirmation")
        components["volume"] = 0.12

    # Order flow alignment
    if ctx.orderflow_alignment:
        of_bonus = 0.18
        # If we have a confidence value, scale the bonus
        if ctx.orderflow_confidence > 0:
            of_bonus = 0.10 + 0.08 * ctx.orderflow_confidence
        score += of_bonus
        reasons.append(f"Order flow aligned (conf={ctx.orderflow_confidence:.2f})")
        components["orderflow"] = round(of_bonus, 3)

    # Structure alignment (BOS/CHoCH)
    if ctx.structure_alignment:
        score += 0.12
        reasons.append("Structure aligned (BOS/CHoCH)")
        components["structure"] = 0.12

    # Retest occurred
    if ctx.retest_occurred:
        score += 0.08
        reasons.append("Retest occurred")
        components["retest"] = 0.08

    # Regime compatibility
    if ctx.regime_compatible:
        score += 0.05
        reasons.append("Regime compatible")
        components["regime"] = 0.05

    # HTF/MTF alignment
    if ctx.htf_aligned:
        score += 0.06
        reasons.append("HTF aligned")
        components["htf"] = 0.06
    if ctx.mtf_aligned:
        score += 0.04
        reasons.append("MTF aligned")
        components["mtf"] = 0.04

    # Liquidity grab (strong reversal signal)
    if ctx.liquidity_grab:
        score += 0.10
        reasons.append("Liquidity grab detected (stop hunt)")
        components["liquidity_grab"] = 0.10

    # Liquidity run (continuation signal)
    if ctx.liquidity_run:
        score += 0.07
        reasons.append("Liquidity run confirmed (true breakout)")
        components["liquidity_run"] = 0.07

    # Near liquidity pool (magnet)
    if ctx.near_liquidity_pool:
        score += 0.03
        reasons.append("Near liquidity pool")
        components["near_liquidity"] = 0.03

    # RSI divergence (harmonic confirmation)
    if ctx.rsi_divergence:
        score += 0.10
        reasons.append("RSI divergence at reversal point")
        components["rsi_divergence"] = 0.10

    # PRZ confluence (harmonic D at structural level)
    if ctx.prz_confluence:
        score += 0.08
        reasons.append("PRZ confluence with structure")
        components["prz_confluence"] = 0.08

    # R/R ratio bonus
    if ctx.rr_ratio >= 3.0:
        score += 0.05
        reasons.append(f"Strong R:R ({ctx.rr_ratio:.1f})")
        components["rr_bonus"] = 0.05
    elif ctx.rr_ratio >= 2.0:
        score += 0.03
        reasons.append(f"Good R:R ({ctx.rr_ratio:.1f})")
        components["rr_bonus"] = 0.03

    score = min(score, 1.0)

    # Determine risk tier
    if score >= 0.85:
        tier = RiskTier.AGGRESSIVE
        risk_pct = 0.7
        size_multiplier = 1.3
    elif score >= 0.70:
        tier = RiskTier.STANDARD
        risk_pct = 0.5
        size_multiplier = 1.0
    elif score >= 0.60:
        tier = RiskTier.REDUCED
        risk_pct = 0.3
        size_multiplier = 0.7
    else:
        tier = RiskTier.SKIP
        risk_pct = 0.0
        size_multiplier = 0.0

    return PatternScoreResult(
        score=round(score, 3),
        tier=tier,
        risk_pct=risk_pct,
        size_multiplier=size_multiplier,
        reasons=reasons,
        components=components,
    )


def get_risk_tier(score: float) -> RiskTier:
    """Get the risk tier from a score value."""
    if score >= 0.85:
        return RiskTier.AGGRESSIVE
    elif score >= 0.70:
        return RiskTier.STANDARD
    elif score >= 0.60:
        return RiskTier.REDUCED
    return RiskTier.SKIP
