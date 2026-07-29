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
