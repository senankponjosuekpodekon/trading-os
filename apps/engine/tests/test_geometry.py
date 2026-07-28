"""Tests for the Geometry Engine primitives."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np

from geometry.core import (
    Pivot, Swing, PriceZone,
    alternating_pivots, filter_significant, build_swings,
    leg_ratio, zone_overlap, score_fib_errors,
)


def test_alternating_pivots_removes_consecutive_same_type():
    pts = [
        Pivot(0, 100, "low"),
        Pivot(1, 105, "high"),
        Pivot(2, 103, "high"),
        Pivot(3, 98, "low"),
    ]
    result = alternating_pivots(pts)
    assert [p.idx for p in result] == [0, 1, 3]
    assert result[1].price == 105


def test_build_swings_direction():
    pts = [
        Pivot(0, 100, "low"),
        Pivot(5, 110, "high"),
        Pivot(10, 105, "low"),
    ]
    swings = build_swings(pts)
    assert len(swings) == 2
    assert swings[0].direction == "up"
    assert swings[1].direction == "down"


def test_price_zone_overlap():
    a = PriceZone(100, 110)
    b = PriceZone(105, 115)
    assert a.overlap(b) == 0.5
    c = PriceZone(120, 130)
    assert a.overlap(c) == 0.0


def test_leg_ratio():
    assert leg_ratio(100, 110, 20) == 0.5
    assert leg_ratio(110, 100, 20) == 0.5
    assert leg_ratio(100, 100, 1) == 0.0


def test_zone_overlap_dict():
    assert zone_overlap({"min": 100, "max": 110}, {"min": 105, "max": 115}) == 0.5


def test_score_fib_errors():
    assert score_fib_errors([0.0, 0.0], 0.02) == 1.0
    assert score_fib_errors([0.01], 0.02) == 0.5
    assert score_fib_errors([0.02], 0.02) == 0.0


def test_filter_significant_keeps_large_moves():
    n = 50
    close = pd.Series(100.0 + np.arange(n) * 0.5)
    pts = [
        Pivot(5, 98, "low"),
        Pivot(20, 120, "high"),
        Pivot(22, 119, "high"),
        Pivot(40, 110, "low"),
    ]
    pts = alternating_pivots(pts)
    filtered = filter_significant(pts, close)
    assert len(filtered) >= 2
