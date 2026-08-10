"""
XGBoost Signal Scorer — Phase I
Upgrades the logistic regression scorer with XGBoost (if available).
Falls back to logistic regression if xgboost is not installed.

Same interface as signal_scorer.SignalScorer — drop-in replacement.
Persists model to signal_models table with name 'xgboost_scorer'.
"""
from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from utils.logger import get_logger
from utils.db_pool import get_shared_pool as _get_pool
from ml.signal_scorer import _flatten_features

logger = get_logger(__name__)

# Try to import xgboost
try:
    import xgboost as xgb
    _XGB_AVAILABLE = True
except ImportError:
    _XGB_AVAILABLE = False
    logger.info("xgboost_not_available_fallback_to_logistic")


@dataclass
class XGBModelState:
    feature_names: List[str]
    model_json: Optional[str]  # serialized XGBoost model (if available)
    weights: List[float]       # logistic fallback weights
    bias: float
    means: List[float]
    stds: List[float]
    accuracy: float
    sample_count: int
    trained_market: Optional[str]
    trained_timeframe: Optional[str]
    limit: int
    feature_importance: Dict[str, float]
    model_type: str  # "xgboost" | "logistic"


class XGBoostSignalScorer:
    """XGBoost-based signal scorer with logistic regression fallback."""

    def __init__(self):
        self._pool = None
        self._lock = asyncio.Lock()
        self._state: Optional[XGBModelState] = None
        self._state_loaded = False
        self._xgb_model = None  # deserialized XGBoost booster

    async def train(
        self,
        *,
        market: Optional[str] = None,
        timeframe: Optional[str] = None,
        limit: int = 2000,
        min_samples: int = 100,
    ) -> Dict[str, Any]:
        min_samples = max(10, min_samples)
        limit = max(min_samples, min(limit, 5000))

        async with self._lock:
            await self._ensure_pool()
            rows = await self._fetch_dataset(market, timeframe, limit)
            clean_rows = [
                r for r in rows
                if r.get("features") and r.get("outcome") in {"WIN_TP1", "WIN_TP2", "LOSS_SL"}
            ]
            sample_count = len(clean_rows)

            if sample_count < min_samples:
                logger.warning(
                    "xgboost_scorer.samples_insufficient",
                    samples=sample_count,
                    required=min_samples,
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

            if _XGB_AVAILABLE and sample_count >= 50:
                result = self._fit_xgboost(matrix, labels, feature_names)
            else:
                result = self._fit_logistic(matrix, labels)
                result["model_type"] = "logistic"

            importance = self._compute_importance(result, feature_names)

            self._state = XGBModelState(
                feature_names=feature_names,
                model_json=result.get("model_json"),
                weights=result.get("weights", []).tolist() if isinstance(result.get("weights"), np.ndarray) else result.get("weights", []),
                bias=float(result.get("bias", 0.0)),
                means=result.get("means", []).tolist() if isinstance(result.get("means"), np.ndarray) else result.get("means", []),
                stds=result.get("stds", []).tolist() if isinstance(result.get("stds"), np.ndarray) else result.get("stds", []),
                accuracy=float(result["accuracy"]),
                sample_count=sample_count,
                trained_market=market,
                trained_timeframe=timeframe,
                limit=limit,
                feature_importance=importance,
                model_type=result.get("model_type", "xgboost"),
            )

            if result.get("model_json"):
                self._xgb_model = xgb.Booster()
                self._xgb_model.load_model(bytearray(result["model_json"], "utf-8"))

            await self._persist_state()

            logger.info(
                "xgboost_scorer.trained",
                samples=sample_count,
                features=len(feature_names),
                accuracy=result["accuracy"],
                model_type=self._state.model_type,
                market=market,
                timeframe=timeframe,
            )

            return {
                "trained": True,
                "model_type": self._state.model_type,
                "samples": sample_count,
                "features": len(feature_names),
                "accuracy": round(result["accuracy"], 4),
                "market": market,
                "timeframe": timeframe,
                "topFeatures": sorted(importance.items(), key=lambda kv: kv[1], reverse=True)[:10],
            }

    async def predict(self, features: Dict[str, Any]) -> Dict[str, Any]:
        if not self._state:
            raise ValueError("model_not_trained")
        vector = self._build_vector(features, self._state.feature_names)
        means = np.array(self._state.means, dtype=np.float32)
        stds = np.array(self._state.stds, dtype=np.float32)
        stds = np.where(stds == 0, 1.0, stds)
        normalized = (vector - means) / stds

        if self._xgb_model is not None and _XGB_AVAILABLE:
            dmatrix = xgb.DMatrix(normalized.reshape(1, -1), feature_names=self._state.feature_names)
            probability = float(self._xgb_model.predict(dmatrix)[0])
        else:
            weights = np.array(self._state.weights, dtype=np.float32)
            z = float(np.dot(normalized, weights) + self._state.bias)
            probability = float(1 / (1 + math.exp(-z)))

        return {
            "probability": probability,
            "confidence_ml": round(probability * 100, 2),
            "trained": True,
            "model_type": self._state.model_type,
            "featureCount": len(self._state.feature_names),
        }

    async def status(self) -> Dict[str, Any]:
        if not self._state:
            return {"trained": False, "message": "model not trained yet"}
        return {
            "trained": True,
            "model_type": self._state.model_type,
            "samples": self._state.sample_count,
            "accuracy": round(self._state.accuracy, 4),
            "featureCount": len(self._state.feature_names),
            "market": self._state.trained_market,
            "timeframe": self._state.trained_timeframe,
            "topFeatures": sorted(self._state.feature_importance.items(), key=lambda kv: kv[1], reverse=True)[:10],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

    # ── Internal methods ────────────────────────────────────────────────

    def _fit_xgboost(self, matrix: np.ndarray, labels: np.ndarray, feature_names: List[str]) -> Dict[str, Any]:
        means = matrix.mean(axis=0)
        stds = matrix.std(axis=0)
        stds = np.where(stds == 0, 1.0, stds)
        X = (matrix - means) / stds

        dtrain = xgb.DMatrix(X, label=labels, feature_names=feature_names)
        params = {
            "objective": "binary:logistic",
            "max_depth": 4,
            "eta": 0.1,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "min_child_weight": 3,
            "verbosity": 0,
            "nthread": 1,
        }
        n_rounds = max(50, min(200, len(labels) // 5))
        model = xgb.train(params, dtrain, n_rounds)

        preds = model.predict(dtrain)
        accuracy = float(((preds >= 0.5) == labels).mean())

        # Serialize model to JSON
        model_json = model.save_raw("json").decode("utf-8")

        # Feature importance
        importance_raw = model.get_score(importance_type="gain")
        # Also get logistic-style weights for fallback
        weights = np.zeros(len(feature_names), dtype=np.float32)
        for i, name in enumerate(feature_names):
            weights[i] = float(importance_raw.get(name, 0.0))

        return {
            "model_json": model_json,
            "weights": weights,
            "bias": 0.0,
            "means": means,
            "stds": stds,
            "accuracy": accuracy,
            "model_type": "xgboost",
        }

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
            "model_type": "logistic",
        }

    def _compute_importance(self, result: Dict, feature_names: List[str]) -> Dict[str, float]:
        if result.get("model_type") == "xgboost" and _XGB_AVAILABLE:
            # Use XGBoost gain importance
            importance_raw = result.get("importance_raw", {})
            if not importance_raw:
                # Fallback to weights
                weights = np.abs(np.array(result.get("weights", []), dtype=np.float32))
            else:
                weights = np.array([float(importance_raw.get(name, 0.0)) for name in feature_names])
        else:
            weights = np.abs(np.array(result.get("weights", []), dtype=np.float32))

        top = weights.max() or 1.0
        normalized = weights / top
        return {name: float(round(score, 4)) for name, score in zip(feature_names, normalized)}

    def _build_matrix(self, dataset: Sequence[Dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, List[str]]:
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

    def _build_vector(self, features: Dict[str, Any], feature_names: List[str]) -> np.ndarray:
        flat = _flatten_features(features)
        vector = np.zeros(len(feature_names), dtype=np.float32)
        for idx, key in enumerate(feature_names):
            value = flat.get(key)
            if value is not None:
                vector[idx] = value
        return vector

    async def _fetch_dataset(self, market, timeframe, limit) -> List[Dict[str, Any]]:
        if self._pool is None:
            await self._ensure_pool()

        clauses = [
            "sf.features_json IS NOT NULL",
            "sf.outcome IN ('WIN_TP1','WIN_TP2','LOSS_SL')",
            "sf.snapshot_version = 'v2'",
        ]
        params: List[Any] = []
        if market:
            clauses.append("sf.market = $%d" % (len(params) + 1))
            params.append(market)
        if timeframe:
            clauses.append("sf.timeframe = $%d" % (len(params) + 1))
            params.append(timeframe)

        limit_ph = "$%d" % (len(params) + 1)
        params.append(limit)

        query = f"""
            SELECT sf.features_json, sf.outcome, sf.pnl, sf.signal_type,
                   sf.confidence, sf.timeframe, sf.market, sf.symbol
            FROM signal_features sf
            WHERE {' AND '.join(clauses)}
            ORDER BY sf.created_at DESC
            LIMIT {limit_ph}
        """
        async with self._pool.acquire() as conn:
            records = await conn.fetch(query, *params)

        dataset = []
        for row in records:
            features = row["features_json"]
            if not isinstance(features, dict):
                continue
            dataset.append({
                "features": features,
                "outcome": row["outcome"],
                "pnl": row["pnl"],
                "market": row["market"],
                "timeframe": row["timeframe"],
                "direction": row.get("signal_type"),
                "confidence": row.get("confidence"),
            })
        return dataset

    async def _ensure_pool(self):
        if self._pool is None:
            self._pool = await _get_pool()

    async def _ensure_state(self):
        if self._state_loaded:
            return
        await self._ensure_pool()
        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT model_json FROM signal_models WHERE name = 'xgboost_scorer' LIMIT 1"
                )
        except Exception as exc:
            logger.warning("xgboost_scorer.load_failed", error=str(exc))
            self._state_loaded = True
            return

        if row and row.get("model_json"):
            try:
                payload = json.loads(row["model_json"])
                self._state = XGBModelState(
                    feature_names=payload.get("feature_names", []),
                    model_json=payload.get("model_json"),
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
                    model_type=payload.get("model_type", "logistic"),
                )
                if payload.get("model_json") and _XGB_AVAILABLE:
                    self._xgb_model = xgb.Booster()
                    self._xgb_model.load_model(bytearray(payload["model_json"], "utf-8"))
            except Exception as exc:
                logger.warning("xgboost_scorer.deserialize_failed", error=str(exc))

        self._state_loaded = True

    async def _persist_state(self):
        if not self._state:
            return
        payload = json.dumps({
            "feature_names": self._state.feature_names,
            "model_json": self._state.model_json,
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
            "model_type": self._state.model_type,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO signal_models(name, model_json)
                    VALUES('xgboost_scorer', $1)
                    ON CONFLICT (name) DO UPDATE SET model_json = EXCLUDED.model_json, updated_at = now()
                    """,
                    payload,
                )
        except Exception as exc:
            logger.warning("xgboost_scorer.persist_failed", error=str(exc))

    async def close_pool(self):
        # Shared pool is closed centrally on shutdown
        self._pool = None


xgboost_scorer = XGBoostSignalScorer()
