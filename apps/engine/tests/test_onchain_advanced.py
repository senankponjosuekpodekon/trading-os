"""Tests for advanced on-chain context (netflow, MVRV, dev, TVL)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio

from routers.onchain_advanced import (
    fetch_exchange_netflow,
    fetch_mvrv,
    fetch_developer_activity,
    fetch_defi_tvl,
    fetch_stablecoin_flow,
    fetch_nvt,
    fetch_whale_alert,
    get_advanced_onchain_context,
    advanced_onchain_bonus,
)


def test_netflow_returns_dict():
    res = asyncio.run(fetch_exchange_netflow("BTC/USDT"))
    assert isinstance(res, dict)
    assert "netflow_1d" in res
    assert "source" in res


def test_mvrv_returns_dict():
    res = asyncio.run(fetch_mvrv("BTC/USDT"))
    assert isinstance(res, dict)
    assert "mvrv" in res


def test_developer_activity_returns_dict():
    res = asyncio.run(fetch_developer_activity("BTC/USDT"))
    assert isinstance(res, dict)
    assert "commits_30d" in res


def test_defi_tvl_returns_dict():
    res = asyncio.run(fetch_defi_tvl("ETH/USDT"))
    assert isinstance(res, dict)
    assert "tvl_change_7d_pct" in res


def test_advanced_context_aggregate():
    ctx = asyncio.run(get_advanced_onchain_context("ETH/USDT"))
    assert "exchange_netflow" in ctx
    assert "mvrv" in ctx
    assert "developer_activity" in ctx
    assert "smart_contract_activity" in ctx
    assert "stablecoin_flow" in ctx
    assert "nvt" in ctx
    assert "whale_alert" in ctx


def test_advanced_bonus_zombie_flag():
    ctx = {
        "developer_activity": {"commits_30d": 0, "commits_60d": 0},
        "exchange_netflow": {},
        "mvrv": {},
        "smart_contract_activity": {"tvl": {}},
        "stablecoin_flow": {},
        "nvt": {},
        "whale_alert": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY")
    assert flags.get("zombie_flag") is True
    assert bonus < 0


def test_advanced_bonus_overvalued_mvrv():
    ctx = {
        "mvrv": {"mvrv": 4.0},
        "exchange_netflow": {},
        "developer_activity": {},
        "smart_contract_activity": {"tvl": {}},
        "stablecoin_flow": {},
        "nvt": {},
        "whale_alert": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY")
    assert flags.get("mvrv_overvalued") is True
    assert bonus < 0


def test_advanced_bonus_tvl_asymmetry():
    ctx = {
        "smart_contract_activity": {"tvl": {"tvl_change_7d_pct": 15.0}},
        "exchange_netflow": {},
        "mvrv": {},
        "developer_activity": {},
        "stablecoin_flow": {},
        "nvt": {},
        "whale_alert": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY", price_change_7d=0.5)
    assert flags.get("asymmetry_flag") is True
    assert bonus > 0


def test_stablecoin_flow_bonus():
    ctx = {
        "stablecoin_flow": {"netflow_1d": 250},
        "exchange_netflow": {},
        "mvrv": {},
        "developer_activity": {},
        "smart_contract_activity": {"tvl": {}},
        "nvt": {},
        "whale_alert": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY")
    assert bonus > 0
    assert any("stablecoin" in r.lower() for r in reasons)


def test_nvt_overvalued():
    ctx = {
        "nvt": {"nvt": 180},
        "exchange_netflow": {},
        "mvrv": {},
        "developer_activity": {},
        "smart_contract_activity": {"tvl": {}},
        "stablecoin_flow": {},
        "whale_alert": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY")
    assert bonus < 0


def test_whale_distribution():
    ctx = {
        "whale_alert": {"inflow_usd": 200e6, "outflow_usd": 10e6},
        "exchange_netflow": {},
        "mvrv": {},
        "developer_activity": {},
        "smart_contract_activity": {"tvl": {}},
        "stablecoin_flow": {},
        "nvt": {},
    }
    bonus, reasons, flags = advanced_onchain_bonus(ctx, "BUY")
    assert bonus < 0
