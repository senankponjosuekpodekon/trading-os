"""
Predictive Features — Phase A/B
Heuristic predictors consumed by the Feature Factory and signal scoring.

- Compression → Expansion detector
- Liquidity Sweep predictor

All calculations are look-ahead free (only data up to the latest closed bar).
"""
from typing import Optional, Literal
import numpy as np
import pandas as pd

from routers.smc import detect_liquidity_zones


def _safe(value, default=None):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return default
    return value


def detect_compression_expansion(
    df: pd.DataFrame,
    lookback: int = 20,
    bb_width_low_threshold: float = 0.02,
    bb_width_high_threshold: float = 0.06,
) -> dict:
    """
    Detect volatility compression followed by expansion potential.
    Returns scores 0-1 and a predicted breakout direction based on latent momentum.
    """
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)

    if len(close) < lookback + 5:
        return {
            "compression_score": 0.0,
            "expansion_score": 0.0,
            "breakout_direction": "NEUTRAL",
            "squeeze_count": 0,
            "bb_width": None,
            "bb_width_percentile": 0.5,
            "atr_percentile": 0.5,
        }

    bb_mid = close.rolling(20).mean()
    bb_std = close.rolling(20).std()
    bb_width = (2 * bb_std) / bb_mid

    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = atr_raw.rolling(14).mean()

    bbw_current = _safe(bb_width.iloc[-1], 0.0)
    # Compare current width to the full available history (no lookahead)
    bbw_series = bb_width.dropna()
    bbw_percentile = 0.5
    if len(bbw_series) > 0:
        bbw_percentile = float((bbw_series <= bbw_current).mean())

    atr_current = _safe(atr.iloc[-1], 0.0)
    atr_series = atr.dropna()
    atr_percentile = 0.5
    if len(atr_series) > 0:
        atr_percentile = float((atr_series <= atr_current).mean())

    squeeze_count = int((bb_width.iloc[-lookback:] < bb_width_low_threshold).sum())

    # Compression: low BB width percentile and low ATR percentile
    compression_score = 1.0 - max(bbw_percentile, atr_percentile)
    compression_score = max(0.0, min(1.0, compression_score))

    # Expansion: high percentile + evidence of recent range expansion vs lookback
    expansion_score = 0.0
    if bbw_current > bb_width_high_threshold or bbw_percentile > 0.75 or atr_percentile > 0.75:
        expansion_score = max(bbw_percentile, atr_percentile)

    # Direction based on latent momentum: body direction + volume skew + position in recent range
    recent = close.iloc[-lookback:]
    position_in_range = 0.5
    rng = recent.max() - recent.min()
    if rng != 0:
        position_in_range = (close.iloc[-1] - recent.min()) / rng

    returns = close.diff().iloc[-5:]
    mom = float(returns.sum()) if len(returns) > 0 else 0.0

    direction = "NEUTRAL"
    if expansion_score > 0.3 or compression_score > 0.5:
        if mom > 0 and position_in_range > 0.55:
            direction = "BULL"
        elif mom < 0 and position_in_range < 0.45:
            direction = "BEAR"

    return {
        "compression_score": round(compression_score, 3),
        "expansion_score": round(expansion_score, 3),
        "breakout_direction": direction,
        "squeeze_count": squeeze_count,
        "bb_width": round(bbw_current, 6),
        "bb_width_percentile": round(bbw_percentile, 3),
        "atr_percentile": round(atr_percentile, 3),
    }


def detect_liquidity_sweep(
    df: pd.DataFrame,
    pa: Optional[dict] = None,
    lookback: int = 50,
    tolerance_pct: float = 0.002,
    proximity_pct: float = 0.005,
) -> dict:
    """
    Predict which equal high/low liquidity pool is most likely to be swept next.
    Looks for a recent wick beyond an EQH/EQL followed by a close back inside — fakeout signature.
    """
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)

    if len(close) < lookback:
        return {
            "near_eqh": None,
            "near_eql": None,
            "sweep_risk": 0.0,
            "sweep_direction": "NEUTRAL",
            "target_level": None,
            "distance_pct": None,
        }

    liquidity = detect_liquidity_zones(high, low, lookback=lookback, tolerance_pct=tolerance_pct)
    current = float(close.iloc[-1])

    near_eqh = liquidity.get("near_eqh")
    near_eql = liquidity.get("near_eql")

    sweep_direction = "NEUTRAL"
    target_level = None
    sweep_risk = 0.0

    # Detect fakeout beyond equal highs/lows in the last 3 bars
    eqh_levels = liquidity.get("equal_highs", [])
    eql_levels = liquidity.get("equal_lows", [])

    bull_fakeout = False
    for zone in eqh_levels:
        level = zone["price"]
        # wick above level then close below in last 3 bars
        if any(high.iloc[-3:].values > level * 1.001) and close.iloc[-1] < level:
            bull_fakeout = True
            target_level = level
            break

    bear_fakeout = False
    for zone in eql_levels:
        level = zone["price"]
        if any(low.iloc[-3:].values < level * 0.999) and close.iloc[-1] > level:
            bear_fakeout = True
            target_level = level
            break

    if bull_fakeout and near_eqh:
        sweep_direction = "BEAR"  # liquidity above was swept, likely reversal down
        sweep_risk = min(1.0, near_eqh["touches"] * 0.25 + 0.3)
    elif bear_fakeout and near_eql:
        sweep_direction = "BULL"
        sweep_risk = min(1.0, near_eql["touches"] * 0.25 + 0.3)
    else:
        # If price is close to a liquidity zone, estimate pending sweep risk
        if near_eqh:
            sweep_direction = "BULL"  # likely to run the equal highs
            target_level = near_eqh["price"]
            sweep_risk = min(1.0, near_eqh["touches"] * 0.25)
        elif near_eql:
            sweep_direction = "BEAR"
            target_level = near_eql["price"]
            sweep_risk = min(1.0, near_eql["touches"] * 0.25)

    # Align with structure if provided
    if pa:
        trend = pa.get("trend", "NEUTRAL")
        if trend == "BULLISH" and sweep_direction == "BULL":
            sweep_risk = min(1.0, sweep_risk + 0.2)
        elif trend == "BEARISH" and sweep_direction == "BEAR":
            sweep_risk = min(1.0, sweep_risk + 0.2)
        elif trend != "NEUTRAL" and sweep_direction != trend:
            sweep_risk = max(0.0, sweep_risk - 0.3)

    distance_pct = None
    if target_level and current != 0:
        distance_pct = round(abs(target_level - current) / current * 100, 4)

    return {
        "near_eqh": near_eqh,
        "near_eql": near_eql,
        "sweep_risk": round(sweep_risk, 3),
        "sweep_direction": sweep_direction,
        "target_level": target_level,
        "distance_pct": distance_pct,
    }


def _find_pivot_indices(series: pd.Series, order: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """Return arrays of swing high and swing low indices using a simple rolling window."""
    highs = series["high"].astype(float).values
    lows = series["low"].astype(float).values
    n = len(highs)
    if n < 2 * order + 1:
        return np.array([]), np.array([])

    high_idx = []
    low_idx = []
    for i in range(order, n - order):
        if highs[i] == max(highs[i - order : i + order + 1]):
            high_idx.append(i)
        if lows[i] == min(lows[i - order : i + order + 1]):
            low_idx.append(i)
    return np.array(high_idx), np.array(low_idx)


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Simple RSI without lookahead."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def detect_rsi_divergence(
    df: pd.DataFrame,
    lookback: int = 50,
    pivot_order: int = 3,
) -> dict:
    """
    Detect regular and hidden RSI divergences between price and RSI.
    Returns scores and direction flags (BULL/BEAR/NEUTRAL).
    """
    close = df["close"].astype(float)
    if len(close) < lookback + 5:
        return {
            "regular": "NEUTRAL",
            "hidden": "NEUTRAL",
            "combined_score": 0.0,
            "regular_score": 0.0,
            "hidden_score": 0.0,
        }

    rsi_series = _rsi(close, period=14)
    high_idx, low_idx = _find_pivot_indices(df.iloc[-lookback:], order=pivot_order)
    # Map local window indices to absolute dataframe indices
    offset = len(close) - lookback
    high_idx += offset
    low_idx += offset

    # Keep only valid pivots
    high_idx = high_idx[(high_idx >= 0) & (high_idx < len(close))]
    low_idx = low_idx[(low_idx >= 0) & (low_idx < len(close))]

    regular = "NEUTRAL"
    hidden = "NEUTRAL"
    regular_score = 0.0
    hidden_score = 0.0

    # Need at least two pivots to compare
    if len(high_idx) >= 2:
        # Regular bearish: price higher high, RSI lower high
        if close.iloc[high_idx[-1]] > close.iloc[high_idx[-2]] and rsi_series.iloc[high_idx[-1]] < rsi_series.iloc[high_idx[-2]]:
            regular = "BEAR"
            regular_score = 1.0
        # Hidden bearish: price lower high, RSI higher high
        elif close.iloc[high_idx[-1]] < close.iloc[high_idx[-2]] and rsi_series.iloc[high_idx[-1]] > rsi_series.iloc[high_idx[-2]]:
            hidden = "BEAR"
            hidden_score = 0.7

    if len(low_idx) >= 2:
        # Regular bullish: price lower low, RSI higher low
        if close.iloc[low_idx[-1]] < close.iloc[low_idx[-2]] and rsi_series.iloc[low_idx[-1]] > rsi_series.iloc[low_idx[-2]]:
            regular = "BULL"
            regular_score = 1.0
        # Hidden bullish: price higher low, RSI lower low
        elif close.iloc[low_idx[-1]] > close.iloc[low_idx[-2]] and rsi_series.iloc[low_idx[-1]] < rsi_series.iloc[low_idx[-2]]:
            hidden = "BULL"
            hidden_score = 0.7

    combined_score = max(regular_score, hidden_score)
    return {
        "regular": regular,
        "hidden": hidden,
        "combined_score": round(combined_score, 3),
        "regular_score": round(regular_score, 3),
        "hidden_score": round(hidden_score, 3),
    }


def detect_macd_divergence(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
    lookback: int = 50,
    pivot_order: int = 3,
) -> dict:
    """
    Detect regular MACD histogram divergences.
    Uses MACD histogram peaks/troughs vs price pivots.
    """
    close = df["close"].astype(float)
    if len(close) < slow + lookback:
        return {
            "regular": "NEUTRAL",
            "score": 0.0,
            "macd_line_last": None,
            "signal_line_last": None,
        }

    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line

    high_idx, low_idx = _find_pivot_indices(df.iloc[-lookback:], order=pivot_order)
    offset = len(close) - lookback
    high_idx += offset
    low_idx += offset
    high_idx = high_idx[(high_idx >= 0) & (high_idx < len(close))]
    low_idx = low_idx[(low_idx >= 0) & (low_idx < len(close))]

    regular = "NEUTRAL"
    score = 0.0

    if len(high_idx) >= 2:
        p1, p2 = high_idx[-2], high_idx[-1]
        if close.iloc[p2] > close.iloc[p1] and histogram.iloc[p2] < histogram.iloc[p1]:
            regular = "BEAR"
            score = 1.0

    if len(low_idx) >= 2:
        p1, p2 = low_idx[-2], low_idx[-1]
        if close.iloc[p2] < close.iloc[p1] and histogram.iloc[p2] > histogram.iloc[p1]:
            if regular == "BEAR":
                # Conflicting signals → neutralize
                regular = "NEUTRAL"
                score = 0.0
            else:
                regular = "BULL"
                score = 1.0

    return {
        "regular": regular,
        "score": round(score, 3),
        "macd_line_last": round(_safe(macd_line.iloc[-1]), 6),
        "signal_line_last": round(_safe(signal_line.iloc[-1]), 6),
        "histogram_last": round(_safe(histogram.iloc[-1]), 6),
    }


def detect_volume_anomaly(
    df: pd.DataFrame,
    lookback: int = 20,
    z_threshold: float = 2.0,
) -> dict:
    """
    Detect abnormal volume spikes relative to a rolling mean/std.
    Useful for identifying climax moves / confirmation / exhaustion.
    """
    if "volume" not in df.columns or len(df) < lookback:
        return {
            "volume_zscore": 0.0,
            "is_anomaly": False,
            "anomaly_direction": "NEUTRAL",
            "relative_volume": 1.0,
        }

    volume = df["volume"].astype(float)
    close = df["close"].astype(float)
    open_ = df["open"].astype(float) if "open" in df.columns else close

    rolling_mean = volume.rolling(lookback).mean()
    rolling_std = volume.rolling(lookback).std()
    last_vol = _safe(volume.iloc[-1], 0.0)
    mean = _safe(rolling_mean.iloc[-1], 0.0)
    std = _safe(rolling_std.iloc[-1], 0.0)

    zscore = 0.0
    relative_volume = 1.0
    if mean and mean > 0:
        relative_volume = last_vol / mean
        if std and std > 0:
            zscore = (last_vol - mean) / std

    is_anomaly = zscore > z_threshold
    direction = "NEUTRAL"
    if is_anomaly:
        direction = "BULL" if close.iloc[-1] >= open_.iloc[-1] else "BEAR"

    return {
        "volume_zscore": round(zscore, 3),
        "is_anomaly": bool(is_anomaly),
        "anomaly_direction": direction,
        "relative_volume": round(relative_volume, 3),
    }
