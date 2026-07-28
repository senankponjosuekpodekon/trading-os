"""API endpoints for regime classifier training/prediction."""
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ml.regime_classifier import RegimeClassifier, RegimeModel, STATE_LABELS

router = APIRouter()
classifier = RegimeClassifier()


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
    regimes = classifier.predict(body.prices)
    return TrainResponse(
        states=regimes,
        means=model.means,
        variances=model.variances,
        transition=model.transition,
        priors=model.priors,
    )


@router.post("/ml/regime/predict", response_model=PredictResponse)
async def predict_regime(body: PredictRequest):
    try:
        regimes = classifier.predict(body.prices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PredictResponse(regimes=regimes)


@router.get("/ml/regime/status")
async def regime_status():
    if not classifier.model:
        raise HTTPException(status_code=404, detail="model_not_trained")
    model: RegimeModel = classifier.model
    return {
        "states": STATE_LABELS,
        "means": model.means,
        "variances": model.variances,
        "transition": model.transition,
        "priors": model.priors,
    }
