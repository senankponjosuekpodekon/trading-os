"""
Signal Quality Filter — 6-layer gate applied at signal generation time.

Layers (from filt.md architecture):
  1. Regime filter          — (already in scan.py via detect_regime)
  2. Session/timing filter  — block signals outside optimal session windows
  3. Liquidity gate         — hard reject if liquidity score < threshold
  4. MTF confluence         — (already in scan.py via mtf_context)
  5. Correlation filter     — (already in scan.py via smc/liquidity)
  6. Execution filter       — reject if spread > X% of TP distance

This module implements layers 2, 3, and 6 as a unified quality gate.
Layers 1, 4, 5 are already handled in scan.py and are not duplicated here.

Usage:
    from risk.signal_quality_filter import apply_quality_gate
    result = apply_quality_gate(signal_dict, asset_type, symbol, df, session_info, liquidity_data)
    if not result["passed"]:
        # signal is rejected — don't persist or display
"""
from datetime import datetime, timezone
from typing import Optional
import structlog

log = structlog.get_logger()

# ── Minimum liquidity scores by asset type ──────────────────────────
MIN_LIQUIDITY_SCORE = {
    "CRYPTO": 20.0,
    "FOREX": 50.0,
    "COMMODITY": 40.0,
    "GOLD": 50.0,
    "SYNTHETIC": 40.0,
    "BRVM": 10.0,      # structurally low — very permissive
    "US_STOCK": 40.0,
}

# ── Session windows by asset type (UTC hours) ───────────────────────
# None = no session restriction (24/7 markets)
SESSION_WINDOWS = {
    "CRYPTO": None,       # 24/7
    "SYNTHETIC": None,    # 24/7
    "FOREX": {
        "optimal": [(7, 22)],     # London + NY
        "avoid": [(21, 22)],      # Rollover
        "weekend_block": True,
    },
    "GOLD": {
        "optimal": [(7, 22)],     # London + COMEX
        "avoid": [(0, 7)],        # Asian thin liquidity
        "weekend_block": True,
    },
    "COMMODITY": {
        "optimal": [(7, 22)],
        "avoid": [(21, 22)],
        "weekend_block": True,
    },
    "US_STOCK": {
        "optimal": [(14, 21)],    # 14:30–21:00 UTC (9:30–16:00 ET)
        "avoid": [(0, 14), (21, 24)],
        "weekend_block": True,
    },
    "BRVM": {
        "optimal": [(9, 15)],     # 09:00–15:00 UTC
        "avoid": [(0, 9), (15, 24)],
        "weekend_block": True,
    },
}

# ── Volume gate: minimum volume ratio for breakout signals ──────────
MIN_VOLUME_RATIO = 1.3   # breakout needs >= 1.3x average volume

# ── Spread filter: max spread as % of TP distance ───────────────────
MAX_SPREAD_PCT_OF_TP = 15.0   # reject if spread > 15% of (entry→TP1 distance)


def _is_in_window(hour: int, windows: list[tuple[int, int]]) -> bool:
    for start, end in windows:
        if start <= end:
            if start <= hour < end:
                return True
        else:
            # wraps midnight
            if hour >= start or hour < end:
                return True
    return False


def _check_session(asset_type: str, session_info: dict) -> dict:
    """Layer 2 — Session/timing filter."""
    windows = SESSION_WINDOWS.get(asset_type)
    if windows is None:
        return {"passed": True, "reason": None, "layer": "session"}

    hour = session_info.get("hour", datetime.now(timezone.utc).hour)
    is_weekend = session_info.get("is_weekend", False)

    if is_weekend and windows.get("weekend_block", False):
        return {
            "passed": False,
            "reason": f"Weekend block — {asset_type} signals suspended",
            "layer": "session",
        }

    avoid = windows.get("avoid", [])
    if _is_in_window(hour, avoid):
        return {
            "passed": False,
            "reason": f"Off-session (UTC hour {hour}) — {asset_type} signals suspended",
            "layer": "session",
        }

    optimal = windows.get("optimal", [])
    in_optimal = _is_in_window(hour, optimal)
    return {
        "passed": True,
        "reason": None,
        "layer": "session",
        "in_optimal": in_optimal,
        "session_penalty": 0.0 if in_optimal else 0.15,  # 15% confidence reduction outside optimal
    }


def _check_liquidity(asset_type: str, liquidity_data: Optional[dict]) -> dict:
    """Layer 3 — Liquidity gate (hard reject below threshold)."""
    if not liquidity_data:
        return {"passed": True, "reason": None, "layer": "liquidity", "score": None}

    score = liquidity_data.get("score", 50.0)
    min_score = MIN_LIQUIDITY_SCORE.get(asset_type, 20.0)

    if score < min_score:
        return {
            "passed": False,
            "reason": f"Liquidity score {score:.1f} < {min_score} — signal rejected",
            "layer": "liquidity",
            "score": score,
        }

    return {
        "passed": True,
        "reason": None,
        "layer": "liquidity",
        "score": score,
    }


def _check_volume_gate(df, signal: str) -> dict:
    """Layer 3b — Volume confirmation for breakout signals."""
    if df is None or "volume" not in df.columns or len(df) < 20:
        return {"passed": True, "reason": None, "layer": "volume"}

    try:
        recent_vol = float(df["volume"].iloc[-1])
        avg_vol = float(df["volume"].iloc[-20:].mean())
        if avg_vol <= 0:
            return {"passed": True, "reason": None, "layer": "volume"}

        vol_ratio = recent_vol / avg_vol

        # Only hard-reject on very low volume (< 0.5x) — below 1.3x is a penalty
        if vol_ratio < 0.5:
            return {
                "passed": False,
                "reason": f"Volume ratio {vol_ratio:.2f} < 0.5 — insufficient conviction",
                "layer": "volume",
                "vol_ratio": vol_ratio,
            }

        penalty = 0.0
        if vol_ratio < MIN_VOLUME_RATIO:
            penalty = (MIN_VOLUME_RATIO - vol_ratio) * 0.3  # up to ~24% reduction

        return {
            "passed": True,
            "reason": None,
            "layer": "volume",
            "vol_ratio": vol_ratio,
            "volume_penalty": penalty,
        }
    except Exception:
        return {"passed": True, "reason": None, "layer": "volume"}


def _check_spread_vs_tp(
    asset_type: str,
    liquidity_data: Optional[dict],
    entry: Optional[float],
    tp1: Optional[float],
) -> dict:
    """Layer 6 — Spread/slippage filter: reject if spread > X% of TP distance."""
    if not liquidity_data or entry is None or tp1 is None:
        return {"passed": True, "reason": None, "layer": "spread"}

    # Only crypto has real spread data from liquidity module
    if asset_type != "CRYPTO":
        return {"passed": True, "reason": None, "layer": "spread"}

    spread_score = liquidity_data.get("spread_score", 15.0)
    # Convert spread_score back to approximate spread pct:
    # 30 = <0.01%, 25 = <0.05%, 20 = <0.1%, 10 = <0.5%, 5 = <1%, 0 = >=1%
    spread_pct_map = {30: 0.01, 25: 0.05, 20: 0.1, 10: 0.5, 5: 1.0, 0: 2.0}
    spread_pct = spread_pct_map.get(int(spread_score), 0.1)

    tp_distance = abs(tp1 - entry)
    tp_distance_pct = (tp_distance / entry) * 100 if entry > 0 else 0

    if tp_distance_pct <= 0:
        return {"passed": True, "reason": None, "layer": "spread"}

    spread_of_tp = (spread_pct / tp_distance_pct) * 100

    if spread_of_tp > MAX_SPREAD_PCT_OF_TP:
        return {
            "passed": False,
            "reason": f"Spread {spread_pct:.2f}% = {spread_of_tp:.1f}% of TP distance — slippage risk",
            "layer": "spread",
            "spread_pct": spread_pct,
            "spread_of_tp": spread_of_tp,
        }

    return {
        "passed": True,
        "reason": None,
        "layer": "spread",
        "spread_pct": spread_pct,
        "spread_of_tp": spread_of_tp,
    }


def apply_quality_gate(
    signal: str,
    asset_type: str,
    symbol: str,
    entry: Optional[float] = None,
    tp1: Optional[float] = None,
    df=None,
    session_info: Optional[dict] = None,
    liquidity_data: Optional[dict] = None,
) -> dict:
    """
    Apply the 6-layer quality gate to a signal.

    Returns:
        {
            "passed": bool,           — True if signal passes all hard gates
            "rejected_layers": list,  — layers that failed
            "confidence_penalty": float, — total penalty to apply to confidence (0-1)
            "quality_flags": list,    — human-readable flags for display
            "quality_score": int,     — 0-100 composite quality score
        }
    """
    if signal == "NEUTRAL":
        return {
            "passed": True,
            "rejected_layers": [],
            "confidence_penalty": 0.0,
            "quality_flags": [],
            "quality_score": 0,
        }

    # Get session info if not provided
    if session_info is None:
        from utils.session import get_session_info
        session_info = get_session_info()

    rejected = []
    flags = []
    total_penalty = 0.0
    layer_scores = {}

    # Layer 2 — Session/timing
    session_result = _check_session(asset_type, session_info)
    if not session_result["passed"]:
        rejected.append(session_result)
    else:
        if session_result.get("session_penalty", 0) > 0:
            total_penalty += session_result["session_penalty"]
            flags.append("Hors session optimale")
        layer_scores["session"] = 100 if session_result.get("in_optimal") else 70

    # Layer 3 — Liquidity gate
    liq_result = _check_liquidity(asset_type, liquidity_data)
    if not liq_result["passed"]:
        rejected.append(liq_result)
    else:
        score = liq_result.get("score")
        if score is not None:
            layer_scores["liquidity"] = min(100, int(score * 1.25))
            if score < 30:
                flags.append("Liquidité faible")

    # Layer 3b — Volume gate
    vol_result = _check_volume_gate(df, signal)
    if not vol_result["passed"]:
        rejected.append(vol_result)
    else:
        if vol_result.get("volume_penalty", 0) > 0:
            total_penalty += vol_result["volume_penalty"]
            flags.append(f"Volume {vol_result.get('vol_ratio', 0):.1f}x < {MIN_VOLUME_RATIO}x")
        vol_ratio = vol_result.get("vol_ratio", 1.0)
        layer_scores["volume"] = min(100, int(vol_ratio / MIN_VOLUME_RATIO * 70))

    # Layer 6 — Spread vs TP
    spread_result = _check_spread_vs_tp(asset_type, liquidity_data, entry, tp1)
    if not spread_result["passed"]:
        rejected.append(spread_result)
    else:
        spread_of_tp = spread_result.get("spread_of_tp", 0)
        if spread_of_tp > 0:
            layer_scores["spread"] = max(0, 100 - int(spread_of_tp * 3))

    # Composite quality score
    if layer_scores:
        quality_score = int(sum(layer_scores.values()) / len(layer_scores))
    else:
        quality_score = 50

    passed = len(rejected) == 0

    if not passed:
        for r in rejected:
            flags.append(r["reason"])

    return {
        "passed": passed,
        "rejected_layers": rejected,
        "confidence_penalty": min(total_penalty, 0.5),  # cap at 50%
        "quality_flags": flags,
        "quality_score": quality_score,
    }
