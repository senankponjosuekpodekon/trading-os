"""Tests for the backtest engine and pattern-level journaling."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np
import pytest

from routers.backtest import run_backtest, BacktestRequest, compute_pattern_stats


def _make_trending_df(n: int = 260, direction: str = "up") -> pd.DataFrame:
    """Create a deterministic trending DataFrame for backtesting."""
    idx = np.arange(n)
    if direction == "up":
        close = 100.0 + idx * 0.4
    else:
        close = 200.0 - idx * 0.4
    noise = np.sin(idx / 5.0) * 0.2
    close = close + noise
    high = close + 0.3
    low = close - 0.3
    open_p = close - 0.05
    volume = np.full(n, 1000.0)
    return pd.DataFrame({
        "open": open_p, "high": high, "low": low, "close": close, "volume": volume,
    })


def test_compute_pattern_stats_aggregates_by_pattern():
    trades = [
        {"pattern_name": "abcd", "win": True, "pnl": 100, "pnl_pct": 1.0, "rr_achieved": 2.0,
         "duration_bars": 5, "pattern_confluence_score": 0.8},
        {"pattern_name": "abcd", "win": False, "pnl": -50, "pnl_pct": -0.5, "rr_achieved": 1.0,
         "duration_bars": 3, "pattern_confluence_score": 0.6},
        {"pattern_name": "double_top", "win": True, "pnl": 80, "pnl_pct": 0.8, "rr_achieved": 1.5,
         "duration_bars": 4, "pattern_confluence_score": 0.7},
    ]
    stats = compute_pattern_stats(trades)

    assert "abcd" in stats
    assert stats["abcd"]["trades"] == 2
    assert stats["abcd"]["wins"] == 1
    assert stats["abcd"]["losses"] == 1
    assert stats["abcd"]["win_rate"] == 50.0
    assert stats["abcd"]["pnl"] == 50.0
    assert stats["abcd"]["avg_confluence_score"] == 0.7

    assert stats["double_top"]["trades"] == 1
    assert stats["double_top"]["win_rate"] == 100.0


def test_compute_pattern_stats_buckets_no_pattern():
    stats = compute_pattern_stats([
        {"win": True, "pnl": 10, "pnl_pct": 0.1, "rr_achieved": 1.0,
         "duration_bars": 2, "pattern_confluence_score": None},
    ])
    assert "NO_PATTERN" in stats
    assert stats["NO_PATTERN"]["trades"] == 1


@pytest.mark.asyncio
async def test_run_backtest_includes_pattern_breakdown(monkeypatch):
    df = _make_trending_df(n=260, direction="up")

    async def fake_fetch(*args, **kwargs):
        return df

    monkeypatch.setattr("routers.backtest.fetch_binance_klines", fake_fetch)

    req = BacktestRequest(
        symbol="TEST/USDT",
        timeframe="1h",
        lookback_bars=200,
        initial_capital=10000.0,
        risk_pct=1.0,
        min_confidence=0.0,
    )
    result = await run_backtest(req)

    assert isinstance(result.trade_list, list)
    assert isinstance(result.pattern_breakdown, dict)
    # Each recorded trade should carry pattern fields (even if None)
    for t in result.trade_list:
        assert "pattern_name" in t
        assert "pattern_confluence_score" in t
        assert "duration_bars" in t


def test_backtest_pattern_stats_endpoint(monkeypatch):
    from fastapi.testclient import TestClient
    from main import app

    df = _make_trending_df(n=260, direction="up")

    async def fake_fetch(*args, **kwargs):
        return df

    monkeypatch.setattr("routers.backtest.fetch_binance_klines", fake_fetch)

    client = TestClient(app)
    resp = client.post("/backtest/pattern-stats", json={
        "symbol": "TEST/USDT",
        "timeframe": "1h",
        "lookback_bars": 200,
        "initial_capital": 10000.0,
        "risk_pct": 1.0,
        "min_confidence": 0.0,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "TEST/USDT"
    assert "patterns" in body
    assert isinstance(body["patterns"], dict)
