"""
XGBoost Shadow Mode — Phase I integration
Runs XGBoost scorer alongside the production logistic regression scorer.
Logs comparison metrics without affecting production signals.

When enough data confirms XGBoost is superior, it can be promoted to production
via a simple config flag.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

from utils.logger import get_logger

logger = get_logger(__name__)

# Accumulate comparison stats
_shadow_stats: Dict[str, Any] = {
    "total_predictions": 0,
    "agreements": 0,
    "disagreements": 0,
    "xgb_more_confident": 0,
    "logistic_more_confident": 0,
    "recent_comparisons": [],
    "started_at": datetime.now(timezone.utc).isoformat(),
}


@dataclass
class ShadowComparison:
    logistic_prob: float
    xgb_prob: float
    agreement: bool
    winner: str  # "agreement" | "xgb" | "logistic"
    delta: float
    timestamp: str


async def shadow_predict(features: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run both logistic and XGBoost scorers in parallel.
    Returns the logistic result (production) + shadow XGBoost result for logging.
    """
    from ml.signal_scorer import signal_scorer
    from ml.xgboost_scorer import XGBoostSignalScorer

    # Get logistic prediction (production)
    try:
        logistic_result = await signal_scorer.predict(features)
    except Exception as exc:
        logger.warning("shadow_logistic_failed", error=str(exc))
        logistic_result = {"probability": 0.5, "confidence_ml": 50.0, "trained": False}

    # Get XGBoost prediction (shadow)
    xgb_result = None
    try:
        xgb_scorer = XGBoostSignalScorer()
        xgb_result = await xgb_scorer.predict(features)
    except Exception as exc:
        # XGBoost might not be trained yet — that's OK in shadow mode
        logger.debug("shadow_xgb_not_ready", error=str(exc))
        xgb_result = {"probability": 0.5, "confidence_ml": 50.0, "trained": False}

    # Compare
    log_prob = logistic_result.get("probability", 0.5)
    xgb_prob = xgb_result.get("probability", 0.5)
    delta = abs(log_prob - xgb_prob)
    agreement = delta < 0.1  # Within 10% probability = agreement

    if agreement:
        winner = "agreement"
        _shadow_stats["agreements"] += 1
    elif xgb_prob > log_prob:
        winner = "xgb"
        _shadow_stats["xgb_more_confident"] += 1
        _shadow_stats["disagreements"] += 1
    else:
        winner = "logistic"
        _shadow_stats["logistic_more_confident"] += 1
        _shadow_stats["disagreements"] += 1

    _shadow_stats["total_predictions"] += 1

    comparison = ShadowComparison(
        logistic_prob=round(log_prob, 4),
        xgb_prob=round(xgb_prob, 4),
        agreement=agreement,
        winner=winner,
        delta=round(delta, 4),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    # Keep last 100 comparisons
    _shadow_stats["recent_comparisons"].append({
        "logistic_prob": comparison.logistic_prob,
        "xgb_prob": comparison.xgb_prob,
        "winner": comparison.winner,
        "delta": comparison.delta,
        "timestamp": comparison.timestamp,
    })
    if len(_shadow_stats["recent_comparisons"]) > 100:
        _shadow_stats["recent_comparisons"] = _shadow_stats["recent_comparisons"][-100:]

    # Log disagreements for analysis
    if not agreement:
        logger.info(
            "shadow_disagreement",
            logistic=log_prob,
            xgb=xgb_prob,
            delta=delta,
            winner=winner,
        )

    # Return production result + shadow data
    return {
        **logistic_result,
        "shadow_xgb": {
            "probability": xgb_prob,
            "confidence_ml": xgb_result.get("confidence_ml", 50.0),
            "trained": xgb_result.get("trained", False),
            "agreement": agreement,
            "delta": comparison.delta,
            "winner": winner,
        },
    }


def get_shadow_stats() -> Dict[str, Any]:
    """Get accumulated shadow mode comparison statistics."""
    total = _shadow_stats["total_predictions"]
    if total == 0:
        return {**_shadow_stats, "agreement_rate": 0, "xgb_win_rate": 0}

    return {
        "total_predictions": total,
        "agreements": _shadow_stats["agreements"],
        "disagreements": _shadow_stats["disagreements"],
        "agreement_rate": round(_shadow_stats["agreements"] / total * 100, 2),
        "xgb_more_confident": _shadow_stats["xgb_more_confident"],
        "logistic_more_confident": _shadow_stats["logistic_more_confident"],
        "xgb_win_rate": round(_shadow_stats["xgb_more_confident"] / max(_shadow_stats["disagreements"], 1) * 100, 2),
        "recent_comparisons": _shadow_stats["recent_comparisons"][-10:],
        "started_at": _shadow_stats["started_at"],
    }


def reset_shadow_stats():
    """Reset shadow mode statistics (admin function)."""
    global _shadow_stats
    _shadow_stats = {
        "total_predictions": 0,
        "agreements": 0,
        "disagreements": 0,
        "xgb_more_confident": 0,
        "logistic_more_confident": 0,
        "recent_comparisons": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
