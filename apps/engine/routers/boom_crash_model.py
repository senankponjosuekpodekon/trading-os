"""
Boom / Crash event model.
Boom/Crash are synthetic indices with asymmetric rare spikes.
This module estimates the probability of a spike in the next N ticks/bars
using compression, tick velocity, ATR z-score and a simple Monte Carlo simulation.
"""
import pandas as pd
import numpy as np


def _rolling_atr(close: pd.Series, window: int = 14) -> pd.Series:
    return close.rolling(window).std()


def _compression_index(close: pd.Series, lookback: int = 50) -> float:
    """0..100; high value = tight recent range compared to history."""
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
    if len(close) < window + 2:
        return {"velocity": 0.0, "acceleration": 0.0}
    returns = close.pct_change().abs().dropna()
    vel = float(returns.iloc[-window:].mean())
    vel_prev = float(returns.iloc[-(window + 1):-1].mean())
    return {"velocity": round(vel, 6), "acceleration": round(vel - vel_prev, 6)}


def _spike_feature(close: pd.Series, direction: str, window: int = 50) -> float:
    """Return recent spike intensity (largest single move / ATR)."""
    if len(close) < window:
        return 0.0
    returns = close.pct_change().dropna()
    atr = _rolling_atr(close, 14).iloc[-1]
    if not atr or np.isnan(atr):
        return 0.0
    if direction == "boom":
        extreme = returns.max()
    else:
        extreme = abs(returns.min())
    return float(extreme / (atr / close.iloc[-1]))


def analyze_boom_crash(
    close: pd.Series,
    direction: str = "boom",
    horizon: int = 50,
    n_sims: int = 1000,
) -> dict:
    """
    Analyze a synthetic boom or crash index.
    direction: 'boom' (upward spike) or 'crash' (downward spike).
    """
    if len(close) < 50:
        return {
            "state": "INSUFFICIENT_DATA",
            "spike_probability": 0.0,
            "mean_reversion_prob": 0.0,
            "regime": "UNKNOWN",
        }

    returns = close.pct_change().dropna()
    compression = _compression_index(close)
    velocity = _tick_velocity(close)
    atr_series = _rolling_atr(close, 14)
    atr_z = float((atr_series.iloc[-1] - atr_series.iloc[-30:].mean()) / (atr_series.iloc[-30:].std() or 1e-9))

    # Spike probability: compression + acceleration predicts event
    base_prob = 10.0
    prob = base_prob + compression * 0.4 + velocity["acceleration"] * 2500 + max(0, -atr_z) * 5
    spike_prob = float(min(100.0, max(0.0, prob)))

    # Mean reversion after a spike
    last_return = float(returns.iloc[-1])
    return_std = float(returns.std() or 1e-9)
    z_last = last_return / return_std
    mr_prob = float(min(100.0, max(0.0, abs(z_last) * 20 - compression * 0.2)))

    if spike_prob > 60:
        state = "SPIKE_RISK"
    elif mr_prob > 60:
        state = "POST_SPIKE_MEAN_REVERSION"
    elif compression > 70:
        state = "COMPRESSION"
    else:
        state = "NEUTRAL"

    regime = "EXPANSION" if spike_prob > 60 else "COMPRESSION" if compression > 60 else "TREND"

    # Monte Carlo: expected max adverse excursion over horizon
    mu = float(returns.mean())
    sigma = float(returns.std()) or 1e-9
    last = float(close.iloc[-1])
    sims = np.random.normal(mu, sigma, size=(n_sims, horizon))
    paths = last * np.exp(np.cumsum(sims, axis=1))
    max_up = float(np.percentile(paths[:, -1] / last - 1, 95))
    max_down = float(np.percentile(paths[:, -1] / last - 1, 5))

    return {
        "state": state,
        "direction": direction,
        "spike_probability": round(spike_prob, 2),
        "mean_reversion_prob": round(mr_prob, 2),
        "regime": regime,
        "compression_index": round(compression, 2),
        "tick_velocity": velocity["velocity"],
        "tick_acceleration": velocity["acceleration"],
        "atr_zscore": round(atr_z, 2),
        "spike_intensity": round(_spike_feature(close, direction), 2),
        "expected_max_up_pct": round(max_up * 100, 3),
        "expected_max_down_pct": round(max_down * 100, 3),
        "monte_carlo_sims": n_sims,
    }
