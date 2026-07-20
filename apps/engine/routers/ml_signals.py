"""ML endpoints for training the signal scorer from the feature store."""
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ml.signal_scorer import signal_scorer

router = APIRouter()


class TrainRequest(BaseModel):
    market: Optional[str] = Field(None, description="Market name filter (CRYPTO/FOREX/etc.)")
    timeframe: Optional[str] = Field(None, description="Timeframe filter, e.g. 1h")
    limit: int = Field(2000, ge=100, le=5000)


class PredictRequest(BaseModel):
    features: Dict[str, Any]


@router.post("/ml/train")
async def train_signal_scorer(body: TrainRequest):
    result = await signal_scorer.train(
        market=body.market,
        timeframe=body.timeframe,
        limit=body.limit,
    )
    return result


@router.get("/ml/status")
async def signal_scorer_status():
    return await signal_scorer.status()


@router.post("/ml/predict")
async def signal_scorer_predict(body: PredictRequest):
    try:
        return await signal_scorer.predict(body.features)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
