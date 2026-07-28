import math

import pandas as pd
import pytest

from routers.expected_move import compute_expected_move_from_dataframe, MIN_CANDLES


def _make_df(length: int, close: float = 100.0) -> pd.DataFrame:
    rows = []
    for i in range(length):
        rows.append({
            "time": i,
            "open": close,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": 1_000.0,
        })
    return pd.DataFrame(rows)


def test_compute_expected_move_basic_ranges():
    df = _make_df(MIN_CANDLES + 10)
    result = compute_expected_move_from_dataframe("BTC/USDT", "1h", df, [5, 10])

    assert result["symbol"] == "BTC/USDT"
    assert result["timeframe"] == "1h"
    assert result["atr"] == pytest.approx(2.0, rel=1e-4)

    # Expected move uses atr * sqrt(h)
    range_5 = next(r for r in result["ranges"] if r["horizon"] == 5)
    expected_move = 2.0 * math.sqrt(5)
    assert range_5["move"] == pytest.approx(expected_move, rel=1e-4)
    assert range_5["upper"] == pytest.approx(100.0 + expected_move, rel=1e-4)
    assert range_5["lower"] == pytest.approx(100.0 - expected_move, rel=1e-4)


def test_compute_expected_move_requires_history():
    df = _make_df(MIN_CANDLES - 5)
    with pytest.raises(ValueError):
        compute_expected_move_from_dataframe("BTC/USDT", "1h", df, [5])
