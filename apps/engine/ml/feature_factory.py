"""
Feature Factory — Phase B ML foundation
Centralise tous les niveaux de features utilisés par le moteur, le backtest,
le scoring et le Market Memory.

Niveaux:
  1. Raw : OHLCV + spread/bid/ask si disponibles
  2. Calculées : ratios de corps/mèches, ATR percentile, log returns
  3. Structurelles : BOS, CHoCH, FVG, OB, liquidité, régime ADX
  4. Contextuelles : session, minutes depuis ouverture, day-of-week, news distance
  5. Meta : confluence, maturité tendance, fatigue, concept vector

Toutes les features sont calculées sans look-ahead (données disponibles à T).
"""
from typing import Optional
from datetime import datetime, timezone
import numpy as np
import pandas as pd

from routers.indicators import ema, rsi, macd, bollinger_bands, atr
from routers.price_action import detect_market_structure
from routers.smc import analyze_smc
from routers.regime import detect_regime
from utils.session import get_session_info
from features.market_concept_layer import compute_market_concept_vector
from ml.predictive_features import (
    detect_compression_expansion,
    detect_liquidity_sweep,
    detect_rsi_divergence,
    detect_macd_divergence,
    detect_volume_anomaly,
)


def _safe(value, default=None):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return default
    return value


def _compute_level1(df: pd.DataFrame) -> dict:
    """Raw features from the latest candle."""
    last = len(df) - 1
    row = df.iloc[last]
    return {
        "open": float(row.get("open", 0)),
        "high": float(row.get("high", 0)),
        "low": float(row.get("low", 0)),
        "close": float(row.get("close", 0)),
        "volume": float(row.get("volume", 0)),
        "spread": float(row.get("spread", 0)) if "spread" in df else None,
        "bid": float(row.get("bid", 0)) if "bid" in df else None,
        "ask": float(row.get("ask", 0)) if "ask" in df else None,
    }


def _compute_level2(df: pd.DataFrame) -> dict:
    """Calculated candle / volatility features."""
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    open_ = df["open"].astype(float)

    body = (close - open_).abs()
    range_ = high - low
    upper_wick = high - close.where(close >= open_, open_)
    lower_wick = close.where(close <= open_, open_) - low

    log_ret = np.log(close / close.shift(1))

    a14 = atr(high, low, close, 14)
    atr_current = _safe(a14.iloc[-1])
    atr_pct_series = (a14 / close * 100).dropna()
    atr_percentile = 0.5
    if len(atr_pct_series) >= 20:
        atr_percentile = float((atr_pct_series <= atr_pct_series.iloc[-1]).mean())

    vol_sma20 = df["volume"].rolling(20).mean()
    volume_ratio = _safe(df["volume"].iloc[-1] / vol_sma20.iloc[-1]) if vol_sma20.iloc[-1] > 0 else None

    return {
        "body_ratio": _safe((body.iloc[-1] / range_.iloc[-1])) if range_.iloc[-1] > 0 else 0.0,
        "upper_wick_ratio": _safe((upper_wick.iloc[-1] / range_.iloc[-1])) if range_.iloc[-1] > 0 else 0.0,
        "lower_wick_ratio": _safe((lower_wick.iloc[-1] / range_.iloc[-1])) if range_.iloc[-1] > 0 else 0.0,
        "log_return_1": _safe(log_ret.iloc[-1]),
        "log_return_5": _safe(log_ret.iloc[-5:].sum()),
        "realized_vol_20": _safe(log_ret.iloc[-20:].std() * np.sqrt(252)),
        "atr_14": atr_current,
        "atr_percentile": atr_percentile,
        "volume_ratio_20": volume_ratio,
    }


def _compute_level3(df: pd.DataFrame) -> dict:
    """Technical and structural features."""
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    open_ = df["open"].astype(float)
    volume = df.get("volume")

    # Technicals
    e20 = ema(close, 20)
    e50 = ema(close, 50)
    e200 = ema(close, 200) if len(close) >= 200 else None
    rsi14 = rsi(close, 14)
    macd_line, macd_signal, macd_hist = macd(close)
    bb_upper, bb_mid, bb_lower = bollinger_bands(close)
    a14 = atr(high, low, close, 14)

    ema_bullish = False
    if e200 is not None:
        ema_bullish = bool(e20.iloc[-1] > e50.iloc[-1] > e200.iloc[-1])

    bb_width = 0.0
    if bb_mid.iloc[-1] and bb_mid.iloc[-1] != 0:
        bb_width = float((bb_upper.iloc[-1] - bb_lower.iloc[-1]) / bb_mid.iloc[-1])

    # Structure & SMC
    pa = detect_market_structure(high, low, close, volume=volume)
    smc = analyze_smc(open_, high, low, close, volume=volume)
    regime = detect_regime(high, low, close)

    ob = smc.get("ob") or {}
    liquidity = smc.get("liquidity") or {}
    near_bullish_ob = bool(ob.get("near_bullish_ob"))
    near_bearish_ob = bool(ob.get("near_bearish_ob"))
    near_eqh = bool(liquidity.get("near_eqh"))
    near_eql = bool(liquidity.get("near_eql"))

    fvg = smc.get("fvg") or {}
    fvg_bullish_count = len(fvg.get("bullish", []))
    fvg_bearish_count = len(fvg.get("bearish", []))

    return {
        "rsi": _safe(rsi14.iloc[-1]),
        "rsi_slope": _safe(rsi14.iloc[-1] - rsi14.iloc[-5]) if len(rsi14) >= 6 else None,
        "macd": _safe(macd_line.iloc[-1]),
        "macd_signal": _safe(macd_signal.iloc[-1]),
        "macd_hist": _safe(macd_hist.iloc[-1]),
        "macd_hist_slope": _safe(macd_hist.iloc[-1] - macd_hist.iloc[-3]) if len(macd_hist) >= 4 else None,
        "ema_20": _safe(e20.iloc[-1]),
        "ema_50": _safe(e50.iloc[-1]),
        "ema_200": _safe(e200.iloc[-1]) if e200 is not None else None,
        "ema_bullish": ema_bullish,
        "bb_width": bb_width,
        "bb_position": _safe((close.iloc[-1] - bb_lower.iloc[-1]) / (bb_upper.iloc[-1] - bb_lower.iloc[-1]))
        if (bb_upper.iloc[-1] - bb_lower.iloc[-1]) != 0 else 0.5,
        "atr_14": _safe(a14.iloc[-1]),
        "pa_trend": pa.get("trend", "NEUTRAL"),
        "pa_bos": bool(pa.get("bos")),
        "pa_bos_dir": pa.get("bos_dir"),
        "pa_choch": bool(pa.get("choch")),
        "pa_bos_score": _safe(pa.get("bos_score")),
        "fvg_bullish_count": fvg_bullish_count,
        "fvg_bearish_count": fvg_bearish_count,
        "near_bullish_ob": near_bullish_ob,
        "near_bearish_ob": near_bearish_ob,
        "near_eqh": near_eqh,
        "near_eql": near_eql,
        "regime": regime.get("regime", "UNKNOWN"),
        "adx": regime.get("adx"),
        "trend_strength": regime.get("trend_strength", "UNKNOWN"),
    }


def _compute_level4(symbol: str, timeframe: str, df: pd.DataFrame) -> dict:
    """Contextual features available at signal time (no lookahead)."""
    now = datetime.now(timezone.utc)
    session = get_session_info()
    return {
        "day_of_week": now.weekday(),  # 0=Monday
        "hour_utc": now.hour,
        "session": session.get("session", "UNKNOWN"),
        "session_overlap": session.get("overlap"),
        "minutes_after_session_open": session.get("minutes_after_open"),
        "asset_type": _infer_asset_type(symbol),
        "timeframe": timeframe,
    }


def _compute_level5(
    df: pd.DataFrame,
    symbol: str,
    timeframe: str,
    level3: dict,
    level4: dict,
) -> dict:
    """Meta features: confluence, fatigue, predictive features, concept vector."""
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    open_ = df["open"].astype(float)
    volume = df.get("volume")

    pa = detect_market_structure(high, low, close, volume=volume)
    smc = analyze_smc(open_, high, low, close, volume=volume)

    # Confluence score: count of aligned bullish/bearish factors
    bullish = 0
    bearish = 0
    if level3.get("ema_bullish"):
        bullish += 1
    if level3.get("pa_trend") == "BULLISH":
        bullish += 1
    if level3.get("pa_bos_dir") == "BULLISH":
        bullish += 1
    if level3.get("regime") == "TRENDING_BULL":
        bullish += 1
    rsi = level3.get("rsi")
    if rsi is not None:
        if 40 < rsi < 65:
            bullish += 1
        elif rsi > 75:
            bearish += 1
        elif rsi < 30:
            bullish += 1

    if level3.get("pa_trend") == "BEARISH":
        bearish += 1
    if level3.get("pa_bos_dir") == "BEARISH":
        bearish += 1
    if level3.get("regime") == "TRENDING_BEAR":
        bearish += 1

    confluence_score = bullish - bearish  # range approx -4..+4

    # Trend fatigue: divergence between price and RSI over last 20 bars
    price_new_high = close.iloc[-1] >= close.iloc[-20:].max() * 0.999
    rsi_new_high = False
    if rsi is not None and level3.get("rsi_slope") is not None:
        rsi_new_high = (rsi + level3["rsi_slope"]) >= (rsi + 5)
    trend_fatigue = 0.0
    if price_new_high and not rsi_new_high:
        trend_fatigue = 1.0  # bearish divergence hint
    elif (close.iloc[-1] <= close.iloc[-20:].min() * 1.001) and not rsi_new_high:
        trend_fatigue = -1.0  # bullish divergence hint

    # Compression / expansion
    compression_expansion = detect_compression_expansion(df)
    liquidity_sweep = detect_liquidity_sweep(df, pa=pa)
    rsi_divergence = detect_rsi_divergence(df)
    macd_divergence = detect_macd_divergence(df)
    volume_anomaly = detect_volume_anomaly(df)

    market_concept_vector = compute_market_concept_vector(
        symbol,
        df,
        level4.get("asset_type", "UNKNOWN"),
        regime={"regime": level3.get("regime"), "trend_strength": level3.get("trend_strength")},
        pa=pa,
        smc=smc,
    )

    return {
        "confluence_score": confluence_score,
        "trend_fatigue": trend_fatigue,
        "compression_flag": bool(compression_expansion["compression_score"] > 0.5),
        "expansion_flag": bool(compression_expansion["expansion_score"] > 0.5),
        "compression_expansion": compression_expansion,
        "liquidity_sweep": liquidity_sweep,
        "rsi_divergence": rsi_divergence,
        "macd_divergence": macd_divergence,
        "volume_anomaly": volume_anomaly,
        "market_concept_vector": market_concept_vector,
    }


def _infer_asset_type(symbol: str) -> str:
    """Mirror the classification used in scan.py."""
    s = symbol.upper()
    if any(x in s for x in ["V75", "V100", "V50", "BOOM", "CRASH", "JUMP", "STEP", "RANGE"]):
        return "SYNTHETIC"
    if "/" in s:
        base, quote = s.split("/", 1)
        fiat = {"EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "SGD", "HKD"}
        if base in fiat and quote in fiat:
            return "FOREX"
        commodities = {"XAU", "XAG", "XPT", "WTI", "BRENT", "NG", "NATGAS"}
        if base in commodities or quote in commodities:
            return "COMMODITY"
        return "CRYPTO"
    return "UNKNOWN"


def build_feature_vector(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
) -> dict:
    """
    Build the complete multi-level feature vector from a price DataFrame.
    Safe to call at every closed candle; no lookahead.
    """
    if len(df) < 50:
        return {"error": "not enough data"}

    # Ensure numeric columns and optional volume
    for col in ["open", "high", "low", "close"]:
        df[col] = df[col].astype(float)
    if "volume" not in df.columns:
        df = df.copy()
        df["volume"] = 0.0
    df["volume"] = df["volume"].astype(float)

    level1 = _compute_level1(df)
    level2 = _compute_level2(df)
    level3 = _compute_level3(df)
    level4 = _compute_level4(symbol, timeframe, df)
    level5 = _compute_level5(df, symbol, timeframe, level3, level4)

    # Flatten for ML ingestion while keeping hierarchy
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level1_raw": level1,
        "level2_calculated": level2,
        "level3_structural": level3,
        "level4_contextual": level4,
        "level5_meta": level5,
        "feature_confidence": {
            "level1": 1.0,
            "level2": 0.95,
            "level3": 0.85,
            "level4": 1.0,
            "level5": 0.7,
        },
    }
