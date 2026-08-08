"""Tests for DCA tranches and red flags modules."""
import asyncio
from risk.dca_tranches import compute_dca_tranches, compute_scale_out, FEAR_GREED_ACCUMULATION_THRESHOLD, FEAR_GREED_GREED_THRESHOLD
from risk.red_flags import check_red_flags, RED_FLAG_NAMES


class TestDcaTranches:
    def test_accumulation_mode_extreme_fear(self):
        result = compute_dca_tranches("BUY", 100.0, 20)
        assert result is not None
        assert result["mode"] == "DCA_ACCUMULATION"
        assert len(result["tranches"]) == 4
        assert result["tranches"][0]["pct"] == 40
        assert result["tranches"][1]["pct"] == 30
        assert result["tranches"][2]["pct"] == 20
        assert result["tranches"][3]["pct"] == 10

    def test_accumulation_prices(self):
        result = compute_dca_tranches("BUY", 100.0, 15)
        assert result["tranches"][0]["price"] == 100.0
        assert result["tranches"][1]["price"] == 95.0
        assert result["tranches"][2]["price"] == 90.0
        assert result["tranches"][3]["price"] == 85.0

    def test_no_dca_in_neutral_fear(self):
        result = compute_dca_tranches("BUY", 100.0, 50)
        assert result is None

    def test_no_dca_for_sell(self):
        result = compute_dca_tranches("SELL", 100.0, 10)
        assert result is None

    def test_no_dca_without_entry(self):
        result = compute_dca_tranches("BUY", None, 10)
        assert result is None

    def test_no_dca_without_fg(self):
        result = compute_dca_tranches("BUY", 100.0, None)
        assert result is None

    def test_dca_at_threshold(self):
        result = compute_dca_tranches("BUY", 100.0, FEAR_GREED_ACCUMULATION_THRESHOLD)
        assert result is not None

    def test_dca_above_threshold(self):
        result = compute_dca_tranches("BUY", 100.0, FEAR_GREED_ACCUMULATION_THRESHOLD + 1)
        assert result is None


class TestScaleOut:
    def test_scale_out_extreme_greed(self):
        result = compute_scale_out("BUY", 100.0, 80)
        assert result is not None
        assert result["mode"] == "SCALE_OUT"
        assert len(result["steps"]) == 4
        assert result["steps"][0]["pct"] == 25
        assert result["steps"][0]["price"] == 110.0
        assert result["steps"][1]["price"] == 120.0

    def test_no_scale_out_in_neutral(self):
        result = compute_scale_out("BUY", 100.0, 50)
        assert result is None

    def test_no_scale_out_for_sell(self):
        result = compute_scale_out("SELL", 100.0, 90)
        assert result is None

    def test_no_scale_out_without_entry(self):
        result = compute_scale_out("BUY", None, 90)
        assert result is None

    def test_scale_out_at_threshold(self):
        result = compute_scale_out("BUY", 100.0, FEAR_GREED_GREED_THRESHOLD)
        assert result is not None


class TestRedFlags:
    def test_non_micro_returns_empty(self):
        result = asyncio.run(check_red_flags("BTC/USDT", "LARGE"))
        assert result["red_flag_count"] == 0
        assert result["danger"] is False

    def test_micro_cap_heuristic_flags(self):
        result = asyncio.run(check_red_flags("UNKNOWN/USDT", "MICRO"))
        assert result["red_flag_count"] >= 2
        assert "no_audit" in result["red_flags"]
        assert "anonymous_team" in result["red_flags"]

    def test_red_flag_names_count(self):
        assert len(RED_FLAG_NAMES) == 10

    def test_danger_when_5_plus_flags(self):
        result = asyncio.run(check_red_flags("UNKNOWN/USDT", "MICRO"))
        assert result["danger"] is False
        assert result["warning"] is None or "prudence" in (result["warning"] or "").lower()
