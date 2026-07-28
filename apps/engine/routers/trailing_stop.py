"""
Trailing Stop Engine — Phase A/B

Provides multiple trailing-stop methods:
- ATR trailing (highest high/low +/- ATR multiple)
- Swing trailing (last confirmed swing low/high)
- EMA trailing (below/above an EMA band)
- Chandelier trailing (highest high/low over N bars +/- ATR multiple)

All calculations are look-ahead free.
"""
from typing import Literal, Optional, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
import numpy as np

from routers.indicators import ema, atr as compute_atr
from indicators.swing import find_pivot_lows, find_pivot_highs

router = APIRouter()


class Candle(BaseModel):
    time: Union[str, int]
    open: float
    high: float
    low: float
    close: float
    volume: float


class TrailingStopRequest(BaseModel):
    symbol: str
    direction: Literal["BUY", "SELL"]
    entry_price: float = Field(..., gt=0)
    stop_loss: float = Field(..., gt=0)
    candles: list[Candle]
    method: Literal["atr", "swing", "ema", "chandelier"] = "atr"
    atr_multiplier: float = 2.0
    ema_period: int = 20
    chandelier_period: int = 22
    chandelier_atr_mult: float = 3.0
    activation_r: float = 0.0  # 0 = active immediately; 1 = active after +1R


class TrailingStopResponse(BaseModel):
    symbol: str
    method: str
    direction: str
    recommended_stop: Optional[float]
    current_stop: float
    activated: bool
    distance_pct: float
    reason: str
    raw_values: dict


def _to_df(candles: list[Candle]) -> pd.DataFrame:
    df = pd.DataFrame([c.model_dump() for c in candles])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = df[col].astype(float)
    return df


def _risk_distance(direction: str, entry: float, stop: float) -> float:
    return abs(entry - stop)


def _is_activated(
    direction: str,
    entry: float,
    current_price: float,
    stop: float,
    activation_r: float,
) -> bool:
    if activation_r <= 0:
        return True
    risk = _risk_distance(direction, entry, stop)
    if risk <= 0:
        return True
    profit = current_price - entry if direction == "BUY" else entry - current_price
    return profit >= activation_r * risk


def atr_trailing(
    df: pd.DataFrame,
    direction: str,
    multiplier: float = 2.0,
    current_stop: Optional[float] = None,
) -> tuple[Optional[float], dict]:
    """
    For BUY: trail = highest(high) - multiplier * ATR(14)
    For SELL: trail = lowest(low) + multiplier * ATR(14)
    """
    atr_series = compute_atr(df["high"], df["low"], df["close"], 14)
    atr_current = float(atr_series.iloc[-1]) if not pd.isna(atr_series.iloc[-1]) else 0.0
    if atr_current <= 0:
        return None, {"atr": atr_current}

    if direction == "BUY":
        highest = float(df["high"].iloc[-20:].max())
        trail = highest - multiplier * atr_current
    else:
        lowest = float(df["low"].iloc[-20:].min())
        trail = lowest + multiplier * atr_current

    return trail, {"atr": round(atr_current, 6)}


def swing_trailing(
    df: pd.DataFrame,
    direction: str,
    current_stop: Optional[float] = None,
) -> tuple[Optional[float], dict]:
    """
    Use the most recent confirmed swing low (BUY) or swing high (SELL).
    """
    lows = find_pivot_lows(df["low"], left=2, right=2)
    highs = find_pivot_highs(df["high"], left=2, right=2)
    level = None
    if direction == "BUY":
        idx = lows[lows].index[-1] if lows.any() else None
        level = float(df["low"].loc[idx]) if idx is not None else None
    else:
        idx = highs[highs].index[-1] if highs.any() else None
        level = float(df["high"].loc[idx]) if idx is not None else None

    return level, {"swing_count_lows": int(lows.sum()), "swing_count_highs": int(highs.sum())}


def ema_trailing(
    df: pd.DataFrame,
    direction: str,
    period: int = 20,
    current_stop: Optional[float] = None,
) -> tuple[Optional[float], dict]:
    """
    Trail along an EMA band: stop is placed slightly below (BUY) or above (SELL) EMA.
    """
    if len(df) < period:
        return None, {"ema": None}
    ema_series = ema(df["close"], period)
    ema_current = float(ema_series.iloc[-1])
    buffer = df["close"].iloc[-20:].std()
    if pd.isna(buffer):
        buffer = 0.0

    if direction == "BUY":
        trail = ema_current - buffer
    else:
        trail = ema_current + buffer

    return trail, {"ema": round(ema_current, 6), "buffer": round(buffer, 6)}


def chandelier_trailing(
    df: pd.DataFrame,
    direction: str,
    period: int = 22,
    atr_mult: float = 3.0,
    current_stop: Optional[float] = None,
) -> tuple[Optional[float], dict]:
    """
    Chandelier exit: highest high / lowest low over `period` +/- ATR multiple.
    """
    if len(df) < period:
        return None, {"period_used": len(df)}
    atr_series = compute_atr(df["high"], df["low"], df["close"], 14)
    atr_current = float(atr_series.iloc[-1])
    if pd.isna(atr_current):
        atr_current = 0.0

    window = df.iloc[-period:]
    if direction == "BUY":
        highest = float(window["high"].max())
        trail = highest - atr_mult * atr_current
        raw = {"highest_high": highest, "atr": round(atr_current, 6)}
    else:
        lowest = float(window["low"].min())
        trail = lowest + atr_mult * atr_current
        raw = {"lowest_low": lowest, "atr": round(atr_current, 6)}

    return trail, raw


def compute_trailing_stop(
    req: TrailingStopRequest,
) -> TrailingStopResponse:
    df = _to_df(req.candles)
    if len(df) < 30:
        raise HTTPException(status_code=400, detail="Need at least 30 candles")

    current_price = float(df["close"].iloc[-1])
    current_stop = req.stop_loss

    activated = _is_activated(req.direction, req.entry_price, current_price, current_stop, req.activation_r)

    if not activated:
        distance_pct = abs(current_price - current_stop) / current_stop * 100
        return TrailingStopResponse(
            symbol=req.symbol,
            method=req.method,
            direction=req.direction,
            recommended_stop=None,
            current_stop=current_stop,
            activated=False,
            distance_pct=round(distance_pct, 4),
            reason=f"Trailing pas encore actif : profit < {req.activation_r}R",
            raw_values={"current_price": current_price, "activation_r": req.activation_r},
        )

    method_fn = {
        "atr": lambda: atr_trailing(df, req.direction, req.atr_multiplier, current_stop),
        "swing": lambda: swing_trailing(df, req.direction, current_stop),
        "ema": lambda: ema_trailing(df, req.direction, req.ema_period, current_stop),
        "chandelier": lambda: chandelier_trailing(
            df, req.direction, req.chandelier_period, req.chandelier_atr_mult, current_stop
        ),
    }[req.method]

    trail, raw = method_fn()

    if trail is None or np.isnan(trail):
        distance_pct = abs(current_price - current_stop) / current_stop * 100
        return TrailingStopResponse(
            symbol=req.symbol,
            method=req.method,
            direction=req.direction,
            recommended_stop=None,
            current_stop=current_stop,
            activated=True,
            distance_pct=round(distance_pct, 4),
            reason="Impossible de calculer le trailing stop (données insuffisantes)",
            raw_values={"current_price": current_price, **raw},
        )

    # For BUY: never move stop down; for SELL: never move stop up
    if req.direction == "BUY":
        recommended = max(trail, current_stop)
        reason = "stop remonté" if recommended > current_stop else "stop conservé"
    else:
        recommended = min(trail, current_stop)
        reason = "stop rabaissé" if recommended < current_stop else "stop conservé"

    distance_pct = abs(current_price - recommended) / recommended * 100

    return TrailingStopResponse(
        symbol=req.symbol,
        method=req.method,
        direction=req.direction,
        recommended_stop=round(recommended, 6),
        current_stop=current_stop,
        activated=True,
        distance_pct=round(distance_pct, 4),
        reason=reason,
        raw_values={"current_price": current_price, **raw},
    )


@router.post("/trailing-stop/compute", response_model=TrailingStopResponse)
async def trailing_stop_compute(req: TrailingStopRequest):
    return compute_trailing_stop(req)
