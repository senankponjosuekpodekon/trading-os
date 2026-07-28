"""
Tick stats router — statistical analysis for synthetic / Deriv indices.
Features: ATR rolling z-score, Bollinger Band width compression,
standard-deviation overextension, tick velocity/acceleration,
regime classification, simple Monte Carlo expected range.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
import numpy as np
import pandas as pd

router = APIRouter()


class TickAnalyzeRequest(BaseModel):
    ticks: List[float]
    symbol: str = "R_75"
    n_sims: int = 1000
    horizon: int = 20


def _compute_stats(close: pd.Series) -> dict:
    if len(close) < 30:
        return {"error": "need at least 30 ticks"}

    returns = close.pct_change().dropna()
    atr_7 = close.rolling(7).std().iloc[-1]
    atr_30 = close.rolling(30).std().iloc[-1]
    atr_90 = close.rolling(90).std().iloc[-1]

    z_atr_7 = float((atr_7 - close.rolling(7).std().iloc[-30:].mean()) / (close.rolling(7).std().iloc[-30:].std() or 1e-9))
    z_atr_30 = float((atr_30 - close.rolling(30).std().iloc[-90:].mean()) / (close.rolling(30).std().iloc[-90:].std() or 1e-9))

    mid = close.rolling(20).mean()
    sigma = close.rolling(20).std()
    bbw = (2 * sigma / mid).iloc[-1]
    bbw_hist = (2 * sigma / mid).iloc[-50:]
    bbw_z = float((bbw - bbw_hist.mean()) / (bbw_hist.std() or 1e-9))

    overextension = float(abs(close.iloc[-1] - mid.iloc[-1]) / (sigma.iloc[-1] or 1e-9))

    velocity = float(returns.iloc[-10:].abs().mean())
    velocity_prev = float(returns.iloc[-20:-10].abs().mean())
    acceleration = velocity - velocity_prev

    # Regime classification
    if overextension > 2.5:
        regime = "EXHAUSTION"
    elif bbw_z < -1.0:
        regime = "LOW_VOL"
    elif bbw_z > 1.0:
        regime = "EXPANSION"
    else:
        regime = "NORMAL"

    return {
        "atr_7": round(atr_7, 6),
        "atr_30": round(atr_30, 6),
        "atr_90": round(atr_90, 6),
        "atr_zscore_7": round(z_atr_7, 2),
        "atr_zscore_30": round(z_atr_30, 2),
        "bb_width": round(bbw, 6),
        "bb_width_zscore": round(bbw_z, 2),
        "std_overextension": round(overextension, 2),
        "tick_velocity": round(velocity, 6),
        "tick_acceleration": round(acceleration, 6),
        "regime": regime,
    }


def _monte_carlo_expected_range(close: pd.Series, n_sims: int = 1000, horizon: int = 20) -> dict:
    if len(close) < 2:
        return {"expected_low": None, "expected_high": None, "expected_range": None}
    returns = close.pct_change().dropna()
    mu = float(returns.mean())
    sigma = float(returns.std()) or 1e-9
    last = float(close.iloc[-1])
    sims = np.random.normal(mu, sigma, size=(n_sims, horizon))
    paths = last * np.exp(np.cumsum(sims, axis=1))
    low = float(np.percentile(paths[:, -1], 5))
    high = float(np.percentile(paths[:, -1], 95))
    return {
        "expected_low": round(low, 6),
        "expected_high": round(high, 6),
        "expected_range": round(abs(high - low), 6),
    }


@router.post("/tick-stats/analyze")
def analyze_ticks(req: TickAnalyzeRequest):
    close = pd.Series(req.ticks)
    stats = _compute_stats(close)
    if "error" in stats:
        return {"symbol": req.symbol, "error": stats["error"]}
    mc = _monte_carlo_expected_range(close, n_sims=req.n_sims, horizon=req.horizon)

    # Compression -> expansion probability heuristic
    compression_score = max(0.0, min(100.0, (-stats["bb_width_zscore"]) * 30 + max(0, -stats["tick_acceleration"] * 5000)))

    return {
        "symbol": req.symbol,
        "samples": len(req.ticks),
        **stats,
        "compression_to_expansion_prob": round(compression_score, 2),
        "monte_carlo": mc,
    }
