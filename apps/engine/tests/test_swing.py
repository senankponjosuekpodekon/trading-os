"""Tests for indicators/swing.py."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np

from indicators.swing import (
    find_pivot_highs,
    find_pivot_lows,
    find_atr_swings,
    get_last_swing_points,
)


def _series(values):
    return pd.Series(values)


def test_pivot_high_detects_peak():
    high = _series([1, 2, 3, 2, 1])
    res = find_pivot_highs(high, left=2, right=2)
    assert res.iloc[2]
    assert not res.iloc[0]
    assert not res.iloc[4]


def test_pivot_low_detects_trough():
    low = _series([3, 2, 1, 2, 3])
    res = find_pivot_lows(low, left=2, right=2)
    assert res.iloc[2]


def test_atr_swings_ignore_noise():
    n = 50
    t = np.arange(n, dtype=float)
    close = pd.Series(100 + np.sin(t / 5) * 0.5)
    high = close + 0.1
    low = close - 0.1
    sh, sl = find_atr_swings(high, low, close)
    # Mostly flat series should produce very few strong swings
    assert sh.sum() <= 5
    assert sl.sum() <= 5


def test_get_last_swing_points_returns_scores():
    n = 60
    t = np.arange(n)
    close = pd.Series(np.sort(100 * (1 + 0.01 * t / n) + np.sin(t / 3) * 0.5))
    high = close + 0.2
    low = close - 0.2
    volume = pd.Series(np.full(n, 1000.0))
    high_points, low_points = get_last_swing_points(
        high, low, close, volume=volume, n_swings=3
    )
    assert len(high_points) <= 3
    assert len(low_points) <= 3
    if high_points:
        assert "score" in high_points[0]
        assert 0 <= high_points[0]["score"] <= 100
