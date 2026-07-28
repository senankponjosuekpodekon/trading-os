"""Tests for synthetic / boom-crash / tick stats engines."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd

from routers.synthetic_engine import analyze_synthetic, SYMBOL_TO_DERIV
from routers.boom_crash_model import analyze_boom_crash
from routers.tick_stats import _compute_stats, _monte_carlo_expected_range
from routers.scan import get_asset_type, _analyze_synthetic_candles


def _close(n=100, trend=0.0, vol=0.02, seed=42):
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend / n, vol, size=n)
    return pd.Series(100 * np.exp(np.cumsum(returns)))


def test_analyze_synthetic_returns_fields():
    close = _close(n=100, vol=0.05)
    res = analyze_synthetic(close, category="volatility")
    assert "state" in res
    assert "spike_probability" in res
    assert "mean_reversion_prob" in res
    assert "regime" in res
    assert "monte_carlo" in res


def test_analyze_boom_crash_returns_fields():
    close = _close(n=100, vol=0.03)
    res = analyze_boom_crash(close, direction="boom")
    assert res["direction"] == "boom"
    assert "spike_probability" in res
    assert "expected_max_up_pct" in res


def test_tick_stats_compute():
    ticks = list(_close(n=60, vol=0.02))
    stats = _compute_stats(pd.Series(ticks))
    assert "regime" in stats
    assert stats["regime"] in {"LOW_VOL", "EXHAUSTION", "EXPANSION", "NORMAL"}


def test_monte_carlo_range():
    ticks = _close(n=60, vol=0.01)
    mc = _monte_carlo_expected_range(ticks, n_sims=200, horizon=10)
    assert mc["expected_low"] < mc["expected_high"]
    assert mc["expected_range"] > 0


def test_get_asset_type():
    assert get_asset_type("BTC/USDT") == "CRYPTO"
    assert get_asset_type("VIX75/USD") == "SYNTHETIC"
    assert get_asset_type("BOOM1000/USD") == "SYNTHETIC"
    assert get_asset_type("EUR/USD") == "FOREX"
    assert get_asset_type("XAU/USD") == "COMMODITY"
    assert get_asset_type("SNTS") == "BRVM"
    assert get_asset_type("UNKNOWN") == "UNKNOWN"


def test_analyze_synthetic_candles_routes():
    df = pd.DataFrame({"open": _close(60), "high": _close(60) * 1.01, "low": _close(60) * 0.99, "close": _close(60)})
    res = _analyze_synthetic_candles("VIX75/USD", "1h", df)
    assert res["asset_type"] == "SYNTHETIC"
    assert res["signal"] == "NEUTRAL"
    assert "synthetic_stats" in res


def test_symbol_to_deriv_coverage():
    assert SYMBOL_TO_DERIV["VIX75/USD"] == "R_75"
    assert SYMBOL_TO_DERIV["BOOM1000/USD"] == "BOOM1000"
