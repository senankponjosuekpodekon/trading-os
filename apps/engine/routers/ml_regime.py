"""API endpoints for regime classifier training/prediction."""
import json
import os
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ml.regime_classifier import RegimeClassifier, RegimeModel, STATE_LABELS
from utils.db_pool import get_shared_pool

router = APIRouter()
classifier = RegimeClassifier()

_MODEL_CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", ".cache", "regime_model.json")
_DB_MODEL_NAME = "regime_classifier"


def _save_model():
    """Persist the trained model to disk so it survives restarts."""
    if not classifier.model:
        return
    try:
        os.makedirs(os.path.dirname(_MODEL_CACHE_PATH), exist_ok=True)
        with open(_MODEL_CACHE_PATH, "w") as f:
            json.dump({
                "means": classifier.model.means,
                "variances": classifier.model.variances,
                "transition": classifier.model.transition,
                "priors": classifier.model.priors,
            }, f)
    except Exception:
        pass


def _load_model():
    """Load a previously trained model from disk on startup."""
    try:
        if os.path.exists(_MODEL_CACHE_PATH):
            with open(_MODEL_CACHE_PATH, "r") as f:
                data = json.load(f)
            classifier.model = RegimeModel(
                means=data["means"],
                variances=data["variances"],
                transition=data["transition"],
                priors=data["priors"],
            )
    except Exception:
        pass


# Load persisted model on import
_load_model()


def _apply_model(data: dict) -> None:
    classifier.model = RegimeModel(
        means=data["means"],
        variances=data["variances"],
        transition=data["transition"],
        priors=data["priors"],
    )


async def _persist_model_db():
    """Persiste le modèle dans signal_models — survit aux restarts ET rebuilds."""
    if not classifier.model:
        return
    try:
        pool = await get_shared_pool()
        payload = json.dumps({
            "means": classifier.model.means,
            "variances": classifier.model.variances,
            "transition": classifier.model.transition,
            "priors": classifier.model.priors,
        })
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO signal_models(name, model_json)
                VALUES($1, $2::jsonb)
                ON CONFLICT (name) DO UPDATE
                SET model_json = EXCLUDED.model_json, updated_at = now()
                """,
                _DB_MODEL_NAME, payload,
            )
    except Exception:
        pass


async def _ensure_model():
    """Charge le modèle depuis la DB si absent de la mémoire/fichier."""
    if classifier.model:
        return
    try:
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT model_json FROM signal_models WHERE name = $1", _DB_MODEL_NAME
            )
        if row and row.get("model_json"):
            data = row["model_json"]
            if isinstance(data, str):
                data = json.loads(data)
            _apply_model(data)
    except Exception:
        pass


class TrainRequest(BaseModel):
    prices: List[float] = Field(..., min_length=20, description="List of closing prices")


class TrainResponse(BaseModel):
    states: List[str]
    means: List[float]
    variances: List[float]
    transition: List[List[float]]
    priors: List[float]


class PredictRequest(BaseModel):
    prices: List[float] = Field(..., min_length=5)


class PredictResponse(BaseModel):
    regimes: List[str]


@router.post("/ml/regime/train", response_model=TrainResponse)
async def train_regime_model(body: TrainRequest):
    try:
        model = classifier.train(body.prices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _save_model()
    await _persist_model_db()
    regimes = classifier.predict(body.prices)
    return TrainResponse(
        states=regimes,
        means=model.means,
        variances=model.variances,
        transition=model.transition,
        priors=model.priors,
    )


@router.post("/ml/regime/auto-train")
async def auto_train_regime():
    """Fetch real BTC daily closes from Binance and train the regime classifier.
    This endpoint is meant to be called by a cron job so the model stays trained
    after restarts without manual intervention.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.binance.com/api/v3/klines",
                params={"symbol": "BTCUSDT", "interval": "1d", "limit": 200},
            )
            r.raise_for_status()
            data = r.json()
        prices = [float(bar[4]) for bar in data]  # close price is index 4
        if len(prices) < 20:
            raise HTTPException(status_code=500, detail="Not enough price data from Binance")
        model = classifier.train(prices)
        _save_model()
        await _persist_model_db()
        regimes = classifier.predict(prices)
        return {
            "trained": True,
            "samples": len(prices),
            "states": regimes,
            "means": model.means,
            "variances": model.variances,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"auto_train_failed: {exc}") from exc


@router.post("/ml/regime/predict", response_model=PredictResponse)
async def predict_regime(body: PredictRequest):
    await _ensure_model()
    try:
        regimes = classifier.predict(body.prices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PredictResponse(regimes=regimes)


@router.get("/ml/regime/status")
async def regime_status():
    await _ensure_model()
    if not classifier.model:
        return {"trained": False}
    model: RegimeModel = classifier.model
    return {
        "states": STATE_LABELS,
        "means": model.means,
        "variances": model.variances,
        "transition": model.transition,
        "priors": model.priors,
    }
