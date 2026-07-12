"""Tests unitaires — Risk Engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from routers.risk import (
    calc_position_size,
    calc_targets,
    regime_risk_adjustment,
    calculate_risk,
    RiskCalcRequest,
)


class TestCalcPositionSize:
    def test_basic_buy_position(self):
        size, risk, cost = calc_position_size(10000, 100, 95, 1.0)
        assert size == pytest.approx(20.0, rel=1e-4)
        assert risk == 100.0
        assert cost == 2000.0

    def test_zero_sl_distance(self):
        size, risk, cost = calc_position_size(10000, 100, 100, 1.0)
        assert size == 0.0
        assert risk == 0.0
        assert cost == 0.0

    def test_sell_position(self):
        size, risk, cost = calc_position_size(10000, 100, 105, 2.0)
        assert size == pytest.approx(40.0, rel=1e-4)
        assert risk == 200.0
        assert cost == 4000.0


class TestCalcTargets:
    def test_buy_targets_with_rr(self):
        tp1, tp2 = calc_targets(100, 95, "BUY", rr1=2.0, rr2=3.0)
        assert tp1 == 110.0
        assert tp2 == 115.0

    def test_sell_targets_with_rr(self):
        tp1, tp2 = calc_targets(100, 105, "SELL", rr1=2.0, rr2=3.0)
        assert tp1 == 90.0
        assert tp2 == 85.0

    def test_buy_targets_with_atr(self):
        tp1, tp2 = calc_targets(100, 95, "BUY", atr=3.0)
        assert tp1 == 106.0
        assert tp2 == 110.5


class TestRegimeRiskAdjustment:
    def test_volatile_reduces_risk(self):
        risk, rr1, rr2, note = regime_risk_adjustment("VOLATILE", 1.0, None)
        assert risk == 0.5
        assert rr1 == 2.0
        assert "VOLATILE" in note

    def test_ranging_reduces_rr(self):
        risk, rr1, rr2, note = regime_risk_adjustment("RANGING", 1.0, None)
        assert risk == 0.75
        assert rr1 == 1.5
        assert rr2 == 2.5

    def test_trending_extends_rr(self):
        risk, rr1, rr2, note = regime_risk_adjustment("TRENDING_BULL", 1.0, None)
        assert risk == 1.0
        assert rr1 == 2.5
        assert rr2 == 4.0

    def test_high_confidence_boosts_risk(self):
        risk, rr1, rr2, note = regime_risk_adjustment("TRENDING_BULL", 1.0, 85)
        assert risk == 1.25
        assert "élevée" in note

    def test_low_confidence_reduces_risk(self):
        risk, rr1, rr2, note = regime_risk_adjustment("TRENDING_BEAR", 1.0, 50)
        assert risk == 0.5
        assert "faible" in note


class TestCalculateRiskEndpoint:
    def test_buy_full_response(self):
        req = RiskCalcRequest(
            capital=10000,
            entry_price=100,
            stop_loss=95,
            direction="BUY",
            risk_pct=1.0,
        )
        resp = calculate_risk(req)
        assert resp.position_size == pytest.approx(20.0, rel=1e-4)
        assert resp.risk_amount == 100.0
        assert resp.take_profit_1 > req.entry_price
        assert resp.take_profit_2 > resp.take_profit_1
        assert resp.risk_reward >= 2.0

    def test_sell_full_response(self):
        req = RiskCalcRequest(
            capital=10000,
            entry_price=100,
            stop_loss=105,
            direction="SELL",
            risk_pct=1.0,
        )
        resp = calculate_risk(req)
        assert resp.position_size == pytest.approx(20.0, rel=1e-4)
        assert resp.take_profit_1 < req.entry_price
        assert resp.take_profit_2 < resp.take_profit_1

    def test_cost_capped_by_capital(self):
        req = RiskCalcRequest(
            capital=1000,
            entry_price=1000,
            stop_loss=999,
            direction="BUY",
            risk_pct=1.0,
        )
        resp = calculate_risk(req)
        assert resp.cost <= req.capital
        assert any("plafonné" in w for w in resp.warnings)

    def test_equal_entry_and_sl_warning(self):
        req = RiskCalcRequest(
            capital=10000,
            entry_price=100,
            stop_loss=100,
            direction="BUY",
            risk_pct=1.0,
        )
        resp = calculate_risk(req)
        assert resp.position_size == 0.0
        assert any("impossible" in w for w in resp.warnings)

    def test_volatile_regime_capital_protection(self):
        req = RiskCalcRequest(
            capital=10000,
            entry_price=100,
            stop_loss=95,
            direction="BUY",
            risk_pct=5.0,
            regime="VOLATILE",
        )
        resp = calculate_risk(req)
        # volatile halves risk, then cap 3% -> 2.5
        assert resp.risk_pct_actual <= 3.0
