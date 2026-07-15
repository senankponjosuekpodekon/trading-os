"""Tests unitaires — contexte marché."""
import asyncio
import sys
import os
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils.market_context import get_signal_context


def test_crypto_context_returns_market_crypto():
    with patch("utils.market_context.fear_greed", return_value=70), \
         patch("utils.market_context.onchain_context", return_value={"funding_rate": 0.01}), \
         patch("utils.market_context.btc_dominance", return_value=58.0):
        result = asyncio.run(get_signal_context("BTC/USDT"))
    assert result is not None
    assert result["market"] == "crypto"
    assert result["fear_greed"] == 70
    assert result["onchain"] == {"funding_rate": 0.01}


def test_forex_context_returns_market_forex():
    with patch("utils.market_context.fear_greed", return_value=70), \
         patch("utils.market_context.dxy", return_value=104.0):
        result = asyncio.run(get_signal_context("EUR/USD"))
    assert result is not None
    assert result["market"] == "forex"
    assert result["dxy"] == 104.0


def test_commodity_context_returns_market_commodities():
    with patch("utils.market_context.fear_greed", return_value=70), \
         patch("utils.market_context.dxy", return_value=104.0):
        result = asyncio.run(get_signal_context("XAU/USD"))
    assert result is not None
    assert result["market"] == "commodities"


def test_unknown_context_returns_unknown():
    result = asyncio.run(get_signal_context("UNKNOWN/XYZ"))
    assert result is not None
    assert result["market"] == "unknown"
