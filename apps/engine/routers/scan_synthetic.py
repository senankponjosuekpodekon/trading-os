"""Synthetic indices analysis for the scanner."""
from __future__ import annotations
from typing import Optional

import pandas as pd

from routers.synthetic_engine import (
    analyze_synthetic,
    evaluate_synthetic_strategy,
    SYMBOL_TO_DERIV as SYNTHETIC_SYMBOLS,
)
from routers.boom_crash_model import analyze_boom_crash
from features.market_concept_layer import compute_market_concept_vector
from features.market_embedding import build_market_embedding
from ml.feature_factory import build_feature_vector


def _analyze_synthetic_candles(symbol: str, timeframe: str, df: pd.DataFrame, strategy: Optional[dict] = None) -> dict:
    """Route synthetic indices through the statistical engine (no trend-following)."""
    close = df["close"].astype(float)
    deriv_sym = SYNTHETIC_SYMBOLS.get(symbol)
    category = "volatility"
    if deriv_sym:
        from routers.synthetic_engine import DERIV_SYMBOLS as _DERIV_CATS
        category = _DERIV_CATS.get(deriv_sym, "volatility")

    if category == "boom_crash":
        direction = "boom" if "BOOM" in symbol.upper() else "crash"
        stats = analyze_boom_crash(close, direction=direction)
    else:
        stats = analyze_synthetic(close, category=category)

    entry = round(float(close.iloc[-1]), 6)
    confidence = int(min(95, stats.get("spike_probability", 0) + stats.get("mean_reversion_prob", 0) * 0.5))

    synthetic_regime = {"regime": stats.get("regime"), "state": stats.get("state")}
    # reuse the same universal concept layer for synthetic indices
    market_concept_vector = compute_market_concept_vector(
        symbol, df, "SYNTHETIC", regime=synthetic_regime, mtf_regime=synthetic_regime
    )
    market_embedding = build_market_embedding(market_concept_vector, symbol, timeframe)
    feature_vector = build_feature_vector(symbol, timeframe, df)

    # ── Strategy evaluation for synthetic assets ──
    strategy_rules = strategy.get("rules", {}) if strategy else {}
    ev = evaluate_synthetic_strategy(close, stats, category=category, strategy_rules=strategy_rules)

    signal = ev["signal"]
    confidence = ev["confidence"]
    entry_price = ev["entry_price"] or entry
    stop_loss = ev["stop_loss"]
    take_profit_1 = ev["take_profit_1"]
    take_profit_2 = ev["take_profit_2"]
    risk_reward = ev["risk_reward"]
    explanation = " | ".join(ev["reasons"]) if ev["reasons"] else f"Synthetic {category}: {stats.get('state')} | regime={stats.get('regime')}"
    if not explanation.startswith("Synthetic"):
        explanation = f"Synthetic {category}: {explanation}"

    strategy_id = strategy.get("id") if strategy else None
    strategy_name = strategy.get("name") if strategy else None
    trigger = ev["trigger"]
    dps = ev["dps"]

    return {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "timeframe": timeframe,
        "asset_type": "SYNTHETIC",
        "signal": signal,
        "confidence": confidence,
        "score": ev["score"],
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "take_profit_1": take_profit_1,
        "take_profit_2": take_profit_2,
        "scale_out_tp": ev.get("scale_out_tp"),
        "risk_reward": risk_reward,
        "trigger": trigger,
        "signal_pending": ev["signal_pending"],
        "invalidation": ev["invalidation"],
        "dps": dps,
        "tps": None,
        "success_probability": None,
        "expected_move": None,
        "explanation": explanation,
        "indicators": {"close": entry, "atr": round(close.iloc[-20:].std(), 6)},
        "session": {},
        "price_action": {},
        "sr_zones": {},
        "patterns": {},
        "regime": synthetic_regime,
        "smc": {},
        "synthetic_stats": stats,
        "market_concept_vector": market_concept_vector,
        "market_embedding": market_embedding,
        "feature_vector": feature_vector,
    }
