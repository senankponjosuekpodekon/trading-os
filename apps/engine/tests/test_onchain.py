"""Tests unitaires — onchain_bonus / is_crypto_symbol."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.onchain import onchain_bonus, is_crypto_symbol


def test_is_crypto_symbol_true():
    assert is_crypto_symbol("BTC/USDT") is True
    assert is_crypto_symbol("ETH/USDT") is True


def test_is_crypto_symbol_false():
    assert is_crypto_symbol("EUR/USD") is False
    assert is_crypto_symbol("XAU/USD") is False
    assert is_crypto_symbol("BTC/USD") is False  # pas /USDT


def test_onchain_bonus_no_data_returns_zero():
    bonus, reasons = onchain_bonus({}, "BUY", None)
    assert bonus == 0
    assert reasons == []


def test_onchain_bonus_fear_greed_extreme_fear_buy():
    bonus, reasons = onchain_bonus({}, "BUY", fear_greed_value=10)
    assert bonus == 20
    assert any("Fear&Greed" in r for r in reasons)


def test_onchain_bonus_fear_greed_extreme_fear_sell_penalized():
    bonus, reasons = onchain_bonus({}, "SELL", fear_greed_value=10)
    assert bonus == -15


def test_onchain_bonus_fear_greed_extreme_greed_sell():
    bonus, reasons = onchain_bonus({}, "SELL", fear_greed_value=90)
    assert bonus == 20


def test_onchain_bonus_fear_greed_extreme_greed_buy_penalized():
    bonus, reasons = onchain_bonus({}, "BUY", fear_greed_value=90)
    assert bonus == -15


def test_onchain_bonus_fear_greed_neutral_no_effect():
    bonus, reasons = onchain_bonus({}, "BUY", fear_greed_value=50)
    assert bonus == 0
    assert reasons == []


def test_onchain_bonus_funding_negative_favors_buy():
    context = {"funding_rate": {"funding_rate": -0.02}}
    bonus, reasons = onchain_bonus(context, "BUY", None)
    assert bonus == 15
    assert any("funding négatif" in r for r in reasons)


def test_onchain_bonus_funding_positive_favors_sell():
    context = {"funding_rate": {"funding_rate": 0.08}}
    bonus, reasons = onchain_bonus(context, "SELL", None)
    assert bonus == 15


def test_onchain_bonus_funding_wrong_direction_no_bonus():
    context = {"funding_rate": {"funding_rate": -0.02}}
    bonus, _ = onchain_bonus(context, "SELL", None)
    assert bonus == 0


def test_onchain_bonus_combined_capped_at_25():
    context = {"funding_rate": {"funding_rate": -0.02}}
    bonus, reasons = onchain_bonus(context, "BUY", fear_greed_value=5)
    # 20 (fear&greed) + 15 (funding) = 35 → plafonné à 25
    assert bonus == 25
    assert len(reasons) == 2


def test_onchain_bonus_missing_funding_key_safe():
    bonus, reasons = onchain_bonus({"funding_rate": None}, "BUY", None)
    assert bonus == 0
