"""Tests unitaires — scan_fetchers / klines fallback."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
from unittest.mock import patch, AsyncMock

import pandas as pd

from routers.scan_fetchers import fetch_klines_fallback


def _make_df(rows=3) -> pd.DataFrame:
    return pd.DataFrame({
        "time": list(range(rows)),
        "open": [float(i) for i in range(rows)],
        "high": [float(i + 1) for i in range(rows)],
        "low": [float(i) for i in range(rows)],
        "close": [float(i + 0.5) for i in range(rows)],
        "volume": [float(i * 100) for i in range(rows)],
    })


async def _slow(*args, **kwargs):
    await asyncio.sleep(10)
    return None


def test_fetch_klines_fallback_returns_first_successful():
    sample = _make_df()
    binance = AsyncMock(return_value=sample)
    deriv = AsyncMock(side_effect=_slow)
    twelvedata = AsyncMock(side_effect=_slow)
    yfinance = AsyncMock(side_effect=_slow)

    with patch('routers.scan_fetchers._PROVIDER_FUNCS', {
        "binance": binance,
        "deriv": deriv,
        "twelvedata": twelvedata,
        "yfinance": yfinance,
    }):
        df = asyncio.run(fetch_klines_fallback("BTC/USD", "1h"))

    assert df is not None
    assert not df.empty
    assert len(df) == 3
    binance.assert_awaited_once_with("BTC/USD", "1h", 300)


def test_fetch_klines_fallback_returns_none_when_all_fail():
    with patch('routers.scan_fetchers._PROVIDER_FUNCS', {
        "binance": AsyncMock(return_value=None),
        "deriv": AsyncMock(return_value=None),
        "twelvedata": AsyncMock(return_value=None),
        "yfinance": AsyncMock(return_value=None),
    }):
        df = asyncio.run(fetch_klines_fallback("XXX/USD", "1h"))

    assert df is None
