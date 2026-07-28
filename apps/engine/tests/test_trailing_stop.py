"""Tests for the trailing stop engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from fastapi import FastAPI

from routers.trailing_stop import (
    router,
    atr_trailing,
    swing_trailing,
    ema_trailing,
    chandelier_trailing,
    TrailingStopRequest,
    compute_trailing_stop,
)


def _candles_from_df(df: pd.DataFrame) -> list:
    return [
        {
            "time": str(i),
            "open": row["open"],
            "high": row["high"],
            "low": row["low"],
            "close": row["close"],
            "volume": row.get("volume", 0.0),
        }
        for i, row in df.iterrows()
    ]


def _make_bullish_df(n=80):
    np.random.seed(3)
    t = np.arange(n)
    close = 100 + 0.2 * t + np.random.randn(n) * 0.5
    high = close + 0.5 + np.abs(np.random.randn(n)) * 0.3
    low = close - 0.5 - np.abs(np.random.randn(n)) * 0.3
    return pd.DataFrame({"open": close - 0.2, "high": high, "low": low, "close": close, "volume": np.full(n, 1000.0)})


def test_atr_trailing_buy():
    df = _make_bullish_df(50)
    trail, raw = atr_trailing(df, "BUY", multiplier=2.0)
    assert trail is not None
    assert trail < df["high"].iloc[-20:].max()
    assert "atr" in raw


def test_atr_trailing_sell():
    df = _make_bullish_df(50)
    trail, _ = atr_trailing(df, "SELL", multiplier=2.0)
    assert trail is not None
    assert trail < df["high"].iloc[-1]


def test_swing_trailing():
    df = _make_bullish_df(60)
    trail, raw = swing_trailing(df, "BUY")
    assert trail is not None
    assert "swing_count_lows" in raw


def test_ema_trailing():
    df = _make_bullish_df(60)
    trail, raw = ema_trailing(df, "BUY", period=20)
    assert trail is not None
    assert "ema" in raw


def test_chandelier_trailing():
    df = _make_bullish_df(60)
    trail, raw = chandelier_trailing(df, "BUY", period=22, atr_mult=3.0)
    assert trail is not None
    assert "highest_high" in raw


def test_compute_trailing_stop_not_activated():
    df = _make_bullish_df(40)
    candles = _candles_from_df(df)
    req = TrailingStopRequest(
        symbol="BTC/USDT",
        direction="BUY",
        entry_price=df["close"].iloc[0],
        stop_loss=df["close"].iloc[0] * 0.99,
        candles=candles,
        method="atr",
        activation_r=15.0,  # huge, won't activate
    )
    res = compute_trailing_stop(req)
    assert res.activated is False
    assert res.recommended_stop is None


def test_endpoint():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    df = _make_bullish_df(40)
    candles = _candles_from_df(df)
    resp = client.post("/trailing-stop/compute", json={
        "symbol": "BTC/USDT",
        "direction": "BUY",
        "entry_price": df["close"].iloc[-20],
        "stop_loss": df["close"].iloc[-20] * 0.99,
        "candles": candles,
        "method": "atr",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["activated"] is True
    assert body["recommended_stop"] is not None
