"""Tests unitaires — détection de régime de marché."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import pandas as pd
import numpy as np

from routers.regime import detect_regime, regime_filter, regime_bonus, compute_adx


def _make_series(n: int = 100, trend: float = 0.0, volatility: float = 1.0, seed: int = 42) -> pd.DataFrame:
    """Génère un DataFrame OHLC avec tendance et volatilité contrôlées."""
    np.random.seed(seed)
    returns = np.random.normal(trend / 100, volatility / 100, n)
    close = 100 * np.cumprod(1 + returns)
    high = close * (1 + np.random.uniform(0, volatility / 200, n))
    low = close * (1 - np.random.uniform(0, volatility / 200, n))
    open_p = close * (1 + np.random.uniform(-volatility / 400, volatility / 400, n))
    return pd.DataFrame({"open": open_p, "high": high, "low": low, "close": close})


class TestDetectRegime:
    def test_not_enough_data(self):
        df = _make_series(n=30)
        result = detect_regime(df["high"], df["low"], df["close"])
        assert result["regime"] == "UNKNOWN"
        assert result["adx"] is None

    def test_bullish_trending(self):
        df = _make_series(n=250, trend=0.35, volatility=0.8, seed=10)
        result = detect_regime(df["high"], df["low"], df["close"])
        assert result["regime"] == "TRENDING_BULL"
        assert result["adx"] > 25
        assert result["above_ema200"] is True
        assert result["trend_strength"] in ("STRONG", "MODERATE")

    def test_bearish_trending(self):
        df = _make_series(n=250, trend=-0.35, volatility=0.8, seed=11)
        result = detect_regime(df["high"], df["low"], df["close"])
        assert result["regime"] == "TRENDING_BEAR"
        assert result["adx"] > 25
        assert result["above_ema200"] is False

    def test_ranging_market(self):
        df = _make_series(n=250, trend=0.0, volatility=0.4, seed=12)
        result = detect_regime(df["high"], df["low"], df["close"])
        assert result["regime"] == "RANGING"
        assert result["adx"] < 25

    def test_volatile_market(self):
        df = _make_series(n=250, trend=0.0, volatility=6.0, seed=13)
        result = detect_regime(df["high"], df["low"], df["close"], atr_volatile_threshold_pct=2.5)
        assert result["regime"] == "VOLATILE"
        assert result["atr_pct"] >= 2.5


class TestRegimeFilter:
    def test_volatile_blocked(self):
        allowed, reason = regime_filter({"regime": "VOLATILE"}, "BUY")
        assert allowed is False
        assert "VOLATILE" in reason

    def test_bull_filters_sell(self):
        allowed, reason = regime_filter({"regime": "TRENDING_BULL"}, "SELL")
        assert allowed is False
        assert "TRENDING_BULL" in reason

    def test_bear_filters_buy(self):
        allowed, reason = regime_filter({"regime": "TRENDING_BEAR"}, "BUY")
        assert allowed is False
        assert "TRENDING_BEAR" in reason

    def test_aligned_signals_allowed(self):
        assert regime_filter({"regime": "TRENDING_BULL"}, "BUY")[0] is True
        assert regime_filter({"regime": "TRENDING_BEAR"}, "SELL")[0] is True


class TestRegimeBonus:
    def test_bull_buy_bonus(self):
        bonus, reasons = regime_bonus({"regime": "TRENDING_BULL", "adx": 35}, "BUY")
        assert bonus == 15
        assert any("TRENDING_BULL" in r for r in reasons)

    def test_bear_sell_bonus(self):
        bonus, reasons = regime_bonus({"regime": "TRENDING_BEAR", "adx": 30}, "SELL")
        assert bonus == 15
        assert any("TRENDING_BEAR" in r for r in reasons)

    def test_ranging_malus(self):
        bonus, reasons = regime_bonus({"regime": "RANGING"}, "BUY")
        assert bonus == -10
        assert any("RANGING" in r for r in reasons)

    def test_volatile_malus(self):
        bonus, reasons = regime_bonus({"regime": "VOLATILE"}, "SELL")
        assert bonus == -20
        assert any("VOLATILE" in r for r in reasons)


class TestComputeAdx:
    def test_returns_three_series(self):
        df = _make_series(n=100)
        adx, plus_di, minus_di = compute_adx(df["high"], df["low"], df["close"])
        assert len(adx) == len(df)
        assert len(plus_di) == len(df)
        assert len(minus_di) == len(df)
        assert (adx.dropna() >= 0).all() and (adx.dropna() <= 100).all()
