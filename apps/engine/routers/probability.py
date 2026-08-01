"""
Probability Engine
Continuation advice for post-trade management (TP1 → TP2 decision).
"""
from typing import Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


def continuation_score(
    direction: str,
    price: float,
    entry: float,
    tp1: float,
    tp2: float,
    adx: float,
    structure_intact: bool,
    volume_increasing: bool,
    divergence_htf: bool = False,
) -> Dict[str, Any]:
    """
    Evaluate whether a position that reached TP1 should continue toward TP2
    or switch to trailing / break-even because the trend is weakening.

    Returns a score (0-100) and a recommended action.
    """
    if direction.upper() not in ("BUY", "SELL"):
        raise ValueError("direction must be BUY or SELL")

    distance_tp1 = abs(tp1 - entry)
    if distance_tp1 == 0:
        progress = 0.0
    else:
        if direction.upper() == "BUY":
            progress = (price - entry) / distance_tp1
        else:
            progress = (entry - price) / distance_tp1

    score = 0.0
    score += min(40, adx * 0.6)  # ADX contribution, max 40
    score += 25 if structure_intact else 0
    score += 15 if volume_increasing else 0
    score += max(-20, min(30, progress * 25))
    score -= 40 if divergence_htf else 0
    score = float(min(100.0, max(0.0, score)))

    if divergence_htf or score < 30:
        action = "EXHAUSTED"
    elif progress >= 1.0 and score >= 65:
        action = "ACTIVATE_TRAILING"
    elif progress >= 1.0:
        action = "MOVE_TO_BREAK_EVEN"
    else:
        action = "HOLD"

    return {
        "score": round(score, 2),
        "progress": round(progress, 4),
        "action": action,
        "tp2_valid": score >= 65 and structure_intact and not divergence_htf,
    }

class ContinuationRequest(BaseModel):
    direction: str
    price: float
    entry: float
    tp1: float
    tp2: float
    adx: float = 25.0
    structure_intact: bool = True
    volume_increasing: bool = False
    divergence_htf: bool = False


class ContinuationResponse(BaseModel):
    score: float
    progress: float
    action: str
    tp2_valid: bool
    reason: str


ACTION_REASON = {
    "HOLD": "Rester dans le trade et conserver le plan initial.",
    "MOVE_TO_BREAK_EVEN": "TP1 atteint sans force suffisante : déplacer le SL au point d'entrée.",
    "ACTIVATE_TRAILING": "Momentum confirmé : activer le trailing stop pour verrouiller les gains.",
    "EXHAUSTED": "Signal d'épuisement : envisager une sortie partielle ou totale.",
}


@router.post("/probability/continuation", response_model=ContinuationResponse)
def continuation_advice(req: ContinuationRequest):
    result = continuation_score(
        direction=req.direction,
        price=req.price,
        entry=req.entry,
        tp1=req.tp1,
        tp2=req.tp2,
        adx=req.adx,
        structure_intact=req.structure_intact,
        volume_increasing=req.volume_increasing,
        divergence_htf=req.divergence_htf,
    )
    return ContinuationResponse(
        score=result["score"],
        progress=result["progress"],
        action=result["action"],
        tp2_valid=result["tp2_valid"],
        reason=ACTION_REASON[result["action"]],
    )
