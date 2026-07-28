"""Tests for profile-aware risk sizing."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.risk import profile_risk_adjustment, regime_risk_adjustment


def test_profile_conservative_reduces_risk():
    risk, rr1, rr2, note = profile_risk_adjustment("conservative", 1.0, 2.0, 3.0)
    assert risk <= 1.0
    assert "conservateur" in note.lower()
    assert rr1 < 2.0
    assert rr2 < 3.0


def test_profile_aggressive_increases_risk():
    risk, rr1, rr2, note = profile_risk_adjustment("aggressive", 1.0, 2.0, 3.0)
    assert risk >= 1.0
    assert risk <= 5.0
    assert "agressif" in note.lower()
    assert rr1 > 2.0
    assert rr2 > 3.0


def test_profile_moderate_defaults():
    risk, rr1, rr2, note = profile_risk_adjustment("moderate", 1.0, 2.0, 3.0)
    assert risk == 1.0
    assert rr1 == 2.0
    assert rr2 == 3.0
    assert "modéré" in note.lower()


def test_profile_case_insensitive_and_unknown():
    risk, rr1, rr2, _ = profile_risk_adjustment("CONSERVATIVE", 2.0, 2.0, 3.0)
    assert risk <= 1.0  # capped conservative
    risk2, _, _, _ = profile_risk_adjustment(None, 2.0, 2.0, 3.0)
    assert risk2 == 2.0  # unknown => moderate path caps at 3.0


def test_end_to_end_risk_with_profile():
    # Simulate a trending regime then conservative profile
    base_risk, rr1, rr2, _ = regime_risk_adjustment("TRENDING_BULL", 1.0, None)
    assert rr1 == 2.5  # trending extends R/R
    risk, rr1_p, rr2_p, note = profile_risk_adjustment("conservative", base_risk, rr1, rr2)
    assert risk < base_risk
    assert rr1_p < rr1
    assert "conservateur" in note
