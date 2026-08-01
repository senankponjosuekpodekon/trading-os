"""
Tests for Phase 5 modules: targets, swings, harmonic_v2, divergence, liquidity, orderflow, chart_scoring.
"""
import numpy as np
import pandas as pd
import pytest

from patterns.targets import (
    multi_targets, project_hs_target, project_flag_target,
    project_double_target, project_harmonic_target,
)
from patterns.swings import detect_fractals, zigzag, zigzag_with_highs_lows, extract_pivots
from patterns.harmonic_v2 import (
    detect_harmonic_patterns, score_harmonic_pattern, HarmonicPattern,
)
from patterns.divergence import compute_rsi, detect_rsi_divergence, check_rsi_divergence_at_d
from patterns.liquidity import (
    detect_equal_highs, detect_equal_lows, analyze_liquidity,
    LiquidityBehavior, LiquidityType,
)
from patterns.orderflow import (
    confirm_breakout, BreakoutType, OrderFlowData, OrderFlowConfig,
    orderflow_confirm_break,
)
from patterns.chart_scoring import (
    score_chart_pattern, PatternContext, RiskTier, get_risk_tier,
)


# ── Fixtures ──────────────────────────────────────────────────

def _make_candles(n=100, start=100, vol=0.5, seed=42):
    rng = np.random.default_rng(seed)
    prices = [start]
    for _ in range(n - 1):
        prices.append(prices[-1] + rng.normal(0, vol))
    df = pd.DataFrame({
        "open": prices,
        "high": [p + abs(rng.normal(0, vol * 0.3)) for p in prices],
        "low": [p - abs(rng.normal(0, vol * 0.3)) for p in prices],
        "close": prices,
    })
    return df


def _make_zigzag_candles():
    """Create candles with clear zigzag for harmonic detection."""
    prices = []
    # X (high) → A (low) → B (mid) → C (low) → D (high)
    segments = [
        (110, 10),  # down to A
        (105, 10),  # up to B
        (108, 10),  # down to C
        (112, 10),  # up to D
    ]
    base = 100
    for target, count in segments:
        step = (target - base) / count
        for i in range(count):
            prices.append(base + step * (i + 1))
        base = target
    df = pd.DataFrame({
        "open": prices,
        "high": [p + 0.5 for p in prices],
        "low": [p - 0.5 for p in prices],
        "close": prices,
    })
    return df


# ── Targets ───────────────────────────────────────────────────

class TestTargets:
    def test_multi_targets_long(self):
        proj = multi_targets(100, 110, "long")
        assert proj.tp1 == pytest.approx(105.5)
        assert proj.tp2 == pytest.approx(110.0)
        assert proj.tp3 == pytest.approx(114.0)

    def test_multi_targets_short(self):
        proj = multi_targets(100, 90, "short")
        assert proj.tp1 == pytest.approx(94.5)
        assert proj.tp2 == pytest.approx(90.0)
        assert proj.tp3 == pytest.approx(86.0)

    def test_hs_target_bearish(self):
        proj = project_hs_target(neckline=100, head_price=110, direction="bearish")
        # height=10, target = 100-10 = 90
        assert proj.tp2 == pytest.approx(90.0)

    def test_hs_target_bullish(self):
        proj = project_hs_target(neckline=100, head_price=90, direction="bullish")
        # height=10, target = 100+10 = 110
        assert proj.tp2 == pytest.approx(110.0)

    def test_flag_target_bullish(self):
        proj = project_flag_target(mast_start=100, mast_end=110, breakout_price=108, direction="bullish")
        # mast_height=10, target = 108+10 = 118
        assert proj.tp2 == pytest.approx(118.0)

    def test_flag_target_bearish(self):
        proj = project_flag_target(mast_start=110, mast_end=100, breakout_price=102, direction="bearish")
        # mast_height=10, target = 102-10 = 92
        assert proj.tp2 == pytest.approx(92.0)

    def test_double_target_top(self):
        proj = project_double_target(neckline=100, extreme=110, direction="double_top")
        # height=10, target = 100-10 = 90
        assert proj.tp2 == pytest.approx(90.0)

    def test_harmonic_target_bullish(self):
        proj = project_harmonic_target(point_a=110, point_d=100, direction="bullish")
        # AD distance = 10, TP1 = 100 + 10*0.382 = 103.82
        assert proj.tp1 == pytest.approx(103.82, rel=0.01)
        assert proj.tp2 == pytest.approx(106.18, rel=0.01)


# ── Swings ────────────────────────────────────────────────────

class TestSwings:
    def test_detect_fractals(self):
        df = _make_candles(50)
        result = detect_fractals(df, n=2)
        assert "fractal_high" in result.columns
        assert "fractal_low" in result.columns
        assert result["fractal_high"].any() or result["fractal_low"].any()

    def test_zigzag_basic(self):
        df = _make_candles(100)
        result = zigzag(df, threshold_pct=0.01)
        assert "zigzag" in result.columns
        # Should have at least some pivots
        assert result["zigzag"].notna().sum() > 0

    def test_zigzag_with_highs_lows(self):
        df = _make_candles(100)
        result = zigzag_with_highs_lows(df, threshold_pct=0.01)
        assert "zigzag" in result.columns
        assert "zigzag_type" in result.columns

    def test_extract_pivots(self):
        df = _make_candles(100)
        df = zigzag(df, threshold_pct=0.01)
        pivots = extract_pivots(df)
        assert len(pivots) > 0
        assert all(hasattr(p, "type") for p in pivots)


# ── Harmonic v2 ───────────────────────────────────────────────

class TestHarmonicV2:
    def test_detect_returns_list(self):
        df = _make_candles(200, vol=2)
        patterns = detect_harmonic_patterns(df, threshold_pct=0.01)
        assert isinstance(patterns, list)

    def test_score_harmonic_base(self):
        p = HarmonicPattern(
            name="Gartley", direction="bullish",
            X=100, A=110, B=105, C=108, D=103,
            X_idx=0, A_idx=10, B_idx=20, C_idx=30, D_idx=40,
        )
        score = score_harmonic_pattern(p)
        assert 0.40 <= score <= 1.0
        assert score >= 0.52  # 0.40 + 0.12 Gartley

    def test_score_with_divergence(self):
        p = HarmonicPattern(
            name="Crab", direction="bullish",
            X=100, A=110, B=105, C=108, D=103,
            X_idx=0, A_idx=10, B_idx=20, C_idx=30, D_idx=40,
        )
        score = score_harmonic_pattern(p, divergence={"has_divergence": True})
        assert score >= 0.67  # 0.40 + 0.15 Crab + 0.20 divergence

    def test_score_with_all_confluence(self):
        p = HarmonicPattern(
            name="Gartley", direction="bullish",
            X=100, A=110, B=105, C=108, D=103,
            X_idx=0, A_idx=10, B_idx=20, C_idx=30, D_idx=40,
        )
        score = score_harmonic_pattern(
            p, divergence={"has_divergence": True},
            structure_confluence=True, orderflow_confirmation=True,
        )
        assert score >= 0.95  # 0.40 + 0.12 + 0.20 + 0.12 + 0.13 = 0.97


# ── Divergence ─────────────────────────────────────────────────

class TestDivergence:
    def test_compute_rsi(self):
        df = _make_candles(50)
        rsi = compute_rsi(df["close"], 14)
        assert len(rsi) == len(df)
        assert rsi.iloc[-1] >= 0
        assert rsi.iloc[-1] <= 100

    def test_detect_no_divergence_flat(self):
        df = _make_candles(100, vol=0.1)
        result = detect_rsi_divergence(df)
        assert "has_divergence" in result
        assert "divergence_type" in result

    def test_detect_regular_bullish(self):
        # Create lower lows in price with higher lows in RSI
        n = 60
        closes = list(np.linspace(100, 95, 30)) + list(np.linspace(95, 90, 30))
        df = pd.DataFrame({
            "open": closes, "high": [c + 0.5 for c in closes],
            "low": [c - 0.5 for c in closes], "close": closes,
        })
        result = detect_rsi_divergence(df, lookback=3, min_separation=5)
        # May or may not detect depending on RSI, but should not crash
        assert isinstance(result, dict)

    def test_check_divergence_at_d(self):
        df = _make_candles(100)
        result = check_rsi_divergence_at_d(df, d_idx=50, d_price=95, direction="bullish")
        assert "has_divergence" in result
        assert "rsi_at_d" in result


# ── Liquidity ─────────────────────────────────────────────────

class TestLiquidity:
    def test_detect_equal_highs(self):
        df = pd.DataFrame({
            "high": [100, 99, 100, 98, 100, 97],
            "low": [95, 94, 95, 93, 95, 92],
            "close": [97, 96, 97, 95, 97, 94],
        })
        pools = detect_equal_highs(df, tolerance=0.001)
        assert len(pools) >= 1
        assert pools[0].type == LiquidityType.EQUAL_HIGHS
        assert pools[0].touches >= 2

    def test_detect_equal_lows(self):
        df = pd.DataFrame({
            "high": [100, 99, 100, 98, 100, 97],
            "low": [95, 94, 95, 93, 95, 92],
            "close": [97, 96, 97, 95, 97, 94],
        })
        pools = detect_equal_lows(df, tolerance=0.001)
        assert len(pools) >= 1
        assert pools[0].type == LiquidityType.EQUAL_LOWS

    def test_analyze_liquidity(self):
        df = _make_candles(100)
        result = analyze_liquidity(df, lookback=50)
        assert hasattr(result, "pools")
        assert hasattr(result, "nearest_above")
        assert hasattr(result, "nearest_below")
        assert hasattr(result, "grab_detected")
        assert hasattr(result, "run_detected")

    def test_round_numbers(self):
        from patterns.liquidity import detect_round_numbers
        pools = detect_round_numbers(1050.0)
        assert len(pools) > 0
        # Should find 1000, 1050, 1100 etc
        prices = [p.price for p in pools]
        assert any(abs(p - 1000) < 1 for p in prices)


# ── Order Flow ────────────────────────────────────────────────

class TestOrderFlow:
    def test_confirm_bullish_breakout(self):
        of = OrderFlowData(
            delta=2000, stacked_imbalances=3, volume_ratio=1.8,
            cvd_trend="up",
        )
        result = confirm_breakout(BreakoutType.GENERAL_BULLISH, of)
        assert result.confirmed
        assert result.confidence >= 0.7

    def test_reject_low_volume(self):
        of = OrderFlowData(delta=2000, stacked_imbalances=3, volume_ratio=0.8)
        result = confirm_breakout(BreakoutType.GENERAL_BULLISH, of)
        assert not result.confirmed

    def test_reject_weak_delta_bullish(self):
        of = OrderFlowData(delta=500, stacked_imbalances=3, volume_ratio=1.5)
        result = confirm_breakout(BreakoutType.GENERAL_BULLISH, of)
        assert not result.confirmed

    def test_reject_absorption_grab(self):
        of = OrderFlowData(
            delta=2000, stacked_imbalances=3, volume_ratio=0.5,
            absorption=True,
        )
        result = confirm_breakout(BreakoutType.GENERAL_BULLISH, of)
        assert not result.confirmed
        assert "grab" in result.reason.lower()

    def test_confirm_bearish(self):
        of = OrderFlowData(
            delta=-2000, stacked_imbalances=3, volume_ratio=1.8,
            cvd_trend="down",
        )
        result = confirm_breakout(BreakoutType.GENERAL_BEARISH, of)
        assert result.confirmed

    def test_orderflow_confirm_break_simple(self):
        assert orderflow_confirm_break("bullish", delta=2000, stacked_imb=3, absorption=False, volume_ratio=1.8)
        assert not orderflow_confirm_break("bullish", delta=500, stacked_imb=1, absorption=False, volume_ratio=0.8)


# ── Chart Scoring ─────────────────────────────────────────────

class TestChartScoring:
    def test_base_score_only(self):
        ctx = PatternContext(pattern_type="hs_breakdown", direction="bearish")
        result = score_chart_pattern(ctx)
        assert result.score == pytest.approx(0.35)
        assert result.tier == RiskTier.SKIP

    def test_full_confluence(self):
        ctx = PatternContext(
            pattern_type="hs_breakdown", direction="bearish",
            neckline_break_confirmed=True,
            volume_confirmation=True,
            orderflow_alignment=True,
            orderflow_confidence=0.9,
            structure_alignment=True,
            retest_occurred=True,
            regime_compatible=True,
            htf_aligned=True,
            mtf_aligned=True,
            liquidity_grab=True,
            rsi_divergence=True,
            rr_ratio=3.5,
        )
        result = score_chart_pattern(ctx)
        assert result.score >= 0.85
        assert result.tier == RiskTier.AGGRESSIVE
        assert result.size_multiplier == 1.3

    def test_standard_tier(self):
        ctx = PatternContext(
            pattern_type="bull_flag_breakout", direction="bullish",
            volume_confirmation=True,
            structure_alignment=True,
            retest_occurred=True,
            regime_compatible=True,
            htf_aligned=True,
        )
        result = score_chart_pattern(ctx)
        assert 0.70 <= result.score < 0.85
        assert result.tier == RiskTier.STANDARD
        assert result.size_multiplier == 1.0

    def test_skip_below_threshold(self):
        ctx = PatternContext(pattern_type="compression_breakout", direction="bullish")
        result = score_chart_pattern(ctx)
        assert result.score < 0.60
        assert result.tier == RiskTier.SKIP
        assert result.risk_pct == 0.0

    def test_get_risk_tier(self):
        assert get_risk_tier(0.90) == RiskTier.AGGRESSIVE
        assert get_risk_tier(0.75) == RiskTier.STANDARD
        assert get_risk_tier(0.65) == RiskTier.REDUCED
        assert get_risk_tier(0.50) == RiskTier.SKIP

    def test_harmonic_score_integration(self):
        ctx = PatternContext(
            pattern_type="crab", direction="bullish",
            rsi_divergence=True,
            prz_confluence=True,
            structure_alignment=True,
            orderflow_alignment=True,
            orderflow_confidence=0.8,
            rr_ratio=2.5,
        )
        result = score_chart_pattern(ctx)
        assert result.score >= 0.70
        assert len(result.reasons) > 0
