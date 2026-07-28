"""Tests for the Probability Engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from routers.probability import (
    direction_engine,
    trade_quality_probability,
    entry_zone,
    tp_targets,
    trailing_sl,
    continuation_score,
)


def test_direction_engine_all_bullish():
    scores = [1.0, 0.9, 1.0, 0.95, 1.0]
    assert direction_engine(scores) > 75


def test_direction_engine_mixed():
    scores = [0.6, -0.5, 0.3, -0.4, 0.1]
    prob = direction_engine(scores)
    assert 45 <= prob <= 55


def test_trade_quality_rejected_low_rr():
    res = trade_quality_probability(direction_prob=78, rr=0.8)
    assert res["quality"] < 50
    assert res["status"] == "REJECTED"


def test_trade_quality_accepted_high_rr():
    res = trade_quality_probability(direction_prob=65, rr=4.0)
    assert res["quality"] > 60
    assert res["status"] == "ACCEPTED"


def test_entry_zone_coherent():
    ob = {"min": 100.0, "max": 102.0}
    fvg = {"min": 101.0, "max": 103.0}
    res = entry_zone(101.5, ob, fvg)
    assert res["coherent"] is True
    assert res["contradiction"] is False
    assert res["overlap"]["min"] == 101.0
    assert res["overlap"]["max"] == 102.0


def test_entry_zone_contradiction():
    ob = {"min": 100.0, "max": 101.0}
    fvg = {"min": 102.0, "max": 103.0}
    res = entry_zone(102.5, ob, fvg)
    assert res["coherent"] is False
    assert res["contradiction"] is True


def test_tp_targets_structure():
    tps = tp_targets(entry=100.0, stop_loss=95.0, direction="BUY")
    assert len(tps) == 3
    assert all("price" in tp and "rr" in tp and "probability" in tp for tp in tps)


def test_tp_targets_probability_decreases():
    tps = tp_targets(entry=100.0, stop_loss=96.0, direction="BUY")
    assert tps[0]["probability"] > tps[1]["probability"] > tps[2]["probability"]


def test_trailing_sl_updates_buy():
    sl = trailing_sl(new_structure=110.0, current_sl=100.0, direction="BUY")
    assert sl > 100.0
    assert sl < 110.0


def test_trailing_sl_does_not_worsen_buy():
    sl = trailing_sl(new_structure=90.0, current_sl=100.0, direction="BUY")
    assert sl == 100.0


def test_trailing_sl_updates_sell():
    sl = trailing_sl(new_structure=90.0, current_sl=100.0, direction="SELL")
    assert sl < 100.0
    assert sl > 90.0


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


def test_direction_engine_empty_returns_neutral():
    assert direction_engine([]) == 50.0


def test_trade_quality_rejects_zero_rr():
    res = trade_quality_probability(direction_prob=80, rr=0)
    assert res["quality"] == 0
    assert res["status"] == "REJECTED"


def test_tp_targets_invalid_direction_raises():
    with pytest.raises(ValueError):
        tp_targets(entry=100.0, stop_loss=95.0, direction="NEUTRAL")


def test_tp_targets_sell_prices_decrease():
    tps = tp_targets(entry=100.0, stop_loss=105.0, direction="SELL")
    assert tps[0]["price"] > tps[1]["price"] > tps[2]["price"]


def test_trailing_sl_updates_sell_and_worsening_ignored():
    sl = trailing_sl(new_structure=92.0, current_sl=100.0, direction="SELL")
    assert sl < 100.0
    assert sl > 92.0

    unchanged = trailing_sl(new_structure=110.0, current_sl=100.0, direction="SELL")
    assert unchanged == 100.0


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
