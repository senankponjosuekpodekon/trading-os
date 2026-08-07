"""
Token Grade — Phase I
Aggregated 0-100 score combining multiple assessment layers.
Inspired by Token Metrics' grading system.

Layers:
  1. Technical score (from scan.py engine score, normalized 0-100)
  2. On-chain score (from onchain_bonus, normalized 0-100)
  3. Social score (from social_sentiment / FinBERT, normalized 0-100)
  4. Tokenomics score (from tokenomics penalty, normalized 0-100)
  5. Performance score (volatility vs return profile, normalized 0-100)

Final grade = weighted average of all available layers.
"""
from __future__ import annotations

from typing import Dict, Optional, List
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class TokenGrade:
    symbol: str
    grade: int  # 0-100
    label: str  # A+ / A / B+ / B / C+ / C / D / F
    layers: Dict[str, float]  # per-layer scores
    weights_used: Dict[str, float]
    available_layers: List[str]
    missing_layers: List[str]
    recommendation: str  # strong_buy | buy | hold | caution | avoid


# ── Grading scale ────────────────────────────────────────────────────────────

_GRADE_SCALE = [
    (90, "A+"),
    (85, "A"),
    (80, "A-"),
    (75, "B+"),
    (70, "B"),
    (65, "B-"),
    (60, "C+"),
    (55, "C"),
    (50, "C-"),
    (40, "D"),
    (0, "F"),
]


def _score_to_label(score: int) -> str:
    for threshold, label in _GRADE_SCALE:
        if score >= threshold:
            return label
    return "F"


def _score_to_recommendation(score: int) -> str:
    if score >= 85:
        return "strong_buy"
    elif score >= 70:
        return "buy"
    elif score >= 55:
        return "hold"
    elif score >= 40:
        return "caution"
    return "avoid"


# ── Layer normalization ──────────────────────────────────────────────────────

def _normalize_technical(score: float, confidence: float) -> float:
    """Normalize engine score (typically -100..100) and confidence (0-95) to 0-100."""
    # Use confidence as primary, with score direction as modifier
    base = confidence  # 0-95
    # If score is positive (bullish), boost slightly; negative, reduce
    direction_mod = max(-10, min(10, score * 0.1))
    return max(0, min(100, base + direction_mod))


def _normalize_onchain(onchain_bonus: float) -> float:
    """Normalize onchain bonus (typically -20..+30) to 0-100."""
    # 0 bonus = 50 (neutral), +20 = 80, -20 = 20
    return max(0, min(100, 50 + onchain_bonus * 1.5))


def _normalize_social(social_score: float) -> float:
    """Normalize social sentiment score (-1..1) to 0-100."""
    # -1 = 0, 0 = 50, +1 = 100
    return max(0, min(100, 50 + social_score * 50))


def _normalize_tokenomics(tokenomics_penalty: float, danger_flag: bool) -> float:
    """Normalize tokenomics penalty (0 = safe, higher = worse) to 0-100."""
    if danger_flag:
        return 15  # hard cap for dangerous tokens
    # 0 penalty = 90, 10 penalty = 40, 20+ = 20
    return max(10, min(100, 90 - tokenomics_penalty * 5))


def _normalize_performance(volatility_pct: float, return_pct: float) -> float:
    """
    Normalize volatility vs return profile to 0-100.
    High return + low volatility = high score.
    """
    if volatility_pct <= 0:
        return 50  # neutral if no data
    # Sharpe-like ratio: return / volatility
    ratio = return_pct / max(volatility_pct, 0.1)
    # ratio > 1 = excellent, 0.5 = good, 0 = neutral, < 0 = bad
    return max(0, min(100, 50 + ratio * 30))


# ── Default weights ──────────────────────────────────────────────────────────

DEFAULT_WEIGHTS: Dict[str, float] = {
    "technical": 0.35,
    "onchain": 0.20,
    "social": 0.15,
    "tokenomics": 0.20,
    "performance": 0.10,
}


# ── Main grading function ────────────────────────────────────────────────────

def compute_token_grade(
    symbol: str,
    *,
    technical_score: Optional[float] = None,
    technical_confidence: Optional[float] = None,
    onchain_bonus: Optional[float] = None,
    social_score: Optional[float] = None,
    tokenomics_penalty: Optional[float] = None,
    tokenomics_danger: Optional[bool] = None,
    volatility_pct: Optional[float] = None,
    return_pct: Optional[float] = None,
    weights: Optional[Dict[str, float]] = None,
) -> TokenGrade:
    """
    Compute a comprehensive 0-100 token grade from available data layers.
    Missing layers are excluded and weights are redistributed proportionally.
    """
    w = weights or DEFAULT_WEIGHTS

    layers: Dict[str, float] = {}
    available: List[str] = []
    missing: List[str] = []

    # Layer 1: Technical
    if technical_score is not None and technical_confidence is not None:
        layers["technical"] = _normalize_technical(technical_score, technical_confidence)
        available.append("technical")
    else:
        missing.append("technical")

    # Layer 2: On-chain
    if onchain_bonus is not None:
        layers["onchain"] = _normalize_onchain(onchain_bonus)
        available.append("onchain")
    else:
        missing.append("onchain")

    # Layer 3: Social
    if social_score is not None:
        layers["social"] = _normalize_social(social_score)
        available.append("social")
    else:
        missing.append("social")

    # Layer 4: Tokenomics
    if tokenomics_penalty is not None or tokenomics_danger is not None:
        layers["tokenomics"] = _normalize_tokenomics(
            tokenomics_penalty or 0,
            tokenomics_danger or False,
        )
        available.append("tokenomics")
    else:
        missing.append("tokenomics")

    # Layer 5: Performance
    if volatility_pct is not None and return_pct is not None:
        layers["performance"] = _normalize_performance(volatility_pct, return_pct)
        available.append("performance")
    else:
        missing.append("performance")

    # Redistribute weights for missing layers
    active_weights = {}
    total_weight = 0.0
    for layer in available:
        active_weights[layer] = w.get(layer, 0.1)
        total_weight += active_weights[layer]

    if total_weight == 0 or not available:
        # No data at all
        return TokenGrade(
            symbol=symbol,
            grade=50,
            label="C",
            layers={},
            weights_used={},
            available_layers=[],
            missing_layers=available + missing,
            recommendation="hold",
        )

    # Normalize weights
    for k in active_weights:
        active_weights[k] /= total_weight

    # Compute weighted average
    grade = sum(layers[layer] * active_weights[layer] for layer in available)
    grade_int = int(round(grade))

    return TokenGrade(
        symbol=symbol,
        grade=grade_int,
        label=_score_to_label(grade_int),
        layers={k: round(v, 2) for k, v in layers.items()},
        weights_used={k: round(v, 4) for k, v in active_weights.items()},
        available_layers=available,
        missing_layers=missing,
        recommendation=_score_to_recommendation(grade_int),
    )


def grade_to_dict(grade: TokenGrade) -> Dict:
    """Convert TokenGrade to dict for API responses."""
    return {
        "symbol": grade.symbol,
        "grade": grade.grade,
        "label": grade.label,
        "recommendation": grade.recommendation,
        "layers": grade.layers,
        "weights": grade.weights_used,
        "available_layers": grade.available_layers,
        "missing_layers": grade.missing_layers,
    }
