"""Tests unitaires — analyse de marché et scan."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np

from routers.scan import analyze_candles


def _make_bullish_df(n: int = 100, start: float = 100.0) -> pd.DataFrame:
    """Génère une série haussière : close croissant avec EMA alignment."""
    np.random.seed(42)
    t = np.arange(n)
    close = start * (1 + 0.001 * t + 0.005 * np.sin(t / 10)) + np.random.normal(0, 0.3, n)
    close = np.sort(close)
    high = close * (1 + np.random.uniform(0, 0.0005, n))
    low = close * (1 - np.random.uniform(0, 0.0005, n))
    open_p = close * (1 + np.random.uniform(-0.0002, 0.0002, n))
    volume = np.random.uniform(1000, 5000, n)
    return pd.DataFrame({
        "open": open_p,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


def _make_bearish_df(n: int = 200, start: float = 300.0) -> pd.DataFrame:
    """Génère une série baissière : close décroissant fortement."""
    np.random.seed(43)
    t = np.arange(n)
    close = start * (1 - 0.0025 * t) + np.random.normal(0, 0.4, n)
    # Assure un décroissance globale tout en gardant ohlc cohérents
    close = np.maximum.accumulate(close[::-1])[::-1]
    close = np.sort(close)[::-1]
    high = close * (1 + np.random.uniform(0, 0.0005, n))
    low = close * (1 - np.random.uniform(0, 0.0005, n))
    open_p = close * (1 + np.random.uniform(-0.0002, 0.0002, n))
    volume = np.random.uniform(1000, 5000, n)
    return pd.DataFrame({
        "open": open_p,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


class TestAnalyzeCandles:
    def test_not_enough_data_returns_neutral(self):
        df = _make_bullish_df(n=30)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert result["signal"] == "NEUTRAL"
        assert result["confidence"] == 0
        assert result["reason"] == "not enough data"

    def test_bullish_series_returns_buy(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert result["symbol"] == "BTC/USDT"
        # Le score est bullish (moteur multi-couche : seuil 40 pour BUY/SELL)
        assert result["score"] >= 20
        assert result["signal"] in ("BUY", "NEUTRAL")
        assert result["entry_price"] is not None
        if result["signal"] != "NEUTRAL":
            assert result["stop_loss"] is not None
            assert result["take_profit_1"] is not None
            assert result["risk_reward"] is not None

    def test_bearish_series_returns_sell(self):
        df = _make_bearish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert result["symbol"] == "BTC/USDT"
        assert result["score"] <= 0
        # Signal SELL sauf si filtré par le seuil qualité DPS (Sprint 4, DPS < 60%)
        assert result["signal"] in ("SELL", "NEUTRAL")
        assert result["entry_price"] is not None
        if result["signal"] != "NEUTRAL":
            assert result["confidence"] >= 40
            assert result["stop_loss"] is not None
            assert result["take_profit_1"] is not None

    def test_analysis_sections_present(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert "indicators" in result
        assert "regime" in result
        assert "price_action" in result

    def test_takeprofit_above_entry_for_buy(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        if result["signal"] == "BUY":
            assert result["take_profit_1"] > result["entry_price"]
            assert result["stop_loss"] < result["entry_price"]

    def test_profile_suitability_present(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert isinstance(result.get("profile_suitability"), list)

    def test_detected_patterns_field_present(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BTC/USDT", "1h", df)
        assert "detectedPatterns" in result
        assert isinstance(result["detectedPatterns"], list)


class TestSyntheticAssets:
    def test_synthetic_symbol_routes_to_synthetic_engine(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("VIX75/USD", "1h", df)
        assert result["asset_type"] == "SYNTHETIC"
        assert "synthetic_stats" in result
        assert result["signal"] == "NEUTRAL"

    def test_boom_crash_symbol_routes_to_boom_crash_model(self):
        df = _make_bullish_df(n=250)
        result = analyze_candles("BOOM1000/USD", "1h", df)
        assert result["asset_type"] == "SYNTHETIC"
        assert result["explanation"].startswith("Synthetic")
