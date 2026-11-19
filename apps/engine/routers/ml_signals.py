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
    signal_id: Optional[str] = None


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
    """Prédit avec le modèle ACTIF : logistique par défaut, XGBoost si
    l'auto-promotion l'a couronné (flag data/model_promotion.json)."""
    try:
        from ml.model_promotion import active_model
        if active_model() == "xgboost":
            from ml.xgboost_scorer import xgboost_scorer
            await xgboost_scorer._ensure_state()
            result = await xgboost_scorer.predict(body.features)
            result["model"] = "xgboost"
            return result
        return await signal_scorer.predict(body.features)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── XGBoost Shadow Mode ──────────────────────────────────────────────────────

@router.post("/ml/predict-shadow")
async def shadow_predict(body: PredictRequest):
    """POST /ml/predict-shadow — Run both logistic + XGBoost, return comparison."""
    from ml.xgboost_shadow import shadow_predict as _shadow
    try:
        return await _shadow(body.features, signal_id=body.signal_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/ml/shadow-stats")
async def shadow_stats():
    """GET /ml/shadow-stats — XGBoost shadow mode comparison statistics."""
    from ml.xgboost_shadow import get_shadow_stats
    return get_shadow_stats()


@router.post("/ml/shadow-reset")
async def shadow_reset():
    """POST /ml/shadow-reset — Reset shadow mode statistics."""
    from ml.xgboost_shadow import reset_shadow_stats
    reset_shadow_stats()
    return {"reset": True}


@router.post("/ml/train-xgboost")
async def train_xgboost(body: TrainRequest):
    """POST /ml/train-xgboost — Train the XGBoost scorer (shadow mode)."""
    from ml.xgboost_scorer import XGBoostSignalScorer
    try:
        scorer = XGBoostSignalScorer()
        result = await scorer.train(
            market=body.market,
            timeframe=body.timeframe,
            limit=body.limit,
        )
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/ml/promotion-status")
async def promotion_status():
    """GET /ml/promotion-status — modèle actif + précisions comparées sur
    outcomes réels (auto-promotion)."""
    from ml.model_promotion import promotion_status as _status
    return _status()


@router.get("/ml/xgboost-status")
async def xgboost_status():
    """GET /ml/xgboost-status — XGBoost scorer status."""
    from ml.xgboost_scorer import XGBoostSignalScorer
    scorer = XGBoostSignalScorer()
    return await scorer.status()
