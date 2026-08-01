"""
Market Concept Layer — Phase A++
Transform asset-specific features into a universal cross-market concept vector.
Output keys (0-1 floats): trend, accumulation, expansion_energy, liquidity_pressure,
imbalance, stress.
"""
from typing import Optional
import numpy as np
import pandas as pd


def _safe(value, default=0.0):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return default
    return float(value)


def _trend_score(
    df: pd.DataFrame,
    pa: Optional[dict] = None,
    htf_regime: Optional[dict] = None,
    mtf_regime: Optional[dict] = None,
) -> float:
    """Trend strength & direction consistency, normalized 0-1."""
    close = df["close"]
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()
    last = len(df) - 1
    c = float(close.iloc[last])
    e20 = _safe(ema20.iloc[last])
    e50 = _safe(ema50.iloc[last])

    score = 0.5  # neutral
    if c > e20 > e50:
        score = 0.7 + 0.15 * min((c - e50) / (e50 or 1.0), 1.0)
    elif c < e20 < e50:
        score = 0.3 - 0.15 * min((e50 - c) / (e50 or 1.0), 1.0)
    else:
        # mixed
        score = 0.5

    # align with price action structure
    if pa:
        trend = pa.get("trend", "NEUTRAL")
        if trend == "BULLISH":
            score = max(score, 0.65)
        elif trend == "BEARISH":
            score = min(score, 0.35)

    # multi-timeframe regime
    htf = (htf_regime or {}).get("regime", "UNKNOWN")
    mtf = (mtf_regime or {}).get("regime", "UNKNOWN")
    if "BULL" in mtf:
        score = max(score, 0.6)
    if "BEAR" in mtf:
        score = min(score, 0.4)
    if htf == mtf and "BULL" in htf:
        score = max(score, 0.75)
    if htf == mtf and "BEAR" in htf:
        score = min(score, 0.25)

    return max(0.0, min(1.0, score))


def _accumulation_score(
    df: pd.DataFrame,
    asset_type: str,
    onchain_context: Optional[dict] = None,
) -> float:
    """
    Accumulation / absorption signature:
    - Range contraction + volume profile consistent
    - Crypto: exchange outflow / whale outflow
    - Forex: low variance + session overlap support
    """
    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df.get("volume", pd.Series(np.ones(len(df)), index=df.index))

    # volatility contraction
    atr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1).rolling(14).mean()

    if len(atr) < 20:
        return 0.5

    atr_current = _safe(atr.iloc[-1])
    atr_recent_max = _safe(atr.iloc[-20:].max())
    vol_current = _safe(volume.iloc[-1])
    vol_avg = _safe(volume.iloc[-20:].mean())

    contraction = 1.0 - min(1.0, atr_current / (atr_recent_max or 1.0))
    vol_consistency = 0.0
    if vol_avg > 0:
        vol_consistency = 1.0 - min(1.0, abs(vol_current - vol_avg) / vol_avg)

    score = 0.4 * contraction + 0.2 * vol_consistency + 0.4 * 0.5

    # on-chain accumulation signals
    adv = (onchain_context or {}).get("advanced") or {}
    netflow = adv.get("exchange_netflow") or {}
    whale = adv.get("whale_alert") or {}
    stable = adv.get("stablecoin_flow") or {}
    if asset_type == "CRYPTO":
        nf = netflow.get("netflow_1d", 0) or 0
        if nf < -500:  # outflow
            score += 0.15
        whale_out = whale.get("outflow_usd", 0) or 0
        whale_in = whale.get("inflow_usd", 0) or 0
        if whale_out > whale_in * 1.5 and whale_out > 50e6:
            score += 0.15
        stable_in = stable.get("netflow_1d", 0) or 0
        if stable_in > 100:
            score += 0.1

    return max(0.0, min(1.0, score))


def _expansion_energy(
    df: pd.DataFrame,
    regime: Optional[dict] = None,
) -> float:
    """Potential for a volatility expansion / breakout, normalized 0-1."""
    close = df["close"]
    high = df["high"]
    low = df["low"]

    atr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1).rolling(14).mean()
    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    bbw = (2 * bb_std) / bb_mid

    if len(atr) < 20 or len(bbw) < 20:
        return 0.5

    atr_current = _safe(atr.iloc[-1])
    atr_percentile = _safe((atr.iloc[-20:] <= atr_current).mean())
    bbw_current = _safe(bbw.iloc[-1])
    bbw_percentile = _safe((bbw.iloc[-20:] <= bbw_current).mean())

    # expansion energy = high percentile recent ATR + high percentile bandwidth
    score = 0.5 * atr_percentile + 0.5 * bbw_percentile

    # add squeeze bonus
    if bbw_current < 0.02:
        score = max(score, 0.7)

    # align with regime label
    reg = (regime or {}).get("regime", "UNKNOWN")
    if "VOLATILE" in reg or "EXHAUSTION" in reg:
        score = max(score, 0.75)

    return max(0.0, min(1.0, score))


def _liquidity_pressure(
    pa: Optional[dict] = None,
    smc: Optional[dict] = None,
    sr: Optional[dict] = None,
) -> float:
    """Proximity to structural liquidity / equal highs/lows, OB, 0-1."""
    score = 0.3

    if pa:
        bos = pa.get("bos", False)
        choch = pa.get("choch", False)
        bos_score = pa.get("bos_score", 0)
        if bos and bos_score >= 60:
            score += 0.25
        if choch:
            score += 0.15

    if smc:
        liq = smc.get("liquidity", {}) or {}
        if liq.get("near_eqh") or liq.get("near_eql"):
            score += 0.2
        ob = smc.get("ob", {}) or {}
        if ob.get("near_bullish_ob") or ob.get("near_bearish_ob"):
            score += 0.1

    if sr:
        zones = sr.get("supports", []) + sr.get("resistances", [])
        # if price near a clustered zone
        if zones and len([z for z in zones if z.get("strength", 0) > 3]) > 0:
            score += 0.1

    return max(0.0, min(1.0, score))


def _imbalance_score(
    df: pd.DataFrame,
    onchain_context: Optional[dict] = None,
) -> float:
    """Buyer vs seller pressure proxy, normalized 0-1."""
    close = df["close"]
    volume = df.get("volume", pd.Series(np.ones(len(df)), index=df.index))

    if len(close) < 20:
        return 0.5

    # price-position within recent range as a proxy for short-term momentum
    recent_low = _safe(close.iloc[-20:].min())
    recent_high = _safe(close.iloc[-20:].max())
    c = _safe(close.iloc[-1])
    range_ = recent_high - recent_low
    price_pos = 0.5 if range_ == 0 else (c - recent_low) / range_

    # volume skew: up-volume vs down-volume
    delta = close.diff()
    up_vol = volume.where(delta > 0, 0).iloc[-20:].sum()
    down_vol = volume.where(delta < 0, 0).iloc[-20:].sum()
    total_vol = up_vol + down_vol
    vol_skew = 0.5 if total_vol == 0 else up_vol / total_vol

    score = 0.5 * price_pos + 0.5 * vol_skew

    # on-chain imbalance
    adv = (onchain_context or {}).get("advanced") or {}
    nf = adv.get("exchange_netflow") or {}
    net_1d = nf.get("netflow_1d", 0) or 0
    if net_1d < -500:
        score += 0.1
    elif net_1d > 500:
        score -= 0.1

    return max(0.0, min(1.0, score))


def _stress_index(
    df: pd.DataFrame,
    regime: Optional[dict] = None,
    htf_regime: Optional[dict] = None,
    forex_context: Optional[dict] = None,
    onchain_context: Optional[dict] = None,
) -> float:
    """Composite market stress: volatility + regime disagreement + macro risk."""
    close = df["close"]
    high = df["high"]
    low = df["low"]

    atr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1).rolling(14).mean()
    if len(atr) < 20:
        return 0.5

    c = _safe(close.iloc[-1])

    # Use regime's atr_percentile (relative to the asset's own history) instead
    # of a fixed 3% absolute threshold that misclassifies Forex (always calm)
    # and Synthetic (always stressed).
    atr_percentile = _safe((regime or {}).get("atr_percentile"), 0.5)
    vol_stress = min(1.0, atr_percentile)

    # drawdown from recent high
    recent_high = _safe(close.iloc[-20:].max())
    drawdown = (recent_high - c) / recent_high if recent_high else 0
    dd_stress = min(1.0, max(0.0, drawdown * 5))

    score = max(vol_stress, dd_stress)

    # regime disagreement between MTF and HTF
    mtf = (regime or {}).get("regime", "UNKNOWN")
    htf = (htf_regime or {}).get("regime", "UNKNOWN")
    if mtf != htf and "UNKNOWN" not in (mtf, htf):
        score = min(1.0, score + 0.15)

    # macro / on-chain stress
    if forex_context and forex_context.get("macro_risk"):
        score = min(1.0, score + 0.25)
    adv = (onchain_context or {}).get("advanced") or {}
    whale = adv.get("whale_alert") or {}
    if whale.get("inflow_usd", 0) > 200e6:
        score = min(1.0, score + 0.15)

    return max(0.0, min(1.0, score))


def compute_market_concept_vector(
    symbol: str,
    df: pd.DataFrame,
    asset_type: str,
    regime: Optional[dict] = None,
    htf_regime: Optional[dict] = None,
    mtf_regime: Optional[dict] = None,
    pa: Optional[dict] = None,
    smc: Optional[dict] = None,
    sr: Optional[dict] = None,
    onchain_context: Optional[dict] = None,
    forex_context: Optional[dict] = None,
) -> dict:
    """
    Compute a universal market-state concept vector from any asset type.
    All values are normalized floats in [0, 1].
    """
    return {
        "trend": _trend_score(df, pa=pa, htf_regime=htf_regime, mtf_regime=mtf_regime),
        "accumulation": _accumulation_score(df, asset_type, onchain_context=onchain_context),
        "expansion_energy": _expansion_energy(df, regime=regime),
        "liquidity_pressure": _liquidity_pressure(pa=pa, smc=smc, sr=sr),
        "imbalance": _imbalance_score(df, onchain_context=onchain_context),
        "stress": _stress_index(df, regime=regime, htf_regime=htf_regime, forex_context=forex_context, onchain_context=onchain_context),
    }
