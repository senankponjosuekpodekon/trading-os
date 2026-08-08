"""DCA / Tranche accumulation logic.

When Fear & Greed is very low (≤ 25 = Extreme Fear), suggest splitting
entry into 4 tranches instead of one lump sum. This reduces timing risk
in volatile markets.

Tranche schedule:
  - Tranche 1: 40% at signal entry (immediate)
  - Tranche 2: 30% if price drops 5% below entry
  - Tranche 3: 20% if price drops 10% below entry
  - Tranche 4: 10% if price drops 15% below entry (or F&G ≤ 15)

When Fear & Greed is very high (≥ 75 = Extreme Greed), suggest scaling out:
  - Sell 25% at each 10% gain
"""

FEAR_GREED_ACCUMULATION_THRESHOLD = 25  # Extreme Fear → DCA mode
FEAR_GREED_EXTREME_FEAR = 15            # Deep fear → last tranche trigger
FEAR_GREED_GREED_THRESHOLD = 75         # Extreme Greed → scale-out mode


def compute_dca_tranches(signal: str, entry: float | None, fear_greed_value: int | None) -> dict | None:
    """Compute DCA tranche schedule for accumulation mode.

    Returns None if not in accumulation mode (F&G > threshold or no entry).
    """
    if entry is None or entry <= 0 or fear_greed_value is None:
        return None

    if fear_greed_value > FEAR_GREED_ACCUMULATION_THRESHOLD:
        return None

    if signal == "BUY":
        tranches = [
            {"tranche": 1, "pct": 40, "trigger": "immediate", "price": round(entry, 6)},
            {"tranche": 2, "pct": 30, "trigger": "-5% from entry", "price": round(entry * 0.95, 6)},
            {"tranche": 3, "pct": 20, "trigger": "-10% from entry", "price": round(entry * 0.90, 6)},
            {"tranche": 4, "pct": 10, "trigger": f"-15% or F&G ≤ {FEAR_GREED_EXTREME_FEAR}", "price": round(entry * 0.85, 6)},
        ]
    elif signal == "SELL":
        # For SELL in extreme fear, it's likely a hedge — single entry
        return None
    else:
        return None

    return {
        "mode": "DCA_ACCUMULATION",
        "fear_greed": fear_greed_value,
        "tranches": tranches,
        "description": f"F&G={fear_greed_value} (Extreme Fear) — entrée échelonnée en 4 tranches",
    }


def compute_scale_out(signal: str, entry: float | None, fear_greed_value: int | None) -> dict | None:
    """Compute scale-out schedule for extreme greed mode.

    Returns None if not in greed mode or no entry.
    """
    if entry is None or entry <= 0 or fear_greed_value is None:
        return None

    if fear_greed_value < FEAR_GREED_GREED_THRESHOLD:
        return None

    if signal == "BUY":
        # In extreme greed, suggest taking profits progressively
        targets = [
            {"step": 1, "pct": 25, "trigger": "+10% from entry", "price": round(entry * 1.10, 6)},
            {"step": 2, "pct": 25, "trigger": "+20% from entry", "price": round(entry * 1.20, 6)},
            {"step": 3, "pct": 25, "trigger": "+30% from entry", "price": round(entry * 1.30, 6)},
            {"step": 4, "pct": 25, "trigger": "trailing stop or F&G < 50", "price": None},
        ]
    elif signal == "SELL":
        return None
    else:
        return None

    return {
        "mode": "SCALE_OUT",
        "fear_greed": fear_greed_value,
        "steps": targets,
        "description": f"F&G={fear_greed_value} (Extreme Greed) — sortie échelonnée en 4 étapes",
    }
