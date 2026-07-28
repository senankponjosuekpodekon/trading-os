"""Tests for social sentiment (LunarCrush) — network-free."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.social_sentiment import (
    _mock_metrics,
    social_bonus,
    _symbol_base,
)


def test_symbol_base():
    assert _symbol_base("BTC/USDT") == "BTC"


def test_mock_metrics_known_symbol():
    res = _mock_metrics("SOL")
    assert res["symbol"] == "SOL"
    assert "galaxy_score" in res
    assert res["source"] == "mock"


def test_mock_metrics_unknown_symbol():
    res = _mock_metrics("XYZ")
    assert res["galaxy_score"] == 50
    assert res["source"] == "mock"


def test_social_bonus_high_galaxy():
    ctx = {"galaxy_score": 72, "alt_rank": 12, "social_dominance": 8.0}
    bonus, reasons = social_bonus(ctx, "BUY")
    assert bonus == 12
    assert any("Galaxy" in r for r in reasons)


def test_social_bonus_no_bonus():
    ctx = {"galaxy_score": 45, "alt_rank": 60, "social_dominance": 1.0}
    bonus, reasons = social_bonus(ctx, "BUY")
    assert bonus == 0
    assert reasons == []
