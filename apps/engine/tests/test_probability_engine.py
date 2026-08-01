"""Tests for the Probability Engine — continuation_score only (other functions removed as dead code)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from routers.probability import continuation_score


def test_continuation_score_trailing():
    res = continuation_score(
        direction="BUY",
        price=105.0,
        entry=100.0,
        tp1=104.0,
        tp2=108.0,
        adx=45,
        structure_intact=True,
        volume_increasing=True,
        divergence_htf=False,
    )
    assert res["score"] > 70
    assert res["action"] == "ACTIVATE_TRAILING"
    assert res["tp2_valid"] is True


def test_continuation_score_exhausted_by_divergence():
    res = continuation_score(
        direction="BUY",
        price=105.0,
        entry=100.0,
        tp1=104.0,
        tp2=108.0,
        adx=45,
        structure_intact=True,
        volume_increasing=True,
        divergence_htf=True,
    )
    assert res["action"] == "EXHAUSTED"
    assert res["tp2_valid"] is False


def test_continuation_score_break_even_weak_structure():
    res = continuation_score(
        direction="BUY",
        price=105.0,
        entry=100.0,
        tp1=104.0,
        tp2=108.0,
        adx=20,
        structure_intact=False,
        volume_increasing=False,
        divergence_htf=False,
    )
    assert res["action"] == "MOVE_TO_BREAK_EVEN"


def test_continuation_score_sell_direction():
    res = continuation_score(
        direction="SELL",
        price=95.0,
        entry=100.0,
        tp1=96.0,
        tp2=92.0,
        adx=50,
        structure_intact=True,
        volume_increasing=True,
        divergence_htf=False,
    )
    assert res["progress"] >= 1.0
    assert res["action"] == "ACTIVATE_TRAILING"


def test_continuation_score_invalid_direction_raises():
    with pytest.raises(ValueError):
        continuation_score(
            direction="NEUTRAL",
            price=105.0,
            entry=100.0,
            tp1=104.0,
            tp2=108.0,
            adx=45,
            structure_intact=True,
            volume_increasing=True,
            divergence_htf=False,
        )
