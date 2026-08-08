"""Tests for risk level classification, market cap tier, and liquidity score."""
from risk.market_cap import get_market_cap_tier_sync, _tier_from_mcap
from risk.liquidity import estimate_liquidity_score_sync
from risk.risk_level import compute_risk_level, get_max_position_pct


class TestTierFromMcap:
    def test_micro(self):
        assert _tier_from_mcap(10_000_000) == "MICRO"

    def test_small(self):
        assert _tier_from_mcap(100_000_000) == "SMALL"

    def test_mid(self):
        assert _tier_from_mcap(1_000_000_000) == "MID"

    def test_large(self):
        assert _tier_from_mcap(50_000_000_000) == "LARGE"

    def test_boundary_micro_small(self):
        assert _tier_from_mcap(49_999_999) == "MICRO"
        assert _tier_from_mcap(50_000_000) == "SMALL"

    def test_boundary_small_mid(self):
        assert _tier_from_mcap(499_999_999) == "SMALL"
        assert _tier_from_mcap(500_000_000) == "MID"

    def test_boundary_mid_large(self):
        assert _tier_from_mcap(9_999_999_999) == "MID"
        assert _tier_from_mcap(10_000_000_000) == "LARGE"


class TestGetMarketCapTierSync:
    def test_btc_is_large(self):
        assert get_market_cap_tier_sync("BTC/USDT", "CRYPTO") == "LARGE"

    def test_eth_is_large(self):
        assert get_market_cap_tier_sync("ETH/USDT", "CRYPTO") == "LARGE"

    def test_unknown_crypto_defaults_mid(self):
        assert get_market_cap_tier_sync("UNKNOWN/USDT", "CRYPTO") == "MID"

    def test_forex_is_large(self):
        assert get_market_cap_tier_sync("EUR/USD", "FOREX") == "LARGE"

    def test_brvm_is_small(self):
        assert get_market_cap_tier_sync("ONTBF", "BRVM") == "SMALL"

    def test_synthetic_is_large(self):
        assert get_market_cap_tier_sync("V75", "SYNTHETIC") == "LARGE"


class TestEstimateLiquiditySync:
    def test_forex_default(self):
        result = estimate_liquidity_score_sync("EUR/USD", "FOREX")
        assert result["score"] == 75.0
        assert result["warning"] is None

    def test_brvm_low_liquidity(self):
        result = estimate_liquidity_score_sync("ONTBF", "BRVM")
        assert result["score"] < 30
        assert result["warning"] is not None

    def test_synthetic_moderate(self):
        result = estimate_liquidity_score_sync("V75", "SYNTHETIC")
        assert result["score"] == 70.0

    def test_crypto_no_data(self):
        result = estimate_liquidity_score_sync("UNKNOWN/USDT", "CRYPTO")
        assert 0 <= result["score"] <= 100


class TestComputeRiskLevel:
    def test_micro_cap_low_liquidity_extreme(self):
        result = compute_risk_level("CRYPTO", "MICRO", 25.0, 10.0)
        assert result["risk_level"] == "EXTREME"
        assert "Micro-cap" in result["reasons"][0]

    def test_micro_cap_high_volatility_extreme(self):
        result = compute_risk_level("CRYPTO", "MICRO", 50.0, 25.0)
        assert result["risk_level"] == "EXTREME"

    def test_micro_cap_normal_high(self):
        result = compute_risk_level("CRYPTO", "MICRO", 60.0, 10.0)
        assert result["risk_level"] == "HIGH"

    def test_small_cap_high(self):
        result = compute_risk_level("CRYPTO", "SMALL", 60.0, 10.0)
        assert result["risk_level"] == "HIGH"

    def test_mid_cap_moderate(self):
        result = compute_risk_level("CRYPTO", "MID", 60.0, 8.0)
        assert result["risk_level"] == "MODERATE"

    def test_large_cap_low(self):
        result = compute_risk_level("CRYPTO", "LARGE", 80.0, 5.0)
        assert result["risk_level"] == "LOW"

    def test_large_cap_low_liquidity_high(self):
        result = compute_risk_level("CRYPTO", "LARGE", 25.0, 5.0)
        assert result["risk_level"] == "HIGH"

    def test_forex_low(self):
        result = compute_risk_level("FOREX", "LARGE", 80.0, 2.0)
        assert result["risk_level"] == "LOW"

    def test_forex_low_liquidity_high(self):
        result = compute_risk_level("FOREX", "LARGE", 25.0, 2.0)
        assert result["risk_level"] == "HIGH"

    def test_brvm_moderate_or_high(self):
        result = compute_risk_level("BRVM", "SMALL", 50.0, 3.0)
        assert result["risk_level"] == "MODERATE"

    def test_brvm_low_liquidity_high(self):
        result = compute_risk_level("BRVM", "SMALL", 20.0, 3.0)
        assert result["risk_level"] == "HIGH"

    def test_synthetic_extreme_volatility(self):
        result = compute_risk_level("SYNTHETIC", "LARGE", 70.0, 20.0)
        assert result["risk_level"] == "EXTREME"

    def test_synthetic_moderate(self):
        result = compute_risk_level("SYNTHETIC", "LARGE", 70.0, 5.0)
        assert result["risk_level"] == "MODERATE"


class TestGetMaxPositionPct:
    def test_extreme(self):
        assert get_max_position_pct("EXTREME") == 0.01

    def test_high(self):
        assert get_max_position_pct("HIGH") == 0.02

    def test_moderate(self):
        assert get_max_position_pct("MODERATE") == 0.05

    def test_low(self):
        assert get_max_position_pct("LOW") == 0.10

    def test_unknown_defaults(self):
        assert get_max_position_pct("UNKNOWN") == 0.02
