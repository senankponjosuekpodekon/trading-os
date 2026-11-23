"""Tests pour utils/movement_alert.py — détection de mouvement anormal."""
import sys
import os
from unittest.mock import AsyncMock, patch

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from utils.movement_alert import check_price_move, MOVE_WINDOW  # noqa: E402


def _df(closes):
    n = len(closes)
    return pd.DataFrame({
        "time": range(n),
        "open": closes,
        "high": [c * 1.001 for c in closes],
        "low": [c * 0.999 for c in closes],
        "close": closes,
        "volume": [1.0] * n,
    })


@pytest.mark.asyncio
async def test_no_alert_on_flat_series():
    df = _df([100.0 + (i % 3) * 0.05 for i in range(40)])
    with patch("utils.movement_alert.broadcast_once", new=AsyncMock()) as bc:
        await check_price_move("V75", df, "1h")
        bc.assert_not_called()


@pytest.mark.asyncio
async def test_alert_on_spike():
    closes = [100.0 + (i % 3) * 0.05 for i in range(40)]
    # +8% sur les 3 dernières bougies — largement > 3×ATR
    for k in range(1, MOVE_WINDOW + 1):
        closes[-k] = 108.0
    df = _df(closes)
    with patch("utils.movement_alert.broadcast_once", new=AsyncMock(return_value=True)) as bc:
        await check_price_move("V75", df, "1h")
        bc.assert_called_once()
        kw = bc.call_args.kwargs
        assert "V75" in kw["dedup_key"]
        assert kw["data"]["move_pct"] > 0


@pytest.mark.asyncio
async def test_alert_on_crash():
    closes = [100.0 + (i % 3) * 0.05 for i in range(40)]
    for k in range(1, MOVE_WINDOW + 1):
        closes[-k] = 90.0  # -10%
    df = _df(closes)
    with patch("utils.movement_alert.broadcast_once", new=AsyncMock(return_value=True)) as bc:
        await check_price_move("BTC/USDT", df, "1h")
        bc.assert_called_once()
        assert bc.call_args.kwargs["data"]["move_pct"] < 0


@pytest.mark.asyncio
async def test_insufficient_data_noop():
    df = _df([100.0] * 5)
    with patch("utils.movement_alert.broadcast_once", new=AsyncMock()) as bc:
        await check_price_move("V75", df, "1h")
        bc.assert_not_called()


@pytest.mark.asyncio
async def test_broadcast_exception_swallowed():
    closes = [100.0] * 37 + [110.0] * 3
    df = _df(closes)
    with patch("utils.movement_alert.broadcast_once", new=AsyncMock(side_effect=RuntimeError("redis down"))):
        await check_price_move("V75", df, "1h")  # ne doit pas lever


class TestMovementCone:
    def test_cone_bands(self):
        from utils.movement_cone import movement_cone
        closes = [100.0 + i * 0.1 for i in range(60)]
        cone = movement_cone(_df(closes))
        assert cone is not None
        assert cone["1x"]["p68"] > 0
        assert cone["4x"]["p68"] > cone["1x"]["p68"]
        assert cone["24x"]["p95"] > cone["1x"]["p95"]

    def test_cone_none_on_short_df(self):
        from utils.movement_cone import movement_cone
        assert movement_cone(_df([1.0] * 10)) is None

    def test_tp_feasibility_bands(self):
        from utils.movement_cone import tp_feasibility
        cone = {"4x": {"p68": 1.0, "p95": 2.0}}
        assert tp_feasibility(0.5, cone) == "HIGH"
        assert tp_feasibility(1.5, cone) == "MEDIUM"
        assert tp_feasibility(5.0, cone) == "LOW"
        assert tp_feasibility(None, cone) is None
