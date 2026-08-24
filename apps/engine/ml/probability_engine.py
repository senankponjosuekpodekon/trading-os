"""Probability of success engine for pre-listing / early stage tokens.

Lightweight, deterministic model that combines a handful of on-chain,
social and fundamental features into a 0-100 probability estimate.
No model weights are persisted; this is a rule-based / logistic-style
scorer that can later be replaced with an XGBoost or sklearn model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import math


@dataclass
class ProjectFeatures:
    funding_pct: float = 0.0
    has_audit: bool = False
    social_mentions_7d: int = 0
    github_commits_30d: int = 0
    tvl_millions: float = 0.0
    healthy_unlocks: Optional[bool] = None
    reputable_platform: bool = False
    has_website: bool = False
    has_twitter: bool = False


def _sigmoid(x: float) -> float:
    """Numerically stable sigmoid."""
    if x >= 0:
        z = math.exp(-x)
        return 1 / (1 + z)
    z = math.exp(x)
    return z / (1 + z)


def compute_probability(features: ProjectFeatures) -> float:
    """
    Compute the probability (0-100) that a pre-listing / early project
    will be a successful asymmetric bet.

    The raw log-odds combine:
    - funding momentum (0-20)
    - social proof (0-20)
    - development activity (0-20)
    - TVL traction (0-20)
    - tokenomics / vesting (0-15)
    - trust signals audit/platform/online (0-15)
    """
    log_odds = 0.0

    # 1. Funding (roughly -10 .. +10)
    if features.funding_pct >= 100:
        log_odds += 2.0
    elif features.funding_pct >= 75:
        log_odds += 1.2
    elif features.funding_pct >= 50:
        log_odds += 0.6
    elif features.funding_pct > 0:
        log_odds -= 0.4
    else:
        log_odds -= 1.0

    # 2. Social (0 .. +1.5)
    if features.social_mentions_7d >= 500:
        log_odds += 1.5
    elif features.social_mentions_7d >= 100:
        log_odds += 0.8
    elif features.social_mentions_7d >= 20:
        log_odds += 0.3
    elif features.social_mentions_7d == 0:
        log_odds -= 0.8

    # 3. GitHub (0 .. +1.2)
    if features.github_commits_30d >= 30:
        log_odds += 1.2
    elif features.github_commits_30d >= 10:
        log_odds += 0.6
    elif features.github_commits_30d > 0:
        log_odds += 0.2
    else:
        log_odds -= 0.5

    # 4. TVL (0 .. +1.2)
    if features.tvl_millions >= 10:
        log_odds += 1.2
    elif features.tvl_millions >= 1:
        log_odds += 0.6
    elif features.tvl_millions > 0:
        log_odds += 0.2

    # 5. Unlock / vesting (0 .. +0.8)
    if features.healthy_unlocks is True:
        log_odds += 0.8
    elif features.healthy_unlocks is False:
        log_odds -= 0.8

    # 6. Trust signals (0 .. +0.8)
    if features.has_audit:
        log_odds += 0.5
    if features.reputable_platform:
        log_odds += 0.5
    if features.has_website and features.has_twitter:
        log_odds += 0.3
    elif not features.has_website and not features.has_twitter:
        log_odds -= 1.5

    # Sigmoid maps log-odds -> probability; scale to 0-100
    probability = _sigmoid(log_odds) * 100
    return round(probability, 2)


def explain_probability(
    features: ProjectFeatures,
    probability: float,
) -> List[str]:
    """Return a short human-readable explanation of the probability."""
    reasons: List[str] = []
    if features.funding_pct >= 100:
        reasons.append("Fully funded")
    elif features.funding_pct >= 50:
        reasons.append(f"Funding at {features.funding_pct:.0f}%")
    elif features.funding_pct == 0:
        reasons.append("No funding data")

    if features.social_mentions_7d >= 100:
        reasons.append("Strong social buzz")
    elif features.social_mentions_7d == 0:
        reasons.append("No social mentions")

    if features.github_commits_30d >= 10:
        reasons.append("Active GitHub")
    elif features.github_commits_30d == 0:
        reasons.append("No GitHub activity")

    if features.tvl_millions >= 1:
        reasons.append(f"${features.tvl_millions:.1f}M TVL")

    if features.healthy_unlocks is True:
        reasons.append("Healthy vesting")
    elif features.healthy_unlocks is False:
        reasons.append("Risky vesting/unlocks")

    if features.has_audit:
        reasons.append("Audited")
    if features.reputable_platform:
        reasons.append("Reputable platform")
    if not features.has_website or not features.has_twitter:
        reasons.append("Weak online presence")

    reasons.append(f"Computed probability: {probability}%")
    return reasons
