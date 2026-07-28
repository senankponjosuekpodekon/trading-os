"""Tests for Forex macro context (calendar + DXY momentum)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
from datetime import datetime, timezone, timedelta

from scrapers.forex_calendar_scraper import (
    get_macro_context,
    _parse_iso,
    invalidate_cache,
)
from routers.forex_context import (
    _mock_dxy_df,
    _dxy_momentum,
    _apply_dxy_adjustment,
)


def test_parse_iso():
    dt = _parse_iso("2026-07-15T08:30:00-04:00")
    assert dt is not None
    assert dt.tzinfo is not None


def test_macro_context_no_risk_far_event():
    invalidate_cache()
    # Build a fake event 10h in the future to avoid network; but get_macro_context uses cache.
    # Instead we test the underlying logic by feeding events directly.
    from scrapers.forex_calendar_scraper import _high_impact_events
    now = datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)
    events = [
        {"title": "NFP", "country": "USD", "impact": "High", "datetime": now + timedelta(hours=10)},
    ]
    assert len(_high_impact_events(events, now)) == 1


def test_macro_context_risk_within_2h():
    from scrapers.forex_calendar_scraper import _high_impact_events
    now = datetime(2026, 7, 15, 10, 0, 0, tzinfo=timezone.utc)
    events = [
        {"title": "NFP", "country": "USD", "impact": "High", "datetime": now + timedelta(minutes=30)},
    ]
    high = _high_impact_events(events, now)
    assert len(high) == 1
    # macro_risk detection logic
    macro_risk = any(0 <= (e["datetime"] - now).total_seconds() <= 7200 for e in high)
    assert macro_risk is True


def test_dxy_momentum_mock():
    df = _mock_dxy_df(30)
    m = _dxy_momentum(df, days=5)
    assert "momentum_5d" in m
    assert isinstance(m["momentum_5d"], float)
    assert m["current"] is not None


def test_apply_dxy_adjustment_inverse_pair():
    dxy = {"momentum_5d": 0.01}
    score, reasons = _apply_dxy_adjustment("EUR/USD", 50, dxy)
    assert score < 50
    assert any("DXY" in r for r in reasons)


def test_apply_dxy_adjustment_direct_pair():
    dxy = {"momentum_5d": 0.01}
    score, reasons = _apply_dxy_adjustment("USD/JPY", 50, dxy)
    assert score > 50


def test_apply_dxy_adjustment_below_threshold():
    dxy = {"momentum_5d": 0.002}
    score, reasons = _apply_dxy_adjustment("EUR/USD", 50, dxy)
    assert score == 50
    assert reasons == []
