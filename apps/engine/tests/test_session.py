"""Tests for utils/session.py."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime, timezone
from utils.session import get_session_info


def test_london_ny_overlap():
    now = datetime(2026, 7, 15, 14, 0, tzinfo=timezone.utc)
    info = get_session_info(now)
    assert info["overlap"] == "London_New_York"
    assert info["session"] == "London_New_York"
    assert info["hour"] == 14


def test_tokyo_session():
    now = datetime(2026, 7, 15, 3, 0, tzinfo=timezone.utc)
    info = get_session_info(now)
    assert "Tokyo" in info["session"]
    assert info["overlap"] is None


def test_minutes_after_session_open():
    now = datetime(2026, 7, 15, 13, 30, tzinfo=timezone.utc)
    info = get_session_info(now)
    # London opens 07:00 UTC -> 6h30 = 390 minutes
    assert info["minutes_after_session_open"] == 390


def test_weekend_flag():
    saturday = datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)
    assert get_session_info(saturday)["is_weekend"] is True
    monday = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
    assert get_session_info(monday)["is_weekend"] is False
