import math
import pytest

from ml.signal_scorer import SignalScorer


@pytest.mark.asyncio
async def test_signal_scorer_trains_and_predicts():
    scorer = SignalScorer(persistence_enabled=False)
    dataset = []
    for idx in range(20):
        features = {
            "level1": {"open": 100 + idx, "close": 100 + idx * 1.01},
            "level2": {
                "rsi": 55 + idx,
                "volume_ratio_20": 1.0 + idx * 0.01,
            },
            "structure": {
                "pa_bos": idx % 2 == 0,
                "adx": 20 + idx,
            },
        }
        dataset.append(
            {
                "signal_id": f"sig-{idx}",
                "features": features,
                "outcome": "WIN_TP1" if idx % 2 == 0 else "LOSS_SL",
                "pnl": 2.0 if idx % 2 == 0 else -1.0,
            }
        )

    result = await scorer.train(dataset=dataset, min_samples=10)
    assert result["trained"] is True
    assert result["samples"] == 20
    assert result["features"] > 0
    assert 0 <= result["accuracy"] <= 1

    prediction = await scorer.predict(dataset[0]["features"])
    assert 0 <= prediction["probability"] <= 1
    assert math.isclose(prediction["confidence_ml"], prediction["probability"] * 100, rel_tol=1e-5)


@pytest.mark.asyncio
async def test_signal_scorer_requires_minimum_samples():
    scorer = SignalScorer(persistence_enabled=False)
    dataset = [
        {
            "signal_id": "sig-1",
            "features": {"level1": {"open": 100, "close": 101}},
            "outcome": "WIN_TP1",
            "pnl": 1.0,
        }
    ]

    result = await scorer.train(dataset=dataset, min_samples=50)
    assert result["trained"] is False
    assert result["reason"] == "not_enough_samples"
