"""Risk level classification for trading signals.

Combines asset_type, market_cap_tier, liquidity_score, and volatility
to produce a risk_level: EXTREME | HIGH | MODERATE | LOW

Rules:
  EXTREME  = MICRO cap crypto + liquidity < 30 OR volatility > 20%
  HIGH     = SMALL cap crypto OR liquidity < 50 OR volatility > 10%
  MODERATE = MID cap crypto or major forex with normal conditions
  LOW      = LARGE cap crypto, major forex, commodities, BRVM
"""


def compute_risk_level(
    asset_type: str,
    market_cap_tier: str,
    liquidity_score: float,
    atr_pct: float = 0.0,
) -> dict:
    """Compute risk level from asset characteristics.

    Returns:
        {
            "risk_level": "EXTREME" | "HIGH" | "MODERATE" | "LOW",
            "reasons": list[str],
        }
    """
    reasons = []

    # Non-crypto assets have bounded risk
    if asset_type == "BRVM":
        level = "MODERATE"
        if liquidity_score < 30:
            level = "HIGH"
            reasons.append("BRVM + liquidité limitée")
        return {"risk_level": level, "reasons": reasons or ["BRVM — liquidité structurellement limitée"]}

    if asset_type == "SYNTHETIC":
        if atr_pct > 15:
            return {"risk_level": "EXTREME", "reasons": ["Synthetic + volatilité extrême"]}
        if atr_pct > 8:
            return {"risk_level": "HIGH", "reasons": ["Synthetic + volatilité élevée"]}
        return {"risk_level": "MODERATE", "reasons": ["Synthetic — risque statistique modéré"]}

    if asset_type in ("FOREX", "COMMODITY"):
        if liquidity_score < 30:
            return {"risk_level": "HIGH", "reasons": ["Liquidité faible"]}
        return {"risk_level": "LOW", "reasons": ["Marché majeur — liquidité élevée"]}

    if asset_type == "US_STOCK":
        if market_cap_tier == "MICRO":
            return {"risk_level": "EXTREME", "reasons": ["Micro-cap stock"]}
        if market_cap_tier == "SMALL":
            return {"risk_level": "HIGH", "reasons": ["Small-cap stock"]}
        return {"risk_level": "MODERATE", "reasons": ["Large-cap stock"]}

    # CRYPTO — the main focus
    if market_cap_tier == "MICRO":
        if liquidity_score < 30:
            level = "EXTREME"
            reasons.append("Micro-cap crypto + liquidité critique")
        elif atr_pct > 20:
            level = "EXTREME"
            reasons.append("Micro-cap crypto + volatilité extrême")
        else:
            level = "HIGH"
            reasons.append("Micro-cap crypto — risque élevé par défaut")
        return {"risk_level": level, "reasons": reasons}

    if market_cap_tier == "SMALL":
        if liquidity_score < 30:
            level = "HIGH"
            reasons.append("Small-cap crypto + liquidité faible")
        elif atr_pct > 15:
            level = "HIGH"
            reasons.append("Small-cap crypto + volatilité élevée")
        else:
            level = "HIGH"
            reasons.append("Small-cap crypto — risque élevé")
        return {"risk_level": level, "reasons": reasons}

    if market_cap_tier == "MID":
        if liquidity_score < 30:
            level = "HIGH"
            reasons.append("Mid-cap crypto + liquidité faible")
        elif atr_pct > 15:
            level = "HIGH"
            reasons.append("Mid-cap crypto + volatilité élevée")
        else:
            level = "MODERATE"
            reasons.append("Mid-cap crypto — risque modéré")
        return {"risk_level": level, "reasons": reasons}

    # LARGE cap (BTC, ETH, etc.)
    if liquidity_score < 30:
        level = "HIGH"
        reasons.append("Large-cap crypto + liquidité faible (anormal)")
    elif atr_pct > 20:
        level = "HIGH"
        reasons.append("Large-cap crypto + volatilité élevée")
    else:
        level = "LOW"
        reasons.append("Large-cap crypto — liquidité et stabilité élevées")
    return {"risk_level": level, "reasons": reasons}


def get_max_position_pct(risk_level: str) -> float:
    """Maximum position size as % of capital based on risk level."""
    limits = {
        "EXTREME": 0.01,   # max 1%
        "HIGH": 0.02,      # max 2%
        "MODERATE": 0.05,  # max 5%
        "LOW": 0.10,       # max 10%
    }
    return limits.get(risk_level, 0.02)
