"""
Phase I — ML Advanced endpoints.
- POST /ml/train-xgboost : train XGBoost signal scorer
- GET /ml/xgboost-status : XGBoost model status
- POST /ml/xgboost-predict : predict with XGBoost
- POST /ml/finbert-sentiment : batch sentiment analysis
- POST /ml/token-grade : compute token grade 0-100
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


# ── XGBoost endpoints ────────────────────────────────────────────────────────

class TrainXGBRequest(BaseModel):
    market: Optional[str] = None
    timeframe: Optional[str] = None
    limit: int = Field(2000, ge=100, le=5000)


class PredictXGBRequest(BaseModel):
    features: Dict[str, Any]


@router.post("/ml/train-xgboost")
async def train_xgboost(body: TrainXGBRequest):
    from ml.xgboost_scorer import xgboost_scorer
    result = await xgboost_scorer.train(
        market=body.market,
        timeframe=body.timeframe,
        limit=body.limit,
    )
    return result


@router.get("/ml/xgboost-status")
async def xgboost_status():
    from ml.xgboost_scorer import xgboost_scorer
    await xgboost_scorer._ensure_state()
    return await xgboost_scorer.status()


@router.post("/ml/xgboost-predict")
async def xgboost_predict(body: PredictXGBRequest):
    from ml.xgboost_scorer import xgboost_scorer
    await xgboost_scorer._ensure_state()
    try:
        return await xgboost_scorer.predict(body.features)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── FinBERT sentiment endpoints ──────────────────────────────────────────────

class SentimentRequest(BaseModel):
    text: str
    texts: Optional[List[str]] = None


@router.post("/ml/finbert-sentiment")
async def finbert_sentiment(body: SentimentRequest):
    from ml.finbert_sentiment import analyze_sentiment, analyze_batch, aggregate_sentiment, get_sentiment_bonus

    if body.texts and len(body.texts) > 0:
        results = analyze_batch(body.texts)
        agg = aggregate_sentiment(body.texts)
        bonus = get_sentiment_bonus(agg["overall_label"], agg["overall_score"])
        return {
            "mode": "batch",
            "aggregate": agg,
            "sentiment_bonus": round(bonus, 2),
            "items": [
                {"label": r.label, "score": r.score, "confidence": r.confidence, "text": r.text[:200]}
                for r in results
            ],
        }
    else:
        result = analyze_sentiment(body.text)
        bonus = get_sentiment_bonus(result.label, result.score)
        return {
            "mode": "single",
            "label": result.label,
            "score": result.score,
            "confidence": result.confidence,
            "sentiment_bonus": round(bonus, 2),
        }


# ── Token Grade endpoint ─────────────────────────────────────────────────────

class TokenGradeRequest(BaseModel):
    symbol: str
    technical_score: Optional[float] = None
    technical_confidence: Optional[float] = None
    onchain_bonus: Optional[float] = None
    social_score: Optional[float] = None
    tokenomics_penalty: Optional[float] = None
    tokenomics_danger: Optional[bool] = None
    volatility_pct: Optional[float] = None
    return_pct: Optional[float] = None


@router.post("/ml/token-grade")
async def compute_grade(body: TokenGradeRequest):
    from ml.token_grade import compute_token_grade, grade_to_dict
    grade = compute_token_grade(
        symbol=body.symbol,
        technical_score=body.technical_score,
        technical_confidence=body.technical_confidence,
        onchain_bonus=body.onchain_bonus,
        social_score=body.social_score,
        tokenomics_penalty=body.tokenomics_penalty,
        tokenomics_danger=body.tokenomics_danger,
        volatility_pct=body.volatility_pct,
        return_pct=body.return_pct,
    )
    return grade_to_dict(grade)
