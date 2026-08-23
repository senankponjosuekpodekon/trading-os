from __future__ import annotations

import math
from typing import List

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/expected-move", tags=["Expected Move"])

MIN_CANDLES = 120
DEFAULT_HORIZONS = [5, 10, 20]


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def compute_expected_move_from_dataframe(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    horizons: List[int],
) -> dict:
    if len(df) < MIN_CANDLES:
        raise ValueError("Need at least 120 candles to compute expected move")

    df = df.sort_values("time").drop_duplicates(subset=["time"])
    df[["open", "high", "low", "close", "volume"]] = df[[
        "open",
        "high",
        "low",
        "close",
        "volume",
    ]].astype(float)

    close_price = float(df["close"].iloc[-1])
    if close_price == 0:
        raise ValueError("Close price is zero")

    atr_series = _atr(df["high"], df["low"], df["close"], 14).dropna()
    if atr_series.empty:
        raise ValueError("ATR unavailable")

    atr_value = float(atr_series.iloc[-1])
    atr_pct = (atr_value / close_price) * 100

    arr = atr_series.to_numpy()
    percentile = float(np.sum(arr <= atr_value) / len(arr) * 100)
    if percentile >= 70:
        vol_regime = "HIGH"
    elif percentile <= 30:
        vol_regime = "LOW"
    else:
        vol_regime = "NORMAL"

    volume_sma = df["volume"].rolling(50).mean().iloc[-1]
    volume_ratio = None
    if volume_sma is not None and not pd.isna(volume_sma) and not math.isclose(float(volume_sma), 0.0):
        volume_ratio = float(df["volume"].iloc[-1] / float(volume_sma))

    ranges = []
    for horizon in horizons:
        if horizon <= 0:
            continue
        move_abs = float(atr_value * math.sqrt(horizon))
        move_pct = (move_abs / close_price) * 100
        ranges.append({
            "horizon": horizon,
            "move": round(move_abs, 6),
            "move_pct": round(move_pct, 2),
            "upper": round(close_price + move_abs, 6),
            "lower": round(close_price - move_abs, 6),
        })

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "close": round(close_price, 6),
        "atr": round(atr_value, 6),
        "atr_pct": round(atr_pct, 2),
        "atr_percentile": round(percentile, 2),
        "volatility_regime": vol_regime,
        "volume_ratio": round(volume_ratio, 3) if volume_ratio is not None else None,
        "ranges": ranges,
    }


async def _fetch_klines(symbol: str, timeframe: str, limit: int) -> pd.DataFrame | None:
    from routers.scan import (
        fetch_klines_fallback,
        TF_MAP,
    )

    tf = TF_MAP.get(timeframe, timeframe)
    df = await fetch_klines_fallback(symbol, tf, limit=limit, timeout=12.0)
    return df


@router.get("/{symbol:path}")
async def expected_move(
    symbol: str,
    timeframe: str = Query("1h"),
    horizons: str = Query(",".join(map(str, DEFAULT_HORIZONS)), description="Comma-separated horizons in bars"),
    limit: int = Query(400, ge=150, le=600),
):
    try:
        horizon_values = sorted({int(h.strip()) for h in horizons.split(',') if h.strip()})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid horizons format") from exc
    if not horizon_values:
        horizon_values = DEFAULT_HORIZONS

    df = await _fetch_klines(symbol, timeframe, limit)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"Aucune donnée pour {symbol} / {timeframe}")

    try:
        payload = compute_expected_move_from_dataframe(symbol, timeframe, df, horizon_values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return payload
