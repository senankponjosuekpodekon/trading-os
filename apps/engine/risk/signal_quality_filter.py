"""
Signal Quality Filter — multi-layer gate applied at signal generation time.

Layers (from filt.md architecture):
  1. Regime filter          — (already in scan.py via detect_regime)
  2. Session/timing filter  — block signals outside optimal session windows
  3. Liquidity gate         — hard reject if liquidity score < threshold
  4. MTF confluence         — (already in scan.py via mtf_context)
  5. Correlation filter     — (already in scan.py via smc/liquidity)
  6. Execution filter       — reject if spread > X% of TP distance
  7. Event freeze           — block signals near high-impact macro events
  8. Extreme regime         — block if ATR > 90th percentile (stand-aside)
  9. Wick/body ratio        — reject false breakouts (wick > 2x body)
 10. VWAP filter            — penalize signals against intraday VWAP
 11. CVD/OBV divergence     — reject price/volume divergence
 12. Seasonal cycles        — penalize known adverse seasonal patterns
 13. Funding rate gate      — crypto: reject extreme funding rates
 14. DXY macro gate         — gold: penalize when DXY momentum conflicts
 15. Volume normalization   — BRVM: per-symbol relative volume

Usage:
    from risk.signal_quality_filter import apply_quality_gate
    result = apply_quality_gate(signal, asset_type, symbol, entry, tp1, df,
                                session_info, liquidity_data, news_context,
                                regime, atr_value, onchain_context, dxy_data)
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
    "BRVM": 10.0,
    "US_STOCK": 40.0,
}

# ── Session windows by asset type (UTC hours) ───────────────────────
SESSION_WINDOWS = {
    "CRYPTO": None,
    "SYNTHETIC": None,
    "FOREX": {
        "optimal": [(7, 22)],
        "avoid": [(21, 22)],
        "weekend_block": True,
    },
    "GOLD": {
        "optimal": [(7, 22)],
        "avoid": [(0, 7)],
        "weekend_block": True,
    },
    "COMMODITY": {
        "optimal": [(7, 22)],
        "avoid": [(21, 22)],
        "weekend_block": True,
    },
    "US_STOCK": {
        "optimal": [(14, 21)],
        "avoid": [(0, 14), (21, 24)],
        "weekend_block": True,
    },
    "BRVM": {
        "optimal": [(9, 15)],
        "avoid": [(0, 9), (15, 24)],
        "weekend_block": True,
    },
}

MIN_VOLUME_RATIO = 1.3
MAX_SPREAD_PCT_OF_TP = 15.0
EXTREME_ATR_PERCENTILE = 90.0
MAX_WICK_BODY_RATIO = 2.0
EXTREME_FUNDING_RATE = 0.1
DXY_CONFLICT_THRESHOLD = 0.3
DIVERGENCE_LOOKBACK = 20

# ── Seasonal patterns: (month, day_start, day_end, asset_types, desc, penalty) ─
SEASONAL_PATTERNS = [
    (1, 1, 5, None, "January effect — early month volatility", 0.05),
    (3, 14, 20, None, "Mid-March — quarter-end rebalancing", 0.05),
    (6, 25, 30, None, "Quarter-end window dressing", 0.05),
    (9, 14, 20, None, "Quad witching / quarter-end", 0.08),
    (12, 24, 31, None, "Holiday low liquidity", 0.10),
    (12, 31, 31, ["FOREX", "GOLD", "COMMODITY"], "New Year Eve — thin book", 0.15),
]


def _is_in_window(hour: int, windows: list[tuple[int, int]]) -> bool:
    for start, end in windows:
        if start <= end:
            if start <= hour < end:
                return True
        else:
            if hour >= start or hour < end:
                return True
    return False


# ════════════════════════════════════════════════════════════════════
# LAYER 2 — Session/timing filter
# ════════════════════════════════════════════════════════════════════
def _check_session(asset_type: str, session_info: dict) -> dict:
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
        "passed": True, "reason": None, "layer": "session",
        "in_optimal": in_optimal,
        "session_penalty": 0.0 if in_optimal else 0.15,
    }


# ════════════════════════════════════════════════════════════════════
# LAYER 3 — Liquidity gate
# ════════════════════════════════════════════════════════════════════
def _check_liquidity(asset_type: str, liquidity_data: Optional[dict]) -> dict:
    if not liquidity_data:
        return {"passed": True, "reason": None, "layer": "liquidity", "score": None}

    score = liquidity_data.get("score", 50.0)
    min_score = MIN_LIQUIDITY_SCORE.get(asset_type, 20.0)

    if score < min_score:
        return {
            "passed": False,
            "reason": f"Liquidity score {score:.1f} < {min_score} — signal rejected",
            "layer": "liquidity", "score": score,
        }

    return {"passed": True, "reason": None, "layer": "liquidity", "score": score}


# ════════════════════════════════════════════════════════════════════
# LAYER 3b — Volume gate (with BRVM per-symbol normalization)
# ════════════════════════════════════════════════════════════════════
def _check_volume_gate(df, signal: str, asset_type: str = "", symbol: str = "") -> dict:
    if df is None or "volume" not in df.columns or len(df) < 20:
        return {"passed": True, "reason": None, "layer": "volume"}

    try:
        recent_vol = float(df["volume"].iloc[-1])
        avg_vol = float(df["volume"].iloc[-20:].mean())
        if avg_vol <= 0:
            return {"passed": True, "reason": None, "layer": "volume"}

        vol_ratio = recent_vol / avg_vol

        # BRVM: structurally thin volume — use per-symbol 50-period avg
        min_ratio = 0.5
        target_ratio = MIN_VOLUME_RATIO
        if asset_type == "BRVM":
            min_ratio = 0.3
            target_ratio = 0.8
            if len(df) >= 50:
                avg_vol_50 = float(df["volume"].iloc[-50:].mean())
                if avg_vol_50 > 0:
                    vol_ratio = recent_vol / avg_vol_50

        if vol_ratio < min_ratio:
            return {
                "passed": False,
                "reason": f"Volume ratio {vol_ratio:.2f} < {min_ratio} — insufficient conviction",
                "layer": "volume", "vol_ratio": vol_ratio,
            }

        penalty = 0.0
        if vol_ratio < target_ratio:
            penalty = (target_ratio - vol_ratio) * 0.3

        return {
            "passed": True, "reason": None, "layer": "volume",
            "vol_ratio": vol_ratio, "volume_penalty": penalty,
        }
    except Exception:
        return {"passed": True, "reason": None, "layer": "volume"}


# ════════════════════════════════════════════════════════════════════
# LAYER 6 — Spread/slippage filter
# ════════════════════════════════════════════════════════════════════
def _check_spread_vs_tp(asset_type: str, liquidity_data: Optional[dict],
                        entry: Optional[float], tp1: Optional[float]) -> dict:
    if not liquidity_data or entry is None or tp1 is None:
        return {"passed": True, "reason": None, "layer": "spread"}
    if asset_type != "CRYPTO":
        return {"passed": True, "reason": None, "layer": "spread"}

    spread_score = liquidity_data.get("spread_score", 15.0)
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
            "layer": "spread", "spread_pct": spread_pct, "spread_of_tp": spread_of_tp,
        }

    return {"passed": True, "reason": None, "layer": "spread",
            "spread_pct": spread_pct, "spread_of_tp": spread_of_tp}


# ════════════════════════════════════════════════════════════════════
# LAYER 7 — Event freeze (news filter unification)
# ════════════════════════════════════════════════════════════════════
def _check_event_freeze(news_context: Optional[dict]) -> dict:
    if not news_context:
        return {"passed": True, "reason": None, "layer": "event_freeze"}

    macro_risk = news_context.get("macro_risk", False)
    post_news = news_context.get("post_news_volatility", False)

    if macro_risk:
        next_event = news_context.get("next_event", {})
        ev_title = next_event.get("title", "unknown") if isinstance(next_event, dict) else "unknown"
        return {
            "passed": False,
            "reason": f"Event freeze — high-impact event imminent ({ev_title})",
            "layer": "event_freeze",
        }

    if post_news:
        return {
            "passed": True, "reason": None, "layer": "event_freeze",
            "post_news_penalty": 0.10,
        }

    return {"passed": True, "reason": None, "layer": "event_freeze"}


# ════════════════════════════════════════════════════════════════════
# LAYER 8 — Extreme regime (ATR > 90th percentile → stand-aside)
# ════════════════════════════════════════════════════════════════════
def _check_extreme_regime(df, atr_value: Optional[float], regime: Optional[dict]) -> dict:
    if df is None or len(df) < 100:
        return {"passed": True, "reason": None, "layer": "extreme_regime"}

    try:
        closes = df["close"].astype(float)
        changes = closes.pct_change().abs() * 100
        if len(changes) < 100:
            return {"passed": True, "reason": None, "layer": "extreme_regime"}

        current_change = float(changes.iloc[-1])
        percentile_90 = float(changes.iloc[-100:].quantile(0.90))

        if current_change > percentile_90 and percentile_90 > 0:
            regime_name = regime.get("regime", "") if regime else ""
            if regime_name == "VOLATILE":
                return {
                    "passed": False,
                    "reason": f"Extreme volatility — move {current_change:.2f}% > 90th pct {percentile_90:.2f}% — stand-aside",
                    "layer": "extreme_regime", "atr_percentile": 90,
                }
            return {
                "passed": True, "reason": None, "layer": "extreme_regime",
                "extreme_penalty": 0.20,
            }
    except Exception:
        pass

    return {"passed": True, "reason": None, "layer": "extreme_regime"}


# ════════════════════════════════════════════════════════════════════
# LAYER 9 — Wick/body ratio (false breakout detection)
# ════════════════════════════════════════════════════════════════════
def _check_wick_body(df, signal: str) -> dict:
    if df is None or len(df) < 1:
        return {"passed": True, "reason": None, "layer": "wick_body"}

    try:
        open_v = float(df["open"].iloc[-1])
        close_v = float(df["close"].iloc[-1])
        high_v = float(df["high"].iloc[-1])
        low_v = float(df["low"].iloc[-1])

        body = abs(close_v - open_v)
        if body <= 0:
            return {"passed": True, "reason": None, "layer": "wick_body"}

        upper_wick = high_v - max(open_v, close_v)
        lower_wick = min(open_v, close_v) - low_v

        if signal == "BUY" and upper_wick > body * MAX_WICK_BODY_RATIO:
            return {
                "passed": False,
                "reason": f"False breakout — upper wick {upper_wick:.6f} > {MAX_WICK_BODY_RATIO}x body {body:.6f}",
                "layer": "wick_body",
            }
        if signal == "SELL" and lower_wick > body * MAX_WICK_BODY_RATIO:
            return {
                "passed": False,
                "reason": f"False breakout — lower wick {lower_wick:.6f} > {MAX_WICK_BODY_RATIO}x body {body:.6f}",
                "layer": "wick_body",
            }

        max_wick = max(upper_wick, lower_wick)
        wick_ratio = max_wick / body
        if wick_ratio > 1.0:
            return {
                "passed": True, "reason": None, "layer": "wick_body",
                "wick_penalty": min(0.10, (wick_ratio - 1.0) * 0.05),
            }
    except Exception:
        pass

    return {"passed": True, "reason": None, "layer": "wick_body"}


# ════════════════════════════════════════════════════════════════════
# LAYER 10 — VWAP filter (penalize signals against intraday VWAP)
# ════════════════════════════════════════════════════════════════════
def _check_vwap(df, signal: str, entry: Optional[float]) -> dict:
    if df is None or len(df) < 20 or entry is None:
        return {"passed": True, "reason": None, "layer": "vwap"}
    if "high" not in df.columns or "low" not in df.columns or "volume" not in df.columns:
        return {"passed": True, "reason": None, "layer": "vwap"}

    try:
        typical_price = (df["high"].astype(float) + df["low"].astype(float) + df["close"].astype(float)) / 3
        vol = df["volume"].astype(float)
        cum_tp_vol = (typical_price * vol).rolling(20).sum()
        cum_vol = vol.rolling(20).sum()
        vwap = cum_tp_vol / cum_vol
        current_vwap = float(vwap.iloc[-1])
        if current_vwap <= 0:
            return {"passed": True, "reason": None, "layer": "vwap"}

        deviation_pct = ((entry - current_vwap) / current_vwap) * 100

        if signal == "BUY" and deviation_pct > 1.0:
            return {
                "passed": True, "reason": None, "layer": "vwap",
                "vwap_penalty": min(0.10, deviation_pct * 0.02),
            }
        if signal == "SELL" and deviation_pct < -1.0:
            return {
                "passed": True, "reason": None, "layer": "vwap",
                "vwap_penalty": min(0.10, abs(deviation_pct) * 0.02),
            }

        return {"passed": True, "reason": None, "layer": "vwap", "vwap": current_vwap}
    except Exception:
        return {"passed": True, "reason": None, "layer": "vwap"}


# ════════════════════════════════════════════════════════════════════
# LAYER 11 — CVD/OBV divergence detection
# ════════════════════════════════════════════════════════════════════
def _check_cvd_obv_divergence(df, signal: str) -> dict:
    if df is None or "volume" not in df.columns or len(df) < DIVERGENCE_LOOKBACK:
        return {"passed": True, "reason": None, "layer": "divergence"}

    try:
        close = df["close"].astype(float)
        vol = df["volume"].astype(float)
        n = DIVERGENCE_LOOKBACK

        direction = close.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
        obv = (direction * vol).cumsum()
        obv_recent = obv.iloc[-n:]
        obv_slope = float(obv_recent.iloc[-1] - obv_recent.iloc[0])

        price_recent = close.iloc[-n:]
        price_slope = float(price_recent.iloc[-1] - price_recent.iloc[0])

        price_up = price_slope > 0
        obv_up = obv_slope > 0

        if signal == "BUY" and not price_up and not obv_up:
            return {
                "passed": True, "reason": None, "layer": "divergence",
                "divergence_penalty": 0.10,
            }
        if signal == "SELL" and price_up and obv_up:
            return {
                "passed": True, "reason": None, "layer": "divergence",
                "divergence_penalty": 0.10,
            }

        if signal == "BUY" and price_up and not obv_up:
            return {
                "passed": False,
                "reason": "Bearish CVD divergence — price rising but volume declining",
                "layer": "divergence",
            }
        if signal == "SELL" and not price_up and obv_up:
            return {
                "passed": False,
                "reason": "Bullish CVD divergence — price falling but volume accumulating",
                "layer": "divergence",
            }

        return {"passed": True, "reason": None, "layer": "divergence"}
    except Exception:
        return {"passed": True, "reason": None, "layer": "divergence"}


# ════════════════════════════════════════════════════════════════════
# LAYER 12 — Seasonal cycles
# ════════════════════════════════════════════════════════════════════
def _check_seasonal(asset_type: str, now: Optional[datetime] = None) -> dict:
    if now is None:
        now = datetime.now(timezone.utc)

    month = now.month
    day = now.day
    total_penalty = 0.0
    flags = []

    for pat_month, day_start, day_end, asset_types, desc, penalty in SEASONAL_PATTERNS:
        if pat_month != month:
            continue
        if not (day_start <= day <= day_end):
            continue
        if asset_types is not None and asset_type not in asset_types:
            continue
        total_penalty += penalty
        flags.append(desc)

    return {
        "passed": True, "reason": None, "layer": "seasonal",
        "seasonal_penalty": min(total_penalty, 0.20),
        "seasonal_flags": flags,
    }


# ════════════════════════════════════════════════════════════════════
# LAYER 13 — Funding rate gate (crypto)
# ════════════════════════════════════════════════════════════════════
def _check_funding_rate(asset_type: str, onchain_context: Optional[dict], signal: str) -> dict:
    if asset_type != "CRYPTO" or not onchain_context:
        return {"passed": True, "reason": None, "layer": "funding"}

    funding = onchain_context.get("funding_rate") or {}
    if isinstance(funding, dict):
        rate = funding.get("funding_rate")
    else:
        rate = None

    if rate is None:
        return {"passed": True, "reason": None, "layer": "funding"}

    try:
        rate_val = float(rate)
    except (TypeError, ValueError):
        return {"passed": True, "reason": None, "layer": "funding"}

    if rate_val > EXTREME_FUNDING_RATE and signal == "BUY":
        return {
            "passed": False,
            "reason": f"Extreme funding rate {rate_val:.4f}% — crowded long, squeeze risk",
            "layer": "funding",
        }
    if rate_val < -EXTREME_FUNDING_RATE and signal == "SELL":
        return {
            "passed": False,
            "reason": f"Extreme negative funding {rate_val:.4f}% — crowded short, squeeze risk",
            "layer": "funding",
        }

    if abs(rate_val) > EXTREME_FUNDING_RATE * 0.5:
        return {
            "passed": True, "reason": None, "layer": "funding",
            "funding_penalty": min(0.08, abs(rate_val) * 0.02),
        }

    return {"passed": True, "reason": None, "layer": "funding"}


# ════════════════════════════════════════════════════════════════════
# LAYER 14 — DXY macro gate (gold)
# ════════════════════════════════════════════════════════════════════
def _check_dxy_macro(asset_type: str, dxy_data: Optional[dict], signal: str) -> dict:
    if asset_type != "GOLD" or not dxy_data:
        return {"passed": True, "reason": None, "layer": "dxy_macro"}

    try:
        momentum = float(dxy_data.get("momentum", 0) or dxy_data.get("change_pct", 0) or 0)
    except (TypeError, ValueError):
        return {"passed": True, "reason": None, "layer": "dxy_macro"}

    if momentum > DXY_CONFLICT_THRESHOLD and signal == "BUY":
        return {
            "passed": True, "reason": None, "layer": "dxy_macro",
            "dxy_penalty": min(0.15, momentum * 0.05),
        }
    if momentum < -DXY_CONFLICT_THRESHOLD and signal == "SELL":
        return {
            "passed": True, "reason": None, "layer": "dxy_macro",
            "dxy_penalty": min(0.15, abs(momentum) * 0.05),
        }

    return {"passed": True, "reason": None, "layer": "dxy_macro"}


# ════════════════════════════════════════════════════════════════════
# MAIN — apply_quality_gate
# ════════════════════════════════════════════════════════════════════
def apply_quality_gate(
    signal: str,
    asset_type: str,
    symbol: str,
    entry: Optional[float] = None,
    tp1: Optional[float] = None,
    df=None,
    session_info: Optional[dict] = None,
    liquidity_data: Optional[dict] = None,
    news_context: Optional[dict] = None,
    regime: Optional[dict] = None,
    atr_value: Optional[float] = None,
    onchain_context: Optional[dict] = None,
    dxy_data: Optional[dict] = None,
) -> dict:
    """
    Apply the multi-layer quality gate to a signal.

    Returns:
        {
            "passed": bool,
            "rejected_layers": list,
            "confidence_penalty": float,  — total penalty (0-1)
            "quality_flags": list,
            "quality_score": int,         — 0-100 composite
        }
    """
    if signal == "NEUTRAL":
        return {
            "passed": True, "rejected_layers": [],
            "confidence_penalty": 0.0, "quality_flags": [], "quality_score": 0,
        }

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

    # Layer 3b — Volume gate (with BRVM normalization)
    vol_result = _check_volume_gate(df, signal, asset_type, symbol)
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

    # Layer 7 — Event freeze
    event_result = _check_event_freeze(news_context)
    if not event_result["passed"]:
        rejected.append(event_result)
    else:
        if event_result.get("post_news_penalty", 0) > 0:
            total_penalty += event_result["post_news_penalty"]
            flags.append("Post-news volatility")
        layer_scores["event_freeze"] = 80

    # Layer 8 — Extreme regime
    extreme_result = _check_extreme_regime(df, atr_value, regime)
    if not extreme_result["passed"]:
        rejected.append(extreme_result)
    else:
        if extreme_result.get("extreme_penalty", 0) > 0:
            total_penalty += extreme_result["extreme_penalty"]
            flags.append("Volatilité extrême (pénalité)")
        layer_scores["extreme_regime"] = 60 if extreme_result.get("extreme_penalty") else 100

    # Layer 9 — Wick/body ratio
    wick_result = _check_wick_body(df, signal)
    if not wick_result["passed"]:
        rejected.append(wick_result)
    else:
        if wick_result.get("wick_penalty", 0) > 0:
            total_penalty += wick_result["wick_penalty"]
            flags.append("Wick importante")
        layer_scores["wick_body"] = 100 - int(wick_result.get("wick_penalty", 0) * 200)

    # Layer 10 — VWAP
    vwap_result = _check_vwap(df, signal, entry)
    if not vwap_result["passed"]:
        rejected.append(vwap_result)
    else:
        if vwap_result.get("vwap_penalty", 0) > 0:
            total_penalty += vwap_result["vwap_penalty"]
            flags.append("Prix éloigné du VWAP")
        layer_scores["vwap"] = 100 - int(vwap_result.get("vwap_penalty", 0) * 200)

    # Layer 11 — CVD/OBV divergence
    div_result = _check_cvd_obv_divergence(df, signal)
    if not div_result["passed"]:
        rejected.append(div_result)
    else:
        if div_result.get("divergence_penalty", 0) > 0:
            total_penalty += div_result["divergence_penalty"]
            flags.append("Divergence prix/volume")
        layer_scores["divergence"] = 100 - int(div_result.get("divergence_penalty", 0) * 200)

    # Layer 12 — Seasonal cycles
    seasonal_result = _check_seasonal(asset_type)
    if seasonal_result.get("seasonal_penalty", 0) > 0:
        total_penalty += seasonal_result["seasonal_penalty"]
        flags.extend(seasonal_result.get("seasonal_flags", []))
    layer_scores["seasonal"] = 100 - int(seasonal_result.get("seasonal_penalty", 0) * 200)

    # Layer 13 — Funding rate (crypto)
    funding_result = _check_funding_rate(asset_type, onchain_context, signal)
    if not funding_result["passed"]:
        rejected.append(funding_result)
    else:
        if funding_result.get("funding_penalty", 0) > 0:
            total_penalty += funding_result["funding_penalty"]
            flags.append("Funding rate élevé")
        layer_scores["funding"] = 100 - int(funding_result.get("funding_penalty", 0) * 200)

    # Layer 14 — DXY macro (gold)
    dxy_result = _check_dxy_macro(asset_type, dxy_data, signal)
    if not dxy_result["passed"]:
        rejected.append(dxy_result)
    else:
        if dxy_result.get("dxy_penalty", 0) > 0:
            total_penalty += dxy_result["dxy_penalty"]
            flags.append("DXY en conflit avec signal")
        layer_scores["dxy_macro"] = 100 - int(dxy_result.get("dxy_penalty", 0) * 200)

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
        "confidence_penalty": min(total_penalty, 0.5),
        "quality_flags": flags,
        "quality_score": quality_score,
    }


# ════════════════════════════════════════════════════════════════════
# SIZING — quality-based position sizing multiplier
# ════════════════════════════════════════════════════════════════════
def get_quality_size_multiplier(quality_score: int) -> float:
    """
    Return position size multiplier based on quality score.

    Q >= 80 → 1.0x (full size)
    Q 60-79 → 0.75x
    Q 40-59 → 0.50x
    Q < 40  → 0.25x
    """
    if quality_score >= 80:
        return 1.0
    if quality_score >= 60:
        return 0.75
    if quality_score >= 40:
        return 0.50
    return 0.25
