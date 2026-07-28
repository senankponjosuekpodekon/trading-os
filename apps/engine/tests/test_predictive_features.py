"""Tests for predictive features: compression/expansion and liquidity sweep."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd

from ml.predictive_features import (
    detect_compression_expansion,
    detect_liquidity_sweep,
    detect_rsi_divergence,
    detect_macd_divergence,
    detect_volume_anomaly,
)


def _make_compressed_df(n=120):
    np.random.seed(7)
    # Volatile history, then tight consolidation in the last 30 bars
    history = 100 + np.cumsum(np.random.randn(n - 30) * 1.5)
    flat = 100 + np.random.randn(30) * 0.2
    close = np.concatenate([history, flat])
    return pd.DataFrame({
        "open": close - 0.2,
        "high": close + 0.4,
        "low": close - 0.4,
        "close": close,
        "volume": np.random.randint(100, 200, n),
    })


def _make_expanding_df(n=120):
    np.random.seed(8)
    # Quiet history, then expansion in the last 80 bars
    history = 100 + np.random.randn(n - 80) * 0.3
    expansion = 100 + np.linspace(0, 20, 80) + np.random.randn(80) * 1.5
    close = np.concatenate([history, expansion])
    high = close + np.abs(np.random.randn(n)) * 2.0
    low = close - np.abs(np.random.randn(n)) * 2.0
    return pd.DataFrame({
        "open": close - 0.5,
        "high": high,
        "low": low,
        "close": close,
        "volume": np.random.randint(100, 200, n),
    })


def test_compression_expansion_keys():
    df = _make_compressed_df()
    res = detect_compression_expansion(df)
    assert set(res.keys()) == {
        "compression_score", "expansion_score", "breakout_direction",
        "squeeze_count", "bb_width", "bb_width_percentile", "atr_percentile",
    }
    assert 0.0 <= res["compression_score"] <= 1.0
    assert 0.0 <= res["expansion_score"] <= 1.0
    assert res["breakout_direction"] in {"BULL", "BEAR", "NEUTRAL"}


def test_compressed_market_has_higher_compression():
    compressed = _make_compressed_df()
    exp = _make_expanding_df()
    compressed_res = detect_compression_expansion(compressed)
    exp_res = detect_compression_expansion(exp)
    assert compressed_res["compression_score"] > exp_res["compression_score"]


def test_expanding_market_has_higher_expansion():
    compressed = _make_compressed_df()
    exp = _make_expanding_df()
    compressed_res = detect_compression_expansion(compressed)
    exp_res = detect_compression_expansion(exp)
    assert exp_res["expansion_score"] >= compressed_res["expansion_score"]


def test_liquidity_sweep_keys():
    df = _make_compressed_df()
    res = detect_liquidity_sweep(df)
    assert set(res.keys()) == {
        "near_eqh", "near_eql", "sweep_risk", "sweep_direction",
        "target_level", "distance_pct",
    }
    assert 0.0 <= res["sweep_risk"] <= 1.0
    assert res["sweep_direction"] in {"BULL", "BEAR", "NEUTRAL"}


def test_liquidity_sweep_fakeout():
    """Build a series with equal highs, then a spike wick above and close back below."""
    n = 100
    close = np.full(n, 100.0)
    high = np.full(n, 101.0)
    low = np.full(n, 99.0)
    # Create equal highs near end
    high[-6:-3] = 102.0
    close[-6:-3] = 100.5
    # Fakeout: wick above 102 then close below
    high[-2] = 102.5
    close[-2] = 100.2
    close[-1] = 100.1
    df = pd.DataFrame({
        "open": close - 0.2,
        "high": high,
        "low": low,
        "close": close,
        "volume": np.full(n, 150.0),
    })
    res = detect_liquidity_sweep(df)
    assert res["sweep_direction"] == "BEAR"
    assert res["sweep_risk"] > 0.0
    assert res["target_level"] is not None


def _make_divergence_df():
    n = 150
    np.random.seed(42)
    t = np.arange(n)
    # Two swing highs: price higher, RSI lower => bearish regular divergence
    close = 100 + 0.1 * t + np.sin(t / 10) * 2
    close[50] = 115
    close[120] = 120
    high = close + 1.5
    low = close - 1.5
    # Make RSI lower at second peak
    noise = np.random.randn(n) * 0.1
    close = close + noise
    return pd.DataFrame({
        "open": close - 0.5,
        "high": high + noise,
        "low": low + noise,
        "close": close,
        "volume": np.full(n, 1000.0),
    })


def test_rsi_divergence_keys():
    df = _make_divergence_df()
    res = detect_rsi_divergence(df, lookback=80)
    assert set(res.keys()) == {"regular", "hidden", "combined_score", "regular_score", "hidden_score"}
    assert res["regular"] in {"BULL", "BEAR", "NEUTRAL"}
    assert res["hidden"] in {"BULL", "BEAR", "NEUTRAL"}
    assert 0.0 <= res["combined_score"] <= 1.0


def test_macd_divergence_keys():
    df = _make_divergence_df()
    res = detect_macd_divergence(df, lookback=80)
    assert set(res.keys()) == {"regular", "score", "macd_line_last", "signal_line_last", "histogram_last"}
    assert res["regular"] in {"BULL", "BEAR", "NEUTRAL"}
    assert 0.0 <= res["score"] <= 1.0


def test_volume_anomaly_detects_spike():
    n = 60
    np.random.seed(5)
    close = 100 + np.cumsum(np.random.randn(n) * 0.1)
    volume = np.random.normal(1000, 100, n)
    volume[-1] = 5000  # big spike
    df = pd.DataFrame({
        "open": close - 0.05,
        "high": close + 0.05,
        "low": close - 0.05,
        "close": close,
        "volume": volume,
    })
    res = detect_volume_anomaly(df, lookback=20)
    assert res["is_anomaly"] is True
    assert res["relative_volume"] > 2.0
    assert res["anomaly_direction"] in {"BULL", "BEAR"}


def test_volume_anomaly_no_volume():
    df = pd.DataFrame({
        "open": [1.0, 2.0],
        "high": [2.0, 3.0],
        "low": [0.5, 1.5],
        "close": [1.5, 2.5],
    })
    res = detect_volume_anomaly(df)
    assert res["is_anomaly"] is False
    assert res["relative_volume"] == 1.0
