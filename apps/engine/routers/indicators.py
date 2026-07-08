from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import pandas as pd
import numpy as np

router = APIRouter()


class Candle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class IndicatorsRequest(BaseModel):
    symbol: str
    timeframe: str
    candles: List[Candle]


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def macd(series: pd.Series, fast=12, slow=26, signal=9):
    e_fast   = ema(series, fast)
    e_slow   = ema(series, slow)
    macd_line = e_fast - e_slow
    signal_line = ema(macd_line, signal)
    histogram   = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger_bands(series: pd.Series, period=20, std_dev=2):
    mid   = series.rolling(period).mean()
    std   = series.rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std
    return upper, mid, lower


@router.post("/compute")
async def compute_indicators(req: IndicatorsRequest):
    if len(req.candles) < 50:
        raise HTTPException(status_code=400, detail="Need at least 50 candles")

    df = pd.DataFrame([c.model_dump() for c in req.candles])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)

    last = len(df) - 1

    ema20  = ema(df["close"], 20)
    ema50  = ema(df["close"], 50)
    ema200 = ema(df["close"], 200) if len(df) >= 200 else None
    rsi14  = rsi(df["close"], 14)
    atr14  = atr(df["high"], df["low"], df["close"], 14)
    vol_sma = df["volume"].rolling(20).mean()
    macd_line, signal_line, histogram = macd(df["close"])
    bb_upper, bb_mid, bb_lower = bollinger_bands(df["close"])

    def safe(series, idx=last):
        if series is None: return None
        v = series.iloc[idx]
        return None if pd.isna(v) else round(float(v), 6)

    close   = float(df["close"].iloc[last])
    e20     = safe(ema20)
    e50     = safe(ema50)
    e200    = safe(ema200)
    vol_cur = float(df["volume"].iloc[last])
    vol_avg = safe(vol_sma)

    result = {
        "symbol":    req.symbol,
        "timeframe": req.timeframe,
        "close":     round(close, 6),
        "ema20":     e20,
        "ema50":     e50,
        "ema200":    e200,
        "rsi":       safe(rsi14),
        "atr":       safe(atr14),
        "macd":      safe(macd_line),
        "macd_signal":   safe(signal_line),
        "macd_histogram": safe(histogram),
        "bb_upper":  safe(bb_upper),
        "bb_mid":    safe(bb_mid),
        "bb_lower":  safe(bb_lower),
        "volume":    vol_cur,
        "volume_ratio": round(vol_cur / vol_avg, 3) if vol_avg and vol_avg > 0 else None,
        "ema_alignment_bullish": (
            e20 is not None and e50 is not None and e200 is not None
            and e20 > e50 > e200 and close > e200
        ),
        "above_ema200": e200 is not None and close > e200,
    }

    return result
