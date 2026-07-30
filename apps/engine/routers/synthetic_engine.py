"""
Synthetic / Deriv Statistical Engine
Statistical analysis for synthetic indices (Volatility, Jump, Step).
No macro, no on-chain, no COT, no MVRV — pure tick/bars statistics.
"""
from fastapi import APIRouter
from typing import Literal
import pandas as pd
import numpy as np

from routers.deriv import _fetch_v75_candles, _mock_candles

router = APIRouter()


class WrongAssetTypeError(Exception):
    """Raised when a non-synthetic asset is passed to synthetic-only analysis."""
    pass


def _assert_synthetic(symbol: str):
    deriv = SYMBOL_TO_DERIV.get(symbol.upper())
    if not deriv:
        raise WrongAssetTypeError(f"'{symbol}' is not a synthetic asset")
    return deriv


def spike_features(close: pd.Series, threshold_pct: float = 0.01) -> dict:
    """
    Detect large single-bar moves (spikes) in a close price series.
    Returns count, average spike size, and time (bars) since last spike.
    """
    if len(close) < 2:
        return {"spikes": 0, "avg_size": 0.0, "time_since": None}
    returns = close.pct_change().abs().dropna()
    spikes = returns[returns >= threshold_pct]
    count = int(len(spikes))
    avg_size = float(spikes.mean()) if count > 0 else 0.0
    time_since = int(len(close) - 1 - spikes.index[-1]) if count > 0 else None
    return {
        "spikes": count,
        "avg_size": round(avg_size, 6),
        "time_since": time_since,
    }


def volatility_regime(close: pd.Series, category: str = "volatility") -> str:
    """
    Classify volatility regime for synthetic price series.
    """
    if len(close) < 30:
        return "INSUFFICIENT_DATA"
    atr = _rolling_atr(close, 14)
    atr_now = float(atr.iloc[-1])
    atr_mean = float(atr.iloc[-30:].mean())
    atr_std = float(atr.iloc[-30:].std()) or 1e-9
    z_atr = (atr_now - atr_mean) / atr_std

    bb_width = (close.rolling(20).std() * 4) / close.rolling(20).mean()
    bbw_now = float(bb_width.iloc[-1])
    bbw_mean = float(bb_width.iloc[-30:].mean())
    bbw_std = float(bb_width.iloc[-30:].std()) or 1e-9
    bbw_z = (bbw_now - bbw_mean) / bbw_std

    compression = _compression_score(close)

    returns = close.pct_change().dropna()
    returns_std = float(returns.std()) if len(returns) >= 30 else 0.0
    dynamic_threshold = max(0.01, 3 * returns_std) if returns_std > 0 else 0.01
    spikes = spike_features(close, threshold_pct=dynamic_threshold)
    spike_freq = spikes["spikes"] / max(len(close), 1)

    if z_atr > 1.5 or bbw_z > 1.5:
        return "VOL_EXPANSION"
    if spike_freq > 0.05:
        return "SPIKE_RISK"
    if (z_atr < -1.0 and bbw_z < -1.0) or compression > 70:
        return "LOW_VOL"
    return "NEUTRAL"


def autocorrelation(close: pd.Series, lag: int = 1) -> float:
    """Pearson autocorrelation of returns at the requested lag."""
    if len(close) < lag + 5:
        return 0.0
    returns = close.pct_change().dropna()
    if returns.std() == 0:
        return 0.0
    return float(returns.autocorr(lag=lag))


def entropy(close: pd.Series, bins: int = 20) -> float:
    """
    Shannon entropy of return distribution. Random walk → high entropy,
    strongly structured/trending series → lower entropy.
    """
    if len(close) < 3:
        return 0.0
    returns = close.pct_change().dropna()
    if returns.empty or returns.std() == 0:
        return 0.0
    hist, _ = np.histogram(returns, bins=bins, density=True)
    hist = hist[hist > 0]
    if hist.sum() == 0:
        return 0.0
    probs = hist / hist.sum()
    return float(-np.sum(probs * np.log2(probs)))


def distance_to_extreme(price: float, high: float) -> float:
    """Distance from current price to a recent high (negative = below)."""
    if high == 0:
        return 0.0
    return round((price - high) / high, 4)

DERIV_SYMBOLS = {
    "R_10": "volatility",
    "R_25": "volatility",
    "R_50": "volatility",
    "R_75": "volatility",
    "R_100": "volatility",
    "BOOM300": "boom_crash",
    "BOOM500": "boom_crash",
    "BOOM1000": "boom_crash",
    "CRASH300": "boom_crash",
    "CRASH500": "boom_crash",
    "CRASH1000": "boom_crash",
    "JD10": "jump",
    "JD25": "jump",
    "JD50": "jump",
    "JD75": "jump",
    "JD100": "jump",
    "STPRNG": "step",
}

SYMBOL_TO_DERIV = {
    "VIX10/USD": "R_10",
    "VIX25/USD": "R_25",
    "VIX50/USD": "R_50",
    "VIX75/USD": "R_75",
    "VIX100/USD": "R_100",
    "BOOM300/USD": "BOOM300",
    "BOOM500/USD": "BOOM500",
    "BOOM1000/USD": "BOOM1000",
    "CRASH300/USD": "CRASH300",
    "CRASH500/USD": "CRASH500",
    "CRASH1000/USD": "CRASH1000",
    "JUMP10/USD": "JD10",
    "JUMP25/USD": "JD25",
    "JUMP50/USD": "JD50",
    "JUMP75/USD": "JD75",
    "JUMP100/USD": "JD100",
}


def _rolling_atr(close: pd.Series, window: int = 14) -> pd.Series:
    # Proxy ATR using simple returns std * price
    return close.rolling(window).std()


def _compression_score(close: pd.Series, lookback: int = 50) -> float:
    """
    0-100 : compression relative to recent range.
    High = price is in a tight range compared to recent volatility.
    """
    if len(close) < lookback:
        return 50.0
    atr = _rolling_atr(close, 14)
    recent = atr.iloc[-5:].mean()
    historical = atr.iloc[-lookback:].mean()
    if not historical or np.isnan(historical):
        return 50.0
    ratio = recent / historical
    return float(min(100.0, max(0.0, (1.0 - ratio) * 100)))


def _tick_velocity(close: pd.Series, window: int = 14) -> dict:
    """Velocity = average absolute return per bar. Acceleration = change of velocity."""
    if len(close) < window + 2:
        return {"velocity": 0.0, "acceleration": 0.0}
    returns = close.pct_change().abs().dropna()
    vel = float(returns.iloc[-window:].mean())
    vel_prev = float(returns.iloc[-(window + 1):-1].mean())
    accel = vel - vel_prev
    return {"velocity": round(vel, 6), "acceleration": round(accel, 6)}


def _autocorrelation_tail(close: pd.Series, lag: int = 1) -> float:
    if len(close) < lag + 5:
        return 0.0
    returns = close.pct_change().dropna()
    if returns.std() == 0:
        return 0.0
    return float(returns.autocorr(lag=lag))


def _monte_carlo_range(close: pd.Series, n_sims: int = 1000, horizon: int = 20) -> dict:
    """Simple GBM-style Monte Carlo from historical returns."""
    if len(close) < 2:
        return {"p10": None, "p50": None, "p90": None}
    returns = close.pct_change().dropna()
    mu = float(returns.mean())
    sigma = float(returns.std()) or 1e-9
    last = float(close.iloc[-1])
    paths = last * np.exp(
        np.cumsum(np.random.normal(mu, sigma, size=(n_sims, horizon)), axis=1)
    )
    final = paths[:, -1]
    return {
        "p10": round(float(np.percentile(final, 10)), 6),
        "p50": round(float(np.percentile(final, 50)), 6),
        "p90": round(float(np.percentile(final, 90)), 6),
    }


def evaluate_synthetic_strategy(
    close: pd.Series,
    stats: dict,
    category: str = "volatility",
    strategy_rules: dict | None = None,
) -> dict:
    """
    Generate signal + entry/SL/TP for synthetic indices using statistical analysis.
    Does NOT use EMA/RSI/MACD — uses spike_probability, mean_reversion_prob,
    compression, Monte Carlo expected range instead.

    strategy_rules (optional): dict with min_confidence, min_dps, sl_atr_mult,
    tp1_atr_mult, tp2_atr_mult overrides.
    """
    rules = strategy_rules or {}
    min_confidence = rules.get("min_confidence", 55)
    min_dps = rules.get("min_dps", 50)
    sl_mult = rules.get("sl_atr_mult", 1.5)
    tp1_mult = rules.get("tp1_atr_mult", 1.5)
    tp2_mult = rules.get("tp2_atr_mult", 2.5)

    if len(close) < 30 or stats.get("state") == "UNKNOWN":
        return {
            "signal": "NEUTRAL",
            "confidence": 0,
            "score": 0,
            "reasons": ["insufficient data"],
            "entry_price": None,
            "stop_loss": None,
            "take_profit_1": None,
            "take_profit_2": None,
            "risk_reward": None,
            "dps": 0.0,
        }

    entry = round(float(close.iloc[-1]), 6)
    atr_val = float(_rolling_atr(close, 14).iloc[-1])
    if pd.isna(atr_val) or atr_val <= 0:
        atr_val = float(close.iloc[-20:].std()) or 0.0001

    spike_prob = stats.get("spike_probability", 0)
    mr_prob = stats.get("mean_reversion_prob", 0)
    compression = stats.get("compression_score", 50)
    state = stats.get("state", "NEUTRAL")
    regime = stats.get("regime", "NEUTRAL")
    mc = stats.get("monte_carlo") or {}
    caution = stats.get("caution", False)

    score = 0
    reasons = []
    signal = "NEUTRAL"

    # ── Mean reversion logic (volatility indices) ──
    if category in ("volatility", "jump"):
        if mr_prob > 60 and state == "MEAN_REVERTING":
            # Price overextended → expect reversion
            z_return = float(close.pct_change().dropna().iloc[-1])
            if z_return < 0:
                signal = "BUY"
                score = int(min(95, mr_prob))
                reasons.append(f"Mean reversion BUY (mr_prob={mr_prob:.1f}%, z_return={z_return:.4f})")
            else:
                signal = "SELL"
                score = int(min(95, mr_prob))
                reasons.append(f"Mean reversion SELL (mr_prob={mr_prob:.1f}%, z_return={z_return:.4f})")

        # Spike readiness → momentum signal
        elif spike_prob > 65 and state in ("EXPANSION_RISK", "SPIKE_READY"):
            velocity = stats.get("tick_acceleration", 0)
            if velocity > 0:
                signal = "BUY"
                score = int(min(85, spike_prob * 0.8))
                reasons.append(f"Spike momentum BUY (spike_prob={spike_prob:.1f}%, accel={velocity:.6f})")
            elif velocity < 0:
                signal = "SELL"
                score = int(min(85, spike_prob * 0.8))
                reasons.append(f"Spike momentum SELL (spike_prob={spike_prob:.1f}%, accel={velocity:.6f})")

    # ── Boom/Crash directional bias ──
    elif category == "boom_crash":
        # Boom = rare sharp up moves; Crash = rare sharp down moves
        # Strategy: stay flat except when spike probability is very high
        if spike_prob > 70 and state in ("SPIKE_READY", "EXPANSION_RISK"):
            # For boom symbols, bias BUY; for crash, bias SELL
            # The caller should set the direction via the symbol name
            reasons.append(f"Boom/Crash spike alert (spike_prob={spike_prob:.1f}%) — caution mode")
            # Don't generate a directional signal automatically — too risky
            # Let the caller decide based on the boom/cash direction

    # ── Step index — trending detection ──
    elif category == "step":
        velocity = stats.get("tick_velocity", 0)
        accel = stats.get("tick_acceleration", 0)
        if state == "TRENDING" and velocity > 0.001:
            if accel > 0:
                signal = "BUY"
                score = int(min(75, velocity * 50000))
                reasons.append(f"Step trending BUY (velocity={velocity:.6f}, accel={accel:.6f})")
            elif accel < 0:
                signal = "SELL"
                score = int(min(75, velocity * 50000))
                reasons.append(f"Step trending SELL (velocity={velocity:.6f}, accel={accel:.6f})")

    # ── Confidence & filters ──
    confidence = min(abs(score), 95) if signal != "NEUTRAL" else 0

    if confidence < min_confidence and signal != "NEUTRAL":
        reasons.append(f"Confidence {confidence}% < {min_confidence}% — filtered")
        signal = "NEUTRAL"
        confidence = 0

    if caution and signal != "NEUTRAL":
        reasons.append("Caution flag active — reducing confidence")
        confidence = int(confidence * 0.7)
        if confidence < min_confidence:
            signal = "NEUTRAL"
            confidence = 0

    # ── Price levels ──
    stop_loss = take_profit_1 = take_profit_2 = risk_reward = None

    if signal != "NEUTRAL" and entry and atr_val:
        # Use Monte Carlo p10/p90 as additional TP guidance
        mc_p10 = mc.get("p10")
        mc_p90 = mc.get("p90")

        if signal == "BUY":
            stop_loss = round(entry - atr_val * sl_mult, 6)
            take_profit_1 = round(entry + atr_val * tp1_mult, 6)
            take_profit_2 = round(entry + atr_val * tp2_mult, 6)
            # Refine TP1 with MC p90 if closer (more conservative)
            if mc_p90 and mc_p90 > entry:
                mc_tp = round(mc_p90, 6)
                if abs(mc_tp - entry) < abs(take_profit_1 - entry):
                    take_profit_1 = mc_tp
                    reasons.append(f"TP1 refined to MC p90={mc_tp}")
        elif signal == "SELL":
            stop_loss = round(entry + atr_val * sl_mult, 6)
            take_profit_1 = round(entry - atr_val * tp1_mult, 6)
            take_profit_2 = round(entry - atr_val * tp2_mult, 6)
            # Refine TP1 with MC p10 if closer
            if mc_p10 and mc_p10 < entry:
                mc_tp = round(mc_p10, 6)
                if abs(mc_tp - entry) < abs(take_profit_1 - entry):
                    take_profit_1 = mc_tp
                    reasons.append(f"TP1 refined to MC p10={mc_tp}")

        if stop_loss and take_profit_1 and abs(entry - stop_loss) > 0:
            risk_reward = round(abs(take_profit_1 - entry) / abs(entry - stop_loss), 2)

    # ── DPS proxy: confidence × risk_reward factor ──
    dps = 0.0
    if signal != "NEUTRAL" and risk_reward and risk_reward > 0:
        dps = round(min(95, confidence * min(risk_reward / 1.5, 1.5)), 2)
        if dps < min_dps:
            reasons.append(f"DPS {dps}% < {min_dps}% — filtered")
            signal = "NEUTRAL"
            confidence = 0

    return {
        "signal": signal,
        "confidence": confidence,
        "score": score,
        "reasons": reasons,
        "entry_price": entry if signal != "NEUTRAL" else None,
        "stop_loss": stop_loss,
        "take_profit_1": take_profit_1,
        "take_profit_2": take_profit_2,
        "risk_reward": risk_reward,
        "dps": dps,
        "trigger": "SYNTHETIC_STATISTICAL",
        "signal_pending": False,
        "invalidation": {},
    }


def analyze_synthetic(
    close: pd.Series,
    category: Literal["volatility", "jump", "step", "boom_crash"] = "volatility",
    n_sims: int = 1000,
) -> dict:
    """
    Statistical analysis for synthetic indices.
    Returns state, probabilities, regime, and expected range.
    """
    if len(close) < 30:
        return {
            "state": "UNKNOWN",
            "spike_probability": 0.0,
            "mean_reversion_prob": 0.0,
            "regime": "INSUFFICIENT_DATA",
            "last_price": float(close.iloc[-1]) if len(close) else None,
            "caution": False,
        }

    atr = _rolling_atr(close, 14)
    atr_now = float(atr.iloc[-1])
    atr_mean = float(atr.iloc[-30:].mean())
    atr_std = float(atr.iloc[-30:].std())
    z_atr = float((atr_now - atr_mean) / (atr_std or 1e-9))

    bb_width = (close.rolling(20).std() * 4) / close.rolling(20).mean()
    bbw_now = float(bb_width.iloc[-1])
    bbw_mean = float(bb_width.iloc[-30:].mean())
    bbw_std = float(bb_width.iloc[-30:].std())
    bbw_z = float((bbw_now - bbw_mean) / (bbw_std or 1e-9))

    compression = _compression_score(close)
    velocity = _tick_velocity(close)
    autocorr = _autocorrelation_tail(close, lag=1)

    # Regime classification
    if z_atr > 1.5:
        regime = "EXPANSION"
    elif z_atr < -1.0 and compression > 60:
        regime = "COMPRESSION"
    else:
        regime = "NEUTRAL"

    # Spike probability : high compression + rising velocity → expansion event likely
    spike_prob = float(min(100.0, max(0.0, compression * 0.5 + velocity["acceleration"] * 5000 + z_atr * 10)))

    # Mean reversion : overextension (3 sigma from mean) + negative autocorr
    returns = close.pct_change().dropna()
    z_return = float((returns.iloc[-1] - returns.mean()) / (returns.std() or 1e-9))
    mr_prob = float(min(100.0, max(0.0, abs(z_return) * 15 - compression * 0.3 + abs(autocorr) * 20)))

    if category == "jump":
        state = "SPIKE_READY" if spike_prob > 60 else "MEAN_REVERTING" if mr_prob > 60 else "NEUTRAL"
    elif category == "step":
        state = "TRENDING" if velocity["velocity"] > 0.001 and velocity["acceleration"] > 0 else "RANGING"
    else:
        # Volatility indices
        if spike_prob > 60:
            state = "EXPANSION_RISK"
        elif mr_prob > 60:
            state = "MEAN_REVERTING"
        else:
            state = "NEUTRAL"

    mc = _monte_carlo_range(close, n_sims=n_sims)
    caution = bool(regime == "EXPANSION" or spike_prob > 70)

    return {
        "state": state,
        "spike_probability": round(spike_prob, 2),
        "mean_reversion_prob": round(mr_prob, 2),
        "regime": regime,
        "compression_score": round(compression, 2),
        "atr_z": round(z_atr, 2),
        "bb_width_z": round(bbw_z, 2),
        "tick_velocity": velocity["velocity"],
        "tick_acceleration": velocity["acceleration"],
        "autocorr_lag1": round(autocorr, 3),
        "last_price": round(float(close.iloc[-1]), 6),
        "caution": caution,
        "expected_range": (
            [mc["p10"], mc["p90"]] if mc.get("p10") is not None else None
        ),
        "monte_carlo": mc,
    }


@router.get("/synthetic/analyze/{symbol}")
async def analyze_synthetic_symbol(symbol: str):
    """GET /synthetic/analyze/{symbol} → statistical state for synthetic indices."""
    upper_symbol = symbol.upper()
    deriv_sym = upper_symbol if upper_symbol in DERIV_SYMBOLS else SYMBOL_TO_DERIV.get(upper_symbol)
    if not deriv_sym:
        return {"symbol": symbol, "error": "unknown synthetic symbol"}

    candles = await _fetch_v75_candles(deriv_sym, count=100)
    source = "live"
    if not candles:
        candles = _mock_candles(deriv_sym, count=100)
        source = "mock"

    df = pd.DataFrame(candles, columns=["time", "open", "high", "low", "close"])
    close = df["close"].astype(float)
    category = DERIV_SYMBOLS[deriv_sym]
    stats = analyze_synthetic(close, category=category)
    return {
        "symbol": symbol,
        "deriv_symbol": deriv_sym,
        "category": category,
        "source": source,
        **stats,
    }
