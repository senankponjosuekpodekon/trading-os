"""Tests for the ML feature factory."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd

from ml.feature_factory import build_feature_vector, _infer_asset_type


def _make_df(n=100, trend="up"):
    np.random.seed(42)
    if trend == "up":
        close = np.linspace(100, 150, n) + np.random.randn(n) * 1.5
    elif trend == "down":
        close = np.linspace(150, 100, n) + np.random.randn(n) * 1.5
    else:
        close = 120 + np.cumsum(np.random.randn(n))
    df = pd.DataFrame({
        "open": close - 0.5,
        "high": close + 2.0,
        "low": close - 2.0,
        "close": close,
        "volume": np.random.randint(100, 1000, n),
    })
    return df


def test_feature_vector_keys():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    assert "error" not in vec
    assert set(vec.keys()) == {
        "symbol",
        "timeframe",
        "timestamp",
        "level1_raw",
        "level2_calculated",
        "level3_structural",
        "level4_contextual",
        "level5_meta",
        "feature_confidence",
    }


def test_level1_raw():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    l1 = vec["level1_raw"]
    for k in ["open", "high", "low", "close", "volume"]:
        assert k in l1
        assert isinstance(l1[k], float)


def test_level2_calculated():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    l2 = vec["level2_calculated"]
    for k in ["body_ratio", "atr_14", "atr_percentile", "volume_ratio_20", "log_return_1"]:
        assert k in l2
    assert 0.0 <= l2["body_ratio"] <= 1.0
    assert 0.0 <= l2["atr_percentile"] <= 1.0


def test_level3_structural():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    l3 = vec["level3_structural"]
    for k in ["rsi", "macd", "pa_trend", "pa_bos", "regime", "adx"]:
        assert k in l3
    assert l3["pa_trend"] in {"BULLISH", "BEARISH", "NEUTRAL"}


def test_level4_contextual():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    l4 = vec["level4_contextual"]
    assert l4["asset_type"] == "CRYPTO"
    assert "day_of_week" in l4
    assert "session" in l4


def test_level5_meta_features():
    df = _make_df()
    vec = build_feature_vector("BTC/USDT", "1h", df)
    l5 = vec["level5_meta"]
    assert "confluence_score" in l5
    assert "compression_expansion" in l5
    assert "liquidity_sweep" in l5
    assert "rsi_divergence" in l5
    assert "macd_divergence" in l5
    assert "volume_anomaly" in l5
    assert isinstance(l5["compression_flag"], bool)
    assert isinstance(l5["expansion_flag"], bool)
    concept = l5["market_concept_vector"]
    for k in ["trend", "accumulation", "expansion_energy", "liquidity_pressure", "imbalance", "stress"]:
        assert k in concept
        assert 0.0 <= concept[k] <= 1.0


def test_infer_asset_type():
    assert _infer_asset_type("VIX75/USD") == "SYNTHETIC"
    assert _infer_asset_type("EUR/USD") == "FOREX"
    assert _infer_asset_type("BTC/USDT") == "CRYPTO"
    assert _infer_asset_type("XAU/USD") == "COMMODITY"


def test_not_enough_data():
    df = _make_df(n=10)
    vec = build_feature_vector("BTC/USDT", "1h", df)
    assert vec.get("error") == "not enough data"
