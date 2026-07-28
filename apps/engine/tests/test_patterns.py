"""Tests for the chart / harmonic pattern engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np

from patterns.detector import detect_all
from patterns.double_top import detect_double_top, detect_double_bottom
from patterns.head_shoulders import detect_head_and_shoulders, detect_inverse_head_and_shoulders
from patterns.harmonic import detect_harmonic


def _smooth_baseline(n: int, noise: float = 0.05) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Generate a gently trending baseline to avoid flat-line pivot ties."""
    close = 100.0 + np.linspace(0, 0.01 * (n - 1), n) + np.random.normal(0, noise, n)
    high = close + 0.15
    low = close - 0.15
    open_p = close + np.random.normal(0, noise * 0.5, n)
    return open_p, high, low, close


def _frame(n: int, noise: float = 0.05) -> pd.DataFrame:
    open_p, high, low, close = _smooth_baseline(n, noise=noise)
    return pd.DataFrame({
        "open": open_p, "high": high, "low": low, "close": close,
        "volume": np.full(n, 1000.0),
    })


def _ohlc(close: np.ndarray) -> pd.DataFrame:
    """Wrap a close array into a minimal OHLC DataFrame."""
    n = len(close)
    return pd.DataFrame({
        "open": close + 0.05,
        "high": close + 0.15,
        "low": close - 0.15,
        "close": close,
        "volume": np.full(n, 1000.0),
    })


def test_double_top_detected():
    """Two equal peaks with a valley in between."""
    close = np.full(30, 100.0)
    close[5:10] = [105.0, 108.0, 110.0, 108.0, 106.0]      # first peak @ idx 7
    close[10:15] = [104.0, 102.0, 99.0, 98.0, 99.0]        # valley @ idx 13
    close[15:26] = [101.0, 104.0, 107.0, 109.0, 110.0, 111.0, 110.0, 108.0, 105.0, 103.0, 101.0]  # second peak @ idx 20
    close[26:30] = [99.0, 98.0, 97.0, 96.0]

    p = detect_double_top(_ohlc(close), tolerance=0.03)
    assert p is not None
    assert p.name == "double_top"
    assert p.direction == "SELL"


def test_double_bottom_detected():
    """Two equal troughs with a peak in between."""
    close = np.full(30, 100.0)
    close[5:10] = [95.0, 92.0, 89.0, 92.0, 94.0]            # first trough @ idx 7
    close[10:15] = [96.0, 98.0, 101.0, 102.0, 101.0]        # peak @ idx 13
    close[15:26] = [99.0, 96.0, 93.0, 91.0, 90.0, 89.0, 90.0, 92.0, 94.0, 96.0, 98.0]  # second trough @ idx 20
    close[26:30] = [99.0, 100.0, 101.0, 102.0]

    p = detect_double_bottom(_ohlc(close), tolerance=0.03)
    assert p is not None
    assert p.name == "double_bottom"
    assert p.direction == "BUY"


def test_head_and_shoulders_detected():
    df = _frame(50, noise=0.0)
    # Left shoulder
    df.loc[5:9, "high"] = [108.0, 110.0, 111.0, 110.0, 108.0]
    df.loc[5:9, "close"] = [108.0, 110.0, 110.0, 109.0, 107.0]
    df.loc[5:9, "low"] = [107.0, 109.0, 109.0, 108.0, 106.0]
    # Head
    df.loc[18:22, "high"] = [118.0, 120.0, 121.0, 120.0, 118.0]
    df.loc[18:22, "close"] = [118.0, 120.0, 120.0, 119.0, 117.0]
    df.loc[18:22, "low"] = [117.0, 119.0, 119.0, 118.0, 116.0]
    # Right shoulder
    df.loc[35:39, "high"] = [108.0, 110.0, 111.0, 110.0, 108.0]
    df.loc[35:39, "close"] = [108.0, 110.0, 110.0, 109.0, 107.0]
    df.loc[35:39, "low"] = [107.0, 109.0, 109.0, 108.0, 106.0]

    p = detect_head_and_shoulders(df, tolerance=0.03)
    assert p is not None
    assert p.name == "head_and_shoulders"
    assert p.direction == "SELL"


def test_inverse_head_and_shoulders_detected():
    df = _frame(50, noise=0.0)
    # Left shoulder
    df.loc[5:9, "low"] = [92.0, 90.0, 89.0, 90.0, 92.0]
    df.loc[5:9, "close"] = [92.5, 90.0, 90.0, 91.0, 93.0]
    df.loc[5:9, "high"] = [94.0, 92.0, 92.0, 93.0, 95.0]
    # Head
    df.loc[18:22, "low"] = [82.0, 80.0, 79.0, 80.0, 82.0]
    df.loc[18:22, "close"] = [82.5, 80.0, 80.0, 81.0, 83.0]
    df.loc[18:22, "high"] = [84.0, 82.0, 82.0, 83.0, 85.0]
    # Right shoulder
    df.loc[35:39, "low"] = [92.0, 90.0, 89.0, 90.0, 92.0]
    df.loc[35:39, "close"] = [92.5, 90.0, 90.0, 91.0, 93.0]
    df.loc[35:39, "high"] = [94.0, 92.0, 92.0, 93.0, 95.0]

    p = detect_inverse_head_and_shoulders(df, tolerance=0.03)
    assert p is not None
    assert p.name == "inverse_head_and_shoulders"
    assert p.direction == "BUY"


def test_abcd_harmonic_detected():
    """Construct a bullish ABCD (X high, A low, B high, C low, D high)."""
    n = 35
    close = np.full(n, 100.0, dtype=float)

    # XA = 11, AB = 6.18 (61.8% of XA), BC = 3.82 (61.8% of AB), CD = 7.86 (127.2% of AB)
    close[3:8] = [105.0, 108.0, 111.0, 110.0, 108.0]      # X high @ idx 6
    close[8:13] = [104.0, 102.0, 101.0, 100.0, 100.0]      # down to A @ idx 11
    close[13:18] = [100.0, 103.0, 105.0, 106.0, 106.18]     # up to B @ idx 16
    close[18:23] = [105.0, 104.0, 103.0, 102.36, 102.36]    # down to C @ idx 21
    close[23:28] = [103.0, 106.0, 108.0, 109.0, 110.22]      # up to D @ idx 26
    close[28:35] = [109.0, 107.0, 105.0, 103.0, 102.0, 101.0, 100.0]

    df = _ohlc(close)
    patterns = detect_harmonic(df, tolerance=0.03)
    assert any(p.name == "abcd" for p in patterns)


def test_detector_returns_list():
    """detect_all should return a list of dicts and never crash on short data."""
    assert detect_all(pd.DataFrame({"open": [], "high": [], "low": [], "close": [], "volume": []})) == []
    assert detect_all(None) == []
