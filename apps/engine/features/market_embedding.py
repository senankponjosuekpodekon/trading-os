"""
Market Embedding — Phase A++
Build a deterministic market-state embedding from the universal concept vector.
The vector can be persisted in pgvector for similarity search (Phase D).
"""
import hashlib
import numpy as np
from typing import Any


def _unit_vector(v: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(v))
    if norm == 0:
        return np.zeros_like(v)
    return v / norm


def build_market_embedding(
    concept_vector: dict[str, float],
    symbol: str,
    timeframe: str,
    dim: int = 64,
) -> dict[str, Any]:
    """
    Create a deterministic dense embedding from the concept vector.

    The projection is deterministic (seeded by feature names), so the same market
    state always maps to the same embedding vector regardless of symbol or asset class.
    """
    base_values = np.array([
        concept_vector.get("trend", 0.5),
        concept_vector.get("accumulation", 0.5),
        concept_vector.get("expansion_energy", 0.5),
        concept_vector.get("liquidity_pressure", 0.5),
        concept_vector.get("imbalance", 0.5),
        concept_vector.get("stress", 0.5),
    ], dtype=float)

    # Deterministic random projection matrix seeded by feature dimension order
    rng = np.random.default_rng(seed=42)
    projection = rng.normal(loc=0.0, scale=1.0, size=(len(base_values), dim))
    embedding = base_values @ projection

    # Add a tiny deterministic symbol/timeframe hash so identical states from
    # different assets remain directly comparable while keeping uniqueness.
    hash_input = f"{symbol}:{timeframe}"
    hash_seed = int(hashlib.sha256(hash_input.encode()).hexdigest()[:16], 16) % (2**32)
    rng_hash = np.random.default_rng(seed=hash_seed)
    tiny_offset = rng_hash.normal(loc=0.0, scale=0.001, size=dim)
    embedding = embedding + tiny_offset

    embedding = _unit_vector(embedding)

    return {
        "vector": embedding.tolist(),
        "dimension": dim,
        "concept_vector": concept_vector,
        "input_signature": f"{symbol}:{timeframe}",
    }
