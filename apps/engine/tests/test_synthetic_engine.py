"""Tests for synthetic engine helper functions."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd
import pytest

from routers.synthetic_engine import (
    spike_features,
    volatility_regime,
    autocorrelation,
    entropy,
    distance_to_extreme,
    WrongAssetTypeError,
    _assert_synthetic,
)


def _close(n=200, trend=0.0, vol=0.02, seed=42):
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend / n, vol, size=n)
    return pd.Series(100 * np.exp(np.cumsum(returns)))


def test_spike_features_counts_spikes():
    rng = np.random.default_rng(42)
    returns = rng.normal(0, 0.001, size=500)
    # Inject exactly 34 spikes of ~1.5%
    spike_indices = np.linspace(20, 480, 34, dtype=int)
    returns[spike_indices] = 0.015
    close = pd.Series(100 * np.exp(np.cumsum(returns)))
    res = spike_features(close, threshold_pct=0.01)
    assert res["spikes"] == 34
    assert res["avg_size"] > 0.01
    assert res["time_since"] is not None


def test_volatility_regime_low_vol():
    rng = np.random.default_rng(2)
    high_vol = rng.normal(0, 0.02, 50)
    flat = rng.normal(0, 0.0001, 50)
    returns = np.concatenate([high_vol, flat])
    close = pd.Series(100 * np.exp(np.cumsum(returns)))
    regime = volatility_regime(close)
    assert regime == "LOW_VOL"


def test_volatility_regime_expansion():
    rng = np.random.default_rng(3)
    low_vol = rng.normal(0, 0.0002, 95)
    high_vol = rng.normal(0, 0.3, 5)
    returns = np.concatenate([low_vol, high_vol])
    close = pd.Series(100 * np.exp(np.cumsum(returns)))
    regime = volatility_regime(close)
    assert regime == "VOL_EXPANSION"


def test_volatility_regime_spike_risk():
    rng = np.random.default_rng(7)
    returns = rng.normal(0, 0.0005, size=200)
    spike_indices = np.linspace(10, 190, 20, dtype=int)
    returns[spike_indices] = 0.01
    close = pd.Series(100 * np.exp(np.cumsum(returns)))
    regime = volatility_regime(close)
    assert regime == "SPIKE_RISK"


def test_autocorrelation_high_for_trending_series():
    close = pd.Series(100 + np.arange(100) * 0.5)
    corr = autocorrelation(close, lag=1)
    assert corr > 0.7


def test_entropy_random_vs_structured():
    rng = np.random.default_rng(1)
    random_close = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.02, 200))))
    structured_close = pd.Series(np.full(200, 100.0))
    assert entropy(random_close) > entropy(structured_close)


def test_entropy_insufficient_data():
    assert entropy(pd.Series([100.0])) == 0.0


def test_spike_features_empty_series():
    assert spike_features(pd.Series([100.0])) == {"spikes": 0, "avg_size": 0.0, "time_since": None}


def test_volatility_regime_insufficient_data():
    assert volatility_regime(pd.Series([100.0] * 10)) == "INSUFFICIENT_DATA"


def test_distance_to_extreme_below_high():
    assert distance_to_extreme(95.0, 100.0) == -0.05


def test_distance_to_extreme_zero_high():
    assert distance_to_extreme(95.0, 0.0) == 0.0


def test_assert_synthetic_accepts_valid():
    assert _assert_synthetic('VIX75/USD') == 'R_75'


def test_assert_synthetic_rejects_forex():
    with pytest.raises(WrongAssetTypeError):
        _assert_synthetic('EUR/USD')


def test_distance_to_extreme():
    assert distance_to_extreme(85, 100) == -0.15
    assert distance_to_extreme(100, 100) == 0.0


def test_wrong_asset_type_error():
    with pytest.raises(WrongAssetTypeError):
        _assert_synthetic("BTC/USDT")
