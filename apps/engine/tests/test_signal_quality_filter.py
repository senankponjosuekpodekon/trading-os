"""
Unit tests for the 17-layer signal quality filter.
Covers each layer individually + integration test for apply_quality_gate.
"""
import pandas as pd
import numpy as np
from datetime import datetime, timezone

from risk.signal_quality_filter import (
    apply_quality_gate,
    get_quality_size_multiplier,
    _check_session,
    _check_liquidity,
    _check_volume_gate,
    _check_spread_vs_tp,
    _check_event_freeze,
    _check_extreme_regime,
    _check_wick_body,
    _check_vwap,
    _check_cvd_obv_divergence,
    _check_seasonal,
    _check_funding_rate,
    _check_dxy_macro,
    _check_correlation_breakdown,
    _check_vol_term_structure,
)


def _make_df(n=120, seed=42):
    """Generate a realistic OHLCV dataframe."""
    rng = np.random.RandomState(seed)
    base = 100.0
    closes = base + np.cumsum(rng.randn(n) * 0.5)
    opens = closes - rng.randn(n) * 0.2
    highs = np.maximum(opens, closes) + rng.rand(n) * 0.3
    lows = np.minimum(opens, closes) - rng.rand(n) * 0.3
    volumes = 1000 + rng.rand(n) * 500
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows,
        "close": closes, "volume": volumes,
    })


# ── Layer 2: Session/timing ──────────────────────────────────────────
class TestSessionFilter:
    def test_crypto_always_passes(self):
        result = _check_session("CRYPTO", {"hour": 3, "is_weekend": True})
        assert result["passed"] is True

    def test_forex_weekend_blocked(self):
        result = _check_session("FOREX", {"hour": 12, "is_weekend": True})
        assert result["passed"] is False
        assert "Weekend" in result["reason"]

    def test_forex_off_session_blocked(self):
        result = _check_session("FOREX", {"hour": 21, "is_weekend": False})
        assert result["passed"] is False

    def test_forex_optimal_session_no_penalty(self):
        result = _check_session("FOREX", {"hour": 10, "is_weekend": False})
        assert result["passed"] is True
        assert result.get("session_penalty", 0) == 0

    def test_brvm_off_session_blocked(self):
        result = _check_session("BRVM", {"hour": 3, "is_weekend": False})
        assert result["passed"] is False

    def test_brvm_optimal_session(self):
        result = _check_session("BRVM", {"hour": 11, "is_weekend": False})
        assert result["passed"] is True
        assert result.get("in_optimal") is True


# ── Layer 3: Liquidity gate ──────────────────────────────────────────
class TestLiquidityGate:
    def test_below_threshold_rejected(self):
        result = _check_liquidity("CRYPTO", {"score": 10.0})
        assert result["passed"] is False

    def test_above_threshold_passes(self):
        result = _check_liquidity("CRYPTO", {"score": 50.0})
        assert result["passed"] is True

    def test_forex_higher_threshold(self):
        result = _check_liquidity("FOREX", {"score": 30.0})
        assert result["passed"] is False
        result2 = _check_liquidity("FOREX", {"score": 60.0})
        assert result2["passed"] is True

    def test_none_liquidity_passes(self):
        result = _check_liquidity("CRYPTO", None)
        assert result["passed"] is True


# ── Layer 3b: Volume gate ────────────────────────────────────────────
class TestVolumeGate:
    def test_low_volume_rejected(self):
        df = _make_df()
        df.loc[df.index[-1], "volume"] = 10
        result = _check_volume_gate(df, "BUY", "CRYPTO", "BTC/USDT")
        assert result["passed"] is False

    def test_normal_volume_passes(self):
        df = _make_df()
        result = _check_volume_gate(df, "BUY", "CRYPTO", "BTC/USDT")
        assert result["passed"] is True

    def test_brvm_lower_threshold(self):
        df = _make_df(n=60)
        df.loc[df.index[-1], "volume"] = 600
        result = _check_volume_gate(df, "BUY", "BRVM", "ABC")
        assert result["passed"] is True

    def test_none_df_passes(self):
        result = _check_volume_gate(None, "BUY", "CRYPTO", "BTC/USDT")
        assert result["passed"] is True


# ── Layer 6: Spread vs TP ────────────────────────────────────────────
class TestSpreadFilter:
    def test_non_crypto_passes(self):
        result = _check_spread_vs_tp("FOREX", {"spread_score": 5}, 1.10, 1.12)
        assert result["passed"] is True

    def test_spread_too_large_rejected(self):
        result = _check_spread_vs_tp("CRYPTO", {"spread_score": 0}, 100, 101)
        assert result["passed"] is False

    def test_spread_ok(self):
        result = _check_spread_vs_tp("CRYPTO", {"spread_score": 30}, 100, 110)
        assert result["passed"] is True


# ── Layer 7: Event freeze ────────────────────────────────────────────
class TestEventFreeze:
    def test_macro_risk_blocks(self):
        ctx = {"macro_risk": True, "next_event": {"title": "NFP"}}
        result = _check_event_freeze(ctx)
        assert result["passed"] is False
        assert "NFP" in result["reason"]

    def test_post_news_penalty(self):
        ctx = {"macro_risk": False, "post_news_volatility": True}
        result = _check_event_freeze(ctx)
        assert result["passed"] is True
        assert result.get("post_news_penalty", 0) > 0

    def test_no_context_passes(self):
        result = _check_event_freeze(None)
        assert result["passed"] is True


# ── Layer 8: Extreme regime ──────────────────────────────────────────
class TestExtremeRegime:
    def test_extreme_vol_with_volatile_regime_blocks(self):
        df = _make_df(n=120)
        df.loc[df.index[-1], "close"] = df["close"].iloc[-2] * 1.15
        regime = {"regime": "VOLATILE"}
        result = _check_extreme_regime(df, None, regime)
        assert result["passed"] is False

    def test_normal_vol_passes(self):
        df = _make_df()
        result = _check_extreme_regime(df, None, {"regime": "TREND"})
        assert result["passed"] is True

    def test_short_df_passes(self):
        df = _make_df(n=50)
        result = _check_extreme_regime(df, None, None)
        assert result["passed"] is True


# ── Layer 9: Wick/body ratio ─────────────────────────────────────────
class TestWickBody:
    def test_buy_with_large_upper_wick_rejected(self):
        df = _make_df(n=5)
        df.loc[df.index[-1], "open"] = 100
        df.loc[df.index[-1], "close"] = 101
        df.loc[df.index[-1], "high"] = 105
        df.loc[df.index[-1], "low"] = 99.5
        result = _check_wick_body(df, "BUY")
        assert result["passed"] is False

    def test_sell_with_large_lower_wick_rejected(self):
        df = _make_df(n=5)
        df.loc[df.index[-1], "open"] = 101
        df.loc[df.index[-1], "close"] = 100
        df.loc[df.index[-1], "high"] = 101.5
        df.loc[df.index[-1], "low"] = 95
        result = _check_wick_body(df, "SELL")
        assert result["passed"] is False

    def test_normal_candle_passes(self):
        df = _make_df()
        result = _check_wick_body(df, "BUY")
        assert result["passed"] is True


# ── Layer 10: VWAP ───────────────────────────────────────────────────
class TestVWAP:
    def test_buy_above_vwap_penalized(self):
        df = _make_df(n=30)
        entry = float(df["close"].iloc[-1]) * 1.05
        result = _check_vwap(df, "BUY", entry)
        assert result["passed"] is True
        assert result.get("vwap_penalty", 0) > 0

    def test_buy_at_vwap_no_penalty(self):
        df = _make_df(n=30)
        entry = float(df["close"].iloc[-1])
        result = _check_vwap(df, "BUY", entry)
        assert result.get("vwap_penalty", 0) == 0


# ── Layer 11: CVD/OBV divergence ─────────────────────────────────────
class TestCvdObvDivergence:
    def test_bullish_divergence_blocks_sell(self):
        # Price generally falling but OBV rising: up-days have much higher volume
        df = _make_df(n=30)
        # Oscillating price with downtrend: 110 → 90 with bounces
        closes = np.array([110,108,109,107,108,106,107,105,106,104,
                           105,103,104,102,103,101,102,100,101,99,
                           100,98,99,97,98,96,97,95,96,94], dtype=float)
        df["close"] = closes
        # Up-days get 10x volume → OBV rises despite downtrend
        vols = []
        for i in range(30):
            if i > 0 and closes[i] > closes[i-1]:
                vols.append(5000)
            else:
                vols.append(500)
        df["volume"] = vols
        result = _check_cvd_obv_divergence(df, "SELL")
        assert result["passed"] is False

    def test_bearish_divergence_blocks_buy(self):
        # Price generally rising but OBV falling: down-days have much higher volume
        df = _make_df(n=30)
        closes = np.array([90,92,91,93,92,94,93,95,94,96,
                           95,97,96,98,97,99,98,100,99,101,
                           100,102,101,103,102,104,103,105,104,106], dtype=float)
        df["close"] = closes
        vols = []
        for i in range(30):
            if i > 0 and closes[i] < closes[i-1]:
                vols.append(5000)
            else:
                vols.append(500)
        df["volume"] = vols
        result = _check_cvd_obv_divergence(df, "BUY")
        assert result["passed"] is False

    def test_aligned_passes(self):
        # Price and OBV both rising → aligned, no divergence
        df = _make_df(n=30)
        closes = np.array([90,92,91,93,92,94,93,95,94,96,
                           95,97,96,98,97,99,98,100,99,101,
                           100,102,101,103,102,104,103,105,104,106], dtype=float)
        df["close"] = closes
        vols = []
        for i in range(30):
            if i > 0 and closes[i] > closes[i-1]:
                vols.append(5000)
            else:
                vols.append(500)
        df["volume"] = vols
        result = _check_cvd_obv_divergence(df, "BUY")
        assert result["passed"] is True


# ── Layer 12: Seasonal cycles ────────────────────────────────────────
class TestSeasonal:
    def test_january_effect(self):
        result = _check_seasonal("CRYPTO", datetime(2025, 1, 3, tzinfo=timezone.utc))
        assert result["passed"] is True
        assert result.get("seasonal_penalty", 0) > 0
        assert any("January" in f for f in result.get("seasonal_flags", []))

    def test_holiday_low_liquidity(self):
        result = _check_seasonal("CRYPTO", datetime(2025, 12, 26, tzinfo=timezone.utc))
        assert result.get("seasonal_penalty", 0) > 0

    def test_normal_day_no_penalty(self):
        result = _check_seasonal("CRYPTO", datetime(2025, 6, 15, tzinfo=timezone.utc))
        assert result.get("seasonal_penalty", 0) == 0


# ── Layer 13: Funding rate ───────────────────────────────────────────
class TestFundingRate:
    def test_extreme_positive_funding_blocks_buy(self):
        ctx = {"funding_rate": {"funding_rate": 0.15}}
        result = _check_funding_rate("CRYPTO", ctx, "BUY")
        assert result["passed"] is False

    def test_extreme_negative_funding_blocks_sell(self):
        ctx = {"funding_rate": {"funding_rate": -0.15}}
        result = _check_funding_rate("CRYPTO", ctx, "SELL")
        assert result["passed"] is False

    def test_normal_funding_passes(self):
        ctx = {"funding_rate": {"funding_rate": 0.01}}
        result = _check_funding_rate("CRYPTO", ctx, "BUY")
        assert result["passed"] is True

    def test_non_crypto_passes(self):
        result = _check_funding_rate("FOREX", {"funding_rate": 0.5}, "BUY")
        assert result["passed"] is True


# ── Layer 14: DXY macro ──────────────────────────────────────────────
class TestDxyMacro:
    def test_dxy_up_penalizes_gold_buy(self):
        result = _check_dxy_macro("GOLD", {"momentum": 0.5}, "BUY")
        assert result["passed"] is True
        assert result.get("dxy_penalty", 0) > 0

    def test_dxy_down_penalizes_gold_sell(self):
        result = _check_dxy_macro("GOLD", {"momentum": -0.5}, "SELL")
        assert result["passed"] is True
        assert result.get("dxy_penalty", 0) > 0

    def test_non_gold_passes(self):
        result = _check_dxy_macro("CRYPTO", {"momentum": 1.0}, "BUY")
        assert result["passed"] is True


# ── Integration: apply_quality_gate ──────────────────────────────────
class TestApplyQualityGate:
    def test_neutral_signal_always_passes(self):
        result = apply_quality_gate("NEUTRAL", "CRYPTO", "BTC/USDT")
        assert result["passed"] is True
        assert result["quality_score"] == 0

    def test_clean_signal_passes(self):
        # Build controlled df: price rising with rising volume (aligned, no divergence)
        n = 120
        rng = np.random.RandomState(99)
        base = 100.0
        closes = base + np.cumsum(np.abs(rng.randn(n)) * 0.1)  # generally rising
        opens = closes - 0.05
        highs = closes + 0.1
        lows = closes - 0.1
        volumes = 1000 + np.arange(n) * 5  # rising volume
        df = pd.DataFrame({
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": volumes,
        })
        entry = float(closes[-1])
        result = apply_quality_gate(
            signal="BUY", asset_type="CRYPTO", symbol="BTC/USDT",
            entry=entry, tp1=entry * 1.05, df=df,
            session_info={"hour": 14, "is_weekend": False},
            liquidity_data={"score": 60, "spread_score": 25},
        )
        if not result["passed"]:
            print(f"Rejected layers: {result['rejected_layers']}")
            print(f"Quality flags: {result['quality_flags']}")
        assert result["passed"] is True
        assert result["quality_score"] > 0
        assert isinstance(result["quality_flags"], list)

    def test_rejected_by_liquidity(self):
        df = _make_df()
        result = apply_quality_gate(
            signal="BUY", asset_type="FOREX", symbol="EUR/USD",
            entry=1.10, tp1=1.12, df=df,
            session_info={"hour": 10, "is_weekend": False},
            liquidity_data={"score": 10},
        )
        assert result["passed"] is False
        assert any("liquidity" in r.get("layer", "") for r in result["rejected_layers"])

    def test_rejected_by_event_freeze(self):
        df = _make_df()
        result = apply_quality_gate(
            signal="BUY", asset_type="CRYPTO", symbol="BTC/USDT",
            entry=100, tp1=105, df=df,
            session_info={"hour": 14, "is_weekend": False},
            liquidity_data={"score": 60},
            news_context={"macro_risk": True, "next_event": {"title": "FOMC"}},
        )
        assert result["passed"] is False

    def test_quality_score_decreases_with_penalties(self):
        df = _make_df()
        clean = apply_quality_gate(
            signal="BUY", asset_type="CRYPTO", symbol="BTC/USDT",
            entry=100, tp1=105, df=df,
            session_info={"hour": 14, "is_weekend": False},
            liquidity_data={"score": 80, "spread_score": 25},
        )
        penalized = apply_quality_gate(
            signal="BUY", asset_type="CRYPTO", symbol="BTC/USDT",
            entry=100, tp1=105, df=df,
            session_info={"hour": 14, "is_weekend": False},
            liquidity_data={"score": 80, "spread_score": 25},
            news_context={"macro_risk": False, "post_news_volatility": True},
        )
        assert penalized["quality_score"] <= clean["quality_score"]


# ── Layer 16: Correlation breakdown ─────────────────────────────────
class TestCorrelationBreakdown:
    def test_insufficient_data_passes(self):
        df = _make_df(n=20)
        result = _check_correlation_breakdown(df, "BUY")
        assert result["passed"] is True

    def test_no_data_passes(self):
        result = _check_correlation_breakdown(None, "BUY")
        assert result["passed"] is True

    def test_external_correlation_breakdown_rejects(self):
        onchain = {"correlation_data": {
            "current_correlation": 0.1,
            "historical_correlation": 0.85,
        }}
        df = _make_df(n=60)
        result = _check_correlation_breakdown(df, "BUY", onchain_context=onchain)
        assert result["passed"] is False
        assert "breakdown" in result["reason"].lower()

    def test_external_correlation_mild_penalty(self):
        onchain = {"correlation_data": {
            "current_correlation": 0.45,
            "historical_correlation": 0.85,
        }}
        df = _make_df(n=60)
        result = _check_correlation_breakdown(df, "BUY", onchain_context=onchain)
        assert result["passed"] is True
        assert result.get("correlation_penalty", 0) > 0

    def test_external_correlation_healthy_passes(self):
        onchain = {"correlation_data": {
            "current_correlation": 0.8,
            "historical_correlation": 0.85,
        }}
        df = _make_df(n=60)
        result = _check_correlation_breakdown(df, "BUY", onchain_context=onchain)
        assert result["passed"] is True
        assert result.get("correlation_penalty", 0) == 0

    def test_autocorr_breakdown_rejects(self):
        """Build a df where prior autocorr is positive but recent flips negative."""
        # Prior: smooth uptrend (high positive autocorr)
        prior_closes = np.linspace(100, 130, 40)
        # Recent: sharp alternating pattern (strong negative autocorr)
        recent_closes = np.array([130, 125, 132, 123, 133, 122, 134, 121,
                                  135, 120, 136, 119, 137, 118, 138, 117,
                                  139, 116, 140, 115, 141, 114, 142, 113,
                                  143, 112, 144, 111, 145, 110], dtype=float)
        closes = np.concatenate([prior_closes, recent_closes])
        n = len(closes)
        df = pd.DataFrame({
            "open": closes - 0.1,
            "high": closes + 0.5,
            "low": closes - 0.5,
            "close": closes,
            "volume": np.full(n, 1000.0),
        })
        result = _check_correlation_breakdown(df, "BUY")
        assert result["passed"] is False


# ── Layer 17: Vol term structure ─────────────────────────────────────
class TestVolTermStructure:
    def test_insufficient_data_passes(self):
        df = _make_df(n=20)
        result = _check_vol_term_structure(df, "BUY")
        assert result["passed"] is True

    def test_no_data_passes(self):
        result = _check_vol_term_structure(None, "BUY")
        assert result["passed"] is True

    def test_normal_vol_passes_no_penalty(self):
        df = _make_df(n=120)
        result = _check_vol_term_structure(df, "BUY")
        assert result["passed"] is True
        assert result.get("vol_term_penalty", 0) == 0

    def test_contango_penalty(self):
        """Short-term vol much higher than long-term → contango penalty."""
        n = 120
        rng = np.random.RandomState(42)
        base = 100.0
        # Long period: low volatility
        long_closes = base + np.cumsum(rng.randn(100) * 0.1)
        # Recent 20 bars: high volatility (spike)
        recent_closes = long_closes[-1] + np.cumsum(rng.randn(20) * 3.0)
        closes = np.concatenate([long_closes, recent_closes])
        df = pd.DataFrame({
            "open": closes - 0.1,
            "high": closes + np.abs(rng.randn(n)) * 0.5,
            "low": closes - np.abs(rng.randn(n)) * 0.5,
            "close": closes,
            "volume": np.full(n, 1000.0),
        })
        # Make recent bars have much wider high-low range
        df.loc[df.index[-20:], "high"] = df.loc[df.index[-20:], "close"] + 5.0
        df.loc[df.index[-20:], "low"] = df.loc[df.index[-20:], "close"] - 5.0
        result = _check_vol_term_structure(df, "BUY")
        assert result["passed"] is True
        assert result.get("vol_term_penalty", 0) > 0
        assert result.get("vol_term_ratio", 0) > 2.0

    def test_backwardation_penalty(self):
        """Short-term vol much lower than long-term → backwardation penalty."""
        n = 120
        rng = np.random.RandomState(42)
        base = 100.0
        # Long period: high volatility
        long_closes = base + np.cumsum(rng.randn(100) * 2.0)
        # Recent 20 bars: very low volatility (flat)
        recent_closes = np.full(20, long_closes[-1])
        closes = np.concatenate([long_closes, recent_closes])
        df = pd.DataFrame({
            "open": closes - 0.1,
            "high": closes + 1.0,
            "low": closes - 1.0,
            "close": closes,
            "volume": np.full(n, 1000.0),
        })
        # Make recent bars have very tight range
        df.loc[df.index[-20:], "high"] = df.loc[df.index[-20:], "close"] + 0.01
        df.loc[df.index[-20:], "low"] = df.loc[df.index[-20:], "close"] - 0.01
        result = _check_vol_term_structure(df, "BUY")
        assert result["passed"] is True
        assert result.get("vol_term_penalty", 0) > 0
        assert result.get("vol_term_ratio", 1.0) < 0.5


# ── Sizing multiplier ────────────────────────────────────────────────
class TestQualitySizeMultiplier:
    def test_high_quality_full_size(self):
        assert get_quality_size_multiplier(85) == 1.0

    def test_good_quality(self):
        assert get_quality_size_multiplier(70) == 0.75

    def test_medium_quality(self):
        assert get_quality_size_multiplier(50) == 0.50

    def test_low_quality(self):
        assert get_quality_size_multiplier(30) == 0.25

    def test_boundary_80(self):
        assert get_quality_size_multiplier(80) == 1.0

    def test_boundary_60(self):
        assert get_quality_size_multiplier(60) == 0.75

    def test_boundary_40(self):
        assert get_quality_size_multiplier(40) == 0.50

    def test_zero(self):
        assert get_quality_size_multiplier(0) == 0.25
