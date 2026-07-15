"""Tests unitaires — métriques engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils import metrics


def test_counter_increment():
    metrics.inc("test:counter", 2)
    snap = metrics.snapshot()
    assert snap["counters"]["test:counter"] >= 2


def test_observe():
    metrics.observe("test:duration", 12.5)
    snap = metrics.snapshot()
    h = snap["histograms"]["test:duration"]
    assert h["count"] >= 1
    assert h["sum"] >= 12.5


def test_render():
    metrics.inc("test:render")
    rendered = metrics.render()
    assert "test:render" in rendered
    assert "test:counter" in rendered
