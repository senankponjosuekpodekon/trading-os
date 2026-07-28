"""Tests for tokenomics pre-signal analysis (network-free)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone, timedelta

from routers.tokenomics import (
    tokenomics_penalty,
    _parse_unlock_pct,
    _mock_tokenomics,
)


def test_mock_tokenomics_returns_dict():
    res = _mock_tokenomics("BTC")
    assert isinstance(res, dict)
    assert "next_unlock_pct" in res
    assert "top10_holders_pct" in res
    assert res["symbol"] == "BTC"
    assert res["source"] == "mock"


def test_tokenomics_danger_flag():
    ctx = {"next_unlock_pct": 25.0, "top10_holders_pct": 50.0}
    penalty, reasons, flags = tokenomics_penalty(ctx, "BUY")
    assert flags["danger_flag"] is True
    assert penalty == 0


def test_tokenomics_concentration_flag():
    ctx = {"next_unlock_pct": 0.0, "top10_holders_pct": 85.0}
    penalty, reasons, flags = tokenomics_penalty(ctx, "BUY")
    assert flags["concentration_flag"] is True
    assert penalty == 20


def test_parse_unlock_pct_future_only():
    now = datetime.now(timezone.utc)
    unlocks = [
        {"date": (now + timedelta(days=5)).isoformat(), "unlock_percent": 10},
        {"date": (now + timedelta(days=40)).isoformat(), "unlock_percent": 5},
    ]
    pct, dt = _parse_unlock_pct(unlocks)
    assert pct == 10


