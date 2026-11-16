import math

import pytest

from risk.sizing import (annualize_vol, ewma_vol, gap_test, position_size,
                         sizing_capital)


class TestEwmaVol:
    def test_empty_returns_long_run(self):
        assert ewma_vol([], long_run_vol=0.05) == 0.05

    def test_pure_ewma_without_long_run(self):
        rets = [0.01, -0.01, 0.01, -0.01] * 10
        v = ewma_vol(rets, span=10)
        assert 0 < v <= 0.02

    def test_floor_from_long_run(self):
        # Série quasi calme → la part long terme empêche le sous-dimensionnement
        rets = [0.0001] * 50
        v = ewma_vol(rets, span=10, long_run_vol=0.02, mix=0.7)
        assert v > 0.005  # plancher long terme actif

    def test_annualize(self):
        assert annualize_vol(0.01, 365 * 24) == pytest.approx(0.01 * math.sqrt(8760))


class TestPositionSize:
    # Cas Carver vérifié : 16% vol, notionnel 22 500$ → risque 3 600$/contrat
    def test_carver_case(self):
        # capital 50k, τ=14.4% → budget 7 200$ → 2 contrats
        r = position_size(capital=50_000, target_risk=0.144,
                          price=4500, sigma_annual=0.16, multiplier=5)
        assert r["n"] == pytest.approx(2.0, abs=0.01)
        assert r["risk_usd"] == pytest.approx(7200, rel=0.01)

    def test_forecast_scales_size(self):
        base = position_size(10_000, 0.1, 100, 0.5)
        half = position_size(10_000, 0.1, 100, 0.5, forecast=5)
        neg = position_size(10_000, 0.1, 100, 0.5, forecast=-10)
        assert half["n"] == pytest.approx(base["n"] / 2)
        assert neg["n"] == pytest.approx(-base["n"])

    def test_forecast_clipped(self):
        r = position_size(10_000, 0.1, 100, 0.5, forecast=99)
        ref = position_size(10_000, 0.1, 100, 0.5, forecast=20)
        assert r["n"] == ref["n"]

    def test_leverage_cap(self):
        r = position_size(1_000, 0.5, 100, 0.1, max_leverage=2)
        assert r["notional"] <= 2_000
        assert "capped_by_leverage" in r["reasons"]

    def test_lot_min_rounds_down(self):
        # n_raw = 10k*0.1/(100*0.07) = 142.86 → arrondi vers le bas à 142.8
        r = position_size(10_000, 0.1, 100, 0.07, lot_min=0.4)
        assert r["n"] == pytest.approx(142.8)

    def test_below_notional_min_zeroes(self):
        # notional = 10 < 100 minimum → position refusée
        r = position_size(100, 0.001, 100_000, 0.01, notional_min=100)
        assert r["n"] == 0
        assert "below_notional_min" in r["reasons"]

    def test_invalid_input(self):
        assert position_size(0, 0.1, 100, 0.1)["n"] == 0
        assert position_size(1000, 0.1, 100, 0)["n"] == 0


class TestSizingCapital:
    def test_full(self):
        assert sizing_capital(900, "full", 1000) == 900

    def test_half_caps_at_ref(self):
        assert sizing_capital(1100, "half", 1000) == 1000
        assert sizing_capital(900, "half", 1000) == 900

    def test_fixed_forbidden(self):
        with pytest.raises(ValueError):
            sizing_capital(900, "fixed", 1000)


def test_gap_test():
    assert gap_test(10_000, 0.16) == 1_600
