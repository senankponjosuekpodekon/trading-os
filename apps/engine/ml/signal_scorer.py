"""Signal Scorer — trains a lightweight logistic model from signal feature snapshots."""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import asyncpg
import numpy as np
import json

from config import settings
from utils.logger import get_logger


logger = get_logger(__name__)


@dataclass
class ModelState:
    feature_names: List[str]
    weights: List[float]
    bias: float
    means: List[float]
    stds: List[float]
    accuracy: float
    sample_count: int
    trained_market: Optional[str]
    trained_timeframe: Optional[str]
    limit: int
    feature_importance: Dict[str, float]


def _coerce_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        if math.isnan(value) or math.isinf(value):
            return None
        return float(value)
    return None


# Categorical features that should be one-hot encoded rather than dropped
_CATEGORICAL_KEYS = {
    "pa_trend", "pa_bos_dir", "regime", "breakout_direction",
    "sweep_direction", "session", "asset_type", "mtf_confluence",
    "structure", "bos_dir", "choch_dir",
}


def _flatten_features(data: Any, prefix: str = "") -> Dict[str, float]:
    flat: Dict[str, float] = {}
    if isinstance(data, dict):
        for key, value in data.items():
            if not key:
                continue
            sub_prefix = f"{prefix}.{key}" if prefix else str(key)
            # One-hot encode known categorical string features
            if isinstance(value, str) and key in _CATEGORICAL_KEYS:
                flat[f"{sub_prefix}={value}"] = 1.0
                continue
            flat.update(_flatten_features(value, sub_prefix))
    elif isinstance(data, list):
        numeric_items = [_coerce_number(v) for v in data]
        numeric_values = [v for v in numeric_items if v is not None]
        if numeric_values and prefix:
            flat[f"{prefix}.__mean"] = float(np.mean(numeric_values))
            flat[f"{prefix}.__max"] = float(np.max(numeric_values))
            flat[f"{prefix}.__min"] = float(np.min(numeric_values))
        for idx, item in enumerate(data[:5]):  # cap expansion
            sub_prefix = f"{prefix}.{idx}" if prefix else str(idx)
            flat.update(_flatten_features(item, sub_prefix))
    else:
        value = _coerce_number(data)
        if value is not None and prefix:
            flat[prefix] = value
    return flat


class SignalScorer:
    """Trainable logistic model leveraging the signal feature store."""

    def __init__(self, *, persistence_enabled: bool = True):
        self._pool = None
        self._lock = asyncio.Lock()
        self._state: Optional[ModelState] = None
        self._state_loaded = False
        self._persistence_enabled = persistence_enabled

    async def train(
        self,
        *,
        market: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 2000,
        dataset: Optional[List[Dict[str, Any]]] = None,
        min_samples: int = 100,
    ) -> Dict[str, Any]:
        min_samples = max(10, min_samples)
        limit = max(min_samples, min(limit, 5000))
        async with self._lock:
            if self._persistence_enabled:
                await self._ensure_state()
            rows = dataset if dataset is not None else await self._fetch_dataset(market, timeframe, limit)
            clean_rows = [row for row in rows if row.get("features") and row.get("outcome") in {"WIN_TP1", "WIN_TP2", "LOSS_SL"}]
            sample_count = len(clean_rows)
            if sample_count < min_samples:
                logger.warning(
                    "signal_scorer.samples_insufficient",
                    samples=sample_count,
                    required=min_samples,
                    market=market,
                    timeframe=timeframe,
                )
                return {
                    "trained": False,
                    "reason": "not_enough_samples",
                    "samples": sample_count,
                    "required": min_samples,
                }

            matrix, labels, feature_names = self._build_matrix(clean_rows)
            if matrix.size == 0 or len(feature_names) == 0:
                return {
                    "trained": False,
                    "reason": "no_numeric_features",
                    "samples": sample_count,
                }

            model = self._fit_logistic(matrix, labels)
            importance = self._compute_importance(model["weights"], feature_names)

            self._state = ModelState(
                feature_names=feature_names,
                weights=model["weights"].tolist(),
                bias=float(model["bias"]),
                means=model["means"].tolist(),
                stds=model["stds"].tolist(),
                accuracy=float(model["accuracy"]),
                sample_count=sample_count,
                trained_market=market,
                trained_timeframe=timeframe,
                limit=limit,
                feature_importance=importance,
            )

            logger.info(
                "signal_scorer.trained",
                samples=sample_count,
                features=len(feature_names),
                accuracy=model["accuracy"],
                market=market,
                timeframe=timeframe,
            )

            await self._persist_state()

            return {
                "trained": True,
                "samples": sample_count,
                "features": len(feature_names),
                "accuracy": round(model["accuracy"], 4),
                "market": market,
                "timeframe": timeframe,
                "topFeatures": sorted(importance.items(), key=lambda kv: kv[1], reverse=True)[:10],
            }

    async def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        if self._persistence_enabled:
            await self._ensure_state()
        state = self._state
        if not state:
            raise ValueError("model_not_trained")
        vector = self._build_vector(features, state.feature_names)
        means = np.array(state.means, dtype=np.float32)
        stds = np.array(state.stds, dtype=np.float32)
        stds = np.where(stds == 0, 1.0, stds)
        normalized = (vector - means) / stds
        weights = np.array(state.weights, dtype=np.float32)
        z = float(np.dot(normalized, weights) + state.bias)
        probability = float(1 / (1 + math.exp(-z)))
        return {
            "probability": probability,
            "confidence_ml": round(probability * 100, 2),
            "trained": True,
            "featureCount": len(state.feature_names),
        }

    async def status(self) -> Dict[str, Any]:
        if self._persistence_enabled:
            await self._ensure_state()
        state = self._state
        if not state:
            return {"trained": False, "message": "model not trained yet"}
        return {
            "trained": True,
            "samples": state.sample_count,
            "accuracy": round(state.accuracy, 4),
            "featureCount": len(state.feature_names),
            "market": state.trained_market,
            "timeframe": state.trained_timeframe,
            "limit": state.limit,
            "topFeatures": sorted(state.feature_importance.items(), key=lambda kv: kv[1], reverse=True)[:10],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

    async def _fetch_dataset(
        self,
        market: Optional[str],
        timeframe: Optional[str],
        limit: int,
        snapshot_version: str = "v2",
        min_ml_confidence: Optional[float] = None,
        max_ml_confidence: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        if self._pool is None:
            db_url = settings.database_url.replace("postgres://", "postgresql://")
            self._pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)

        clauses = [
            "sf.features_json IS NOT NULL",
            "sf.outcome IN ('WIN_TP1','WIN_TP2','LOSS_SL')",
        ]
        params: List[Any] = []
        clauses.append("sf.snapshot_version = $%d" % (len(params) + 1))
        params.append(snapshot_version)
        if market:
            clauses.append("sf.market = $%d" % (len(params) + 1))
            params.append(market)
        if timeframe:
            clauses.append("sf.timeframe = $%d" % (len(params) + 1))
            params.append(timeframe)
        if min_ml_confidence is not None:
            clauses.append("sf.ml_confidence >= $%d" % (len(params) + 1))
            params.append(min_ml_confidence)
        if max_ml_confidence is not None:
            clauses.append("sf.ml_confidence <= $%d" % (len(params) + 1))
            params.append(max_ml_confidence)
        clauses_sql = " AND ".join(clauses)
        limit_placeholder = "$%d" % (len(params) + 1)
        params.append(limit)

        query = f"""
            SELECT sf.signal_id,
                   sf.features_json,
                   sf.outcome,
                   sf.pnl,
                   sf.concept_vector,
                   sf.embedding_vector,
                   sf.signal_type,
                   sf.confidence,
                   sf.timeframe,
                   sf.market,
                   sf.symbol,
                   sf.ml_confidence,
                   sf.ml_regime,
                   sf.expected_move_json,
                   sf.created_at
            FROM signal_features sf
            WHERE {clauses_sql}
            ORDER BY sf.created_at DESC
            LIMIT {limit_placeholder}
        """

        async with self._pool.acquire() as conn:
            records = await conn.fetch(query, *params)

        dataset: List[Dict[str, Any]] = []
        for row in records:
            features = row["features_json"]
            if not isinstance(features, dict):
                continue
            dataset.append(
                {
                    "signal_id": row["signal_id"],
                    "features": features,
                    "outcome": row["outcome"],
                    "pnl": row["pnl"],
                    "market": row["market"],
                    "timeframe": row["timeframe"],
                    "direction": row.get("signal_type"),
                    "confidence": row.get("confidence"),
                    "ml_confidence": row.get("ml_confidence"),
                    "ml_regime": row.get("ml_regime"),
                    "expected_move": row.get("expected_move_json"),
                }
            )
        return dataset

    def _build_matrix(
        self,
        dataset: Sequence[Dict[str, Any]],
    ) -> tuple[np.ndarray, np.ndarray, List[str]]:
        feature_keys: set[str] = set()
        flattened_rows: List[Dict[str, float]] = []
        labels: List[int] = []
        for row in dataset:
            flat = _flatten_features(row["features"])
            flattened_rows.append(flat)
            feature_keys.update(flat.keys())
            labels.append(1 if row["outcome"] in {"WIN_TP1", "WIN_TP2"} else 0)

        feature_names = sorted(feature_keys)
        matrix = np.zeros((len(flattened_rows), len(feature_names)), dtype=np.float32)
        for i, flat in enumerate(flattened_rows):
            for j, key in enumerate(feature_names):
                value = flat.get(key)
                if value is not None:
                    matrix[i, j] = value
        return matrix, np.array(labels, dtype=np.float32), feature_names

    def _fit_logistic(self, matrix: np.ndarray, labels: np.ndarray) -> Dict[str, Any]:
        means = matrix.mean(axis=0)
        stds = matrix.std(axis=0)
        stds = np.where(stds == 0, 1.0, stds)
        X = (matrix - means) / stds
        n_samples, n_features = X.shape
        weights = np.zeros(n_features, dtype=np.float32)
        bias = 0.0
        lr = 0.05
        epochs = max(200, min(800, n_samples * 2))

        for _ in range(epochs):
            z = X.dot(weights) + bias
            preds = 1 / (1 + np.exp(-z))
            errors = preds - labels
            grad_w = X.T.dot(errors) / n_samples
            grad_b = errors.mean()
            weights -= lr * grad_w
            bias -= lr * grad_b

        final_preds = 1 / (1 + np.exp(-(X.dot(weights) + bias)))
        accuracy = float(((final_preds >= 0.5) == labels).mean())
        return {
            "weights": weights,
            "bias": bias,
            "means": means,
            "stds": stds,
            "accuracy": accuracy,
        }

    def _compute_importance(self, weights: np.ndarray, feature_names: List[str]) -> Dict[str, float]:
        abs_weights = np.abs(weights)
        top = abs_weights.max() or 1.0
        normalized = abs_weights / top
        return {name: float(round(score, 4)) for name, score in zip(feature_names, normalized)}

    def _build_vector(self, features: Dict[str, Any], feature_names: List[str]) -> np.ndarray:
        flat = _flatten_features(features)
        vector = np.zeros(len(feature_names), dtype=np.float32)
        for idx, key in enumerate(feature_names):
            value = flat.get(key)
            if value is not None:
                vector[idx] = value
        return vector

    async def _ensure_state(self):
        if self._state_loaded or not self._persistence_enabled:
            self._state_loaded = True
            return
        try:
            if self._pool is None:
                db_url = settings.database_url.replace("postgres://", "postgresql://")
                self._pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT model_json FROM signal_models WHERE name = 'signal_scorer' LIMIT 1"
                )
        except Exception as exc:
            logger.warning("signal_scorer.ensure_state_failed", error=str(exc))
            self._state_loaded = True
            return
        if row and row.get("model_json"):
            try:
                payload = json.loads(row["model_json"])
                self._state = ModelState(
                    feature_names=payload.get("feature_names", []),
                    weights=payload.get("weights", []),
                    bias=payload.get("bias", 0.0),
                    means=payload.get("means", []),
                    stds=payload.get("stds", []),
                    accuracy=payload.get("accuracy", 0.0),
                    sample_count=payload.get("sample_count", 0),
                    trained_market=payload.get("trained_market"),
                    trained_timeframe=payload.get("trained_timeframe"),
                    limit=payload.get("limit", 0),
                    feature_importance=payload.get("feature_importance", {}),
                )
            except Exception as exc:
                logger.warning("signal_scorer.load_failed", error=str(exc))
        self._state_loaded = True

    async def _persist_state(self):
        if not self._state or not self._persistence_enabled:
            return
        payload = json.dumps({
            "feature_names": self._state.feature_names,
            "weights": self._state.weights,
            "bias": self._state.bias,
            "means": self._state.means,
            "stds": self._state.stds,
            "accuracy": self._state.accuracy,
            "sample_count": self._state.sample_count,
            "trained_market": self._state.trained_market,
            "trained_timeframe": self._state.trained_timeframe,
            "limit": self._state.limit,
            "feature_importance": self._state.feature_importance,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO signal_models(name, model_json)
                    VALUES('signal_scorer', $1)
                    ON CONFLICT (name) DO UPDATE SET model_json = EXCLUDED.model_json, updated_at = now()
                    """,
                    payload,
                )
        except Exception as exc:
            logger.warning("signal_scorer.persist_failed", error=str(exc))

    async def close_pool(self):
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.info("signal_scorer.pool_closed")


signal_scorer = SignalScorer()
