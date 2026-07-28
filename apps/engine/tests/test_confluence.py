"""Tests for the pattern confluence scorer."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from patterns.confluence import score_pattern_confluence


def test_neutral_direction_returns_base_confidence():
    pattern = {"name": "abcd", "direction": "NEUTRAL", "confidence": 0.6}
    score, tags = score_pattern_confluence(pattern, {}, {})
    assert score == 0.6
    assert tags == []


def test_htf_aligned_boosts_score():
    pattern = {"name": "double_top", "direction": "SELL", "confidence": 0.5, "prz": {"min": 98, "max": 102}}
    pa = {"trend": "BEARISH", "bos": True, "bos_dir": "SELL"}
    smc = {}
    mtf = {"htf_aligned": True, "mtf_aligned": False}
    score, tags = score_pattern_confluence(pattern, pa, smc, mtf_context=mtf)
    assert score > 0.5
    assert "HTF aligned" in tags


def test_bullish_ob_overlap_adds_tag():
    pattern = {
        "name": "abcd", "direction": "BUY", "confidence": 0.5,
        "prz": {"min": 98, "max": 102}, "entry": 100,
    }
    pa = {"trend": "BULLISH"}
    smc = {
        "ob": {
            "near_bullish_ob": {"top": 103, "bottom": 99, "mid": 101},
        },
    }
    score, tags = score_pattern_confluence(pattern, pa, smc)
    assert "Bullish OB in PRZ" in tags
    assert score > 0.5


def test_liquidity_sweep_adds_tag():
    pattern = {
        "name": "double_bottom", "direction": "BUY", "confidence": 0.5,
        "prz": {"min": 88, "max": 92}, "entry": 90,
        "points": {"D": {"price": 90}},
    }
    pa = {}
    smc = {
        "liquidity": {
            "near_eql": {"price": 90, "touches": 3},
        },
    }
    score, tags = score_pattern_confluence(pattern, pa, smc)
    assert "Equal lows liquidity sweep" in tags


def test_counter_trend_htf_penalizes():
    pattern = {"name": "abcd", "direction": "BUY", "confidence": 0.6, "prz": {"min": 98, "max": 102}}
    score, tags = score_pattern_confluence(pattern, {}, {}, mtf_context={"htf_aligned": False})
    assert score < 0.6
    assert "HTF counter-trend" in tags


def test_score_capped_between_zero_and_one():
    pattern = {"name": "abcd", "direction": "BUY", "confidence": 0.95}
    pa = {"trend": "BULLISH", "bos": True, "bos_dir": "BUY", "choch": True}
    smc = {
        "ob": {"near_bullish_ob": {"top": 103, "bottom": 99, "mid": 101}},
        "fvg": {"near_bullish_fvg": {"top": 103, "bottom": 99, "mid": 101}},
        "liquidity": {"near_eql": {"price": 100, "touches": 3}},
    }
    mtf = {"htf_aligned": True, "mtf_aligned": True}
    regime = {"regime": "TRENDING_BULL"}
    score, _ = score_pattern_confluence(pattern, pa, smc, mtf_context=mtf, regime=regime)
    assert 0.0 <= score <= 1.0
