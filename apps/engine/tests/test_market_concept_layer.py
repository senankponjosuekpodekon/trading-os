"""Tests for universal market concept layer and embedding."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
import pandas as pd

from features.market_concept_layer import compute_market_concept_vector
from features.market_embedding import build_market_embedding


def _make_df(trend="up"):
    np.random.seed(0)
    n = 100
    if trend == "up":
        close = np.linspace(100, 150, n) + np.random.randn(n) * 2
    elif trend == "down":
        close = np.linspace(150, 100, n) + np.random.randn(n) * 2
    else:
        close = 120 + np.cumsum(np.random.randn(n))
    df = pd.DataFrame({
        "open": close - 0.5,
        "high": close + 2,
        "low": close - 2,
        "close": close,
        "volume": np.random.randint(100, 1000, n),
    })
    return df


def test_concept_vector_keys_and_range():
    df = _make_df("up")
    vec = compute_market_concept_vector("BTC/USDT", df, "CRYPTO")
    expected = {"trend", "accumulation", "expansion_energy", "liquidity_pressure", "imbalance", "stress"}
    assert set(vec.keys()) == expected
    for v in vec.values():
        assert 0.0 <= v <= 1.0


def test_trend_higher_for_uptrend():
    up = compute_market_concept_vector("BTC/USDT", _make_df("up"), "CRYPTO")
    down = compute_market_concept_vector("BTC/USDT", _make_df("down"), "CRYPTO")
    assert up["trend"] > down["trend"]


def test_embedding_dimension():
    df = _make_df("up")
    vec = compute_market_concept_vector("BTC/USDT", df, "CRYPTO")
    emb = build_market_embedding(vec, "BTC/USDT", "1h", dim=64)
    assert len(emb["vector"]) == 64
    assert emb["dimension"] == 64
    assert emb["input_signature"] == "BTC/USDT:1h"


def test_embedding_unit_norm():
    df = _make_df("up")
    vec = compute_market_concept_vector("BTC/USDT", df, "CRYPTO")
    emb = build_market_embedding(vec, "BTC/USDT", "1h", dim=64)
    norm = np.linalg.norm(emb["vector"])
    assert abs(norm - 1.0) < 1e-6


def test_similar_states_have_similar_embeddings():
    df1 = _make_df("up")
    df2 = _make_df("up") * 1.01  # small price-level shift
    v1 = compute_market_concept_vector("BTC/USDT", df1, "CRYPTO")
    v2 = compute_market_concept_vector("ETH/USDT", df2, "CRYPTO")
    e1 = build_market_embedding(v1, "BTC/USDT", "1h", dim=64)
    e2 = build_market_embedding(v2, "ETH/USDT", "1h", dim=64)
    cos = np.dot(e1["vector"], e2["vector"])
    assert cos > 0.9
