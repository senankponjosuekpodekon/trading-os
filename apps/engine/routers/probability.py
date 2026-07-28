"""
Probability Engine
Computes directional consensus, trade quality, entry-zone coherence,
take-profit targets and trailing stop updates from structural inputs.
"""
from typing import List, Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


def direction_engine(agent_scores: List[float]) -> float:
    """
    Aggregate directional agent scores into a 0-100 probability.
    Scores are expected in [-1, +1] where +1 = fully bullish, -1 = fully bearish.
    """
    if not agent_scores:
        return 50.0
    mean = sum(agent_scores) / len(agent_scores)
    return float(min(100.0, max(0.0, mean * 50 + 50)))


def trade_quality_probability(direction_prob: float, rr: float) -> Dict[str, Any]:
    """
    Combine directional probability and risk/reward into a quality score.
    R/R is capped at 3.0 to avoid over-weighting unrealistic targets.
    """
    capped_rr = min(rr, 3.0)
    quality = direction_prob * (capped_rr / 3.0)
    quality = round(min(100.0, max(0.0, quality)), 2)
    status = "ACCEPTED" if quality >= 60 else "REJECTED"
    return {"quality": quality, "status": status}


def entry_zone(
    entry: float,
    ob_zone: Dict[str, float],
    fvg_zone: Dict[str, float],
) -> Dict[str, Any]:
    """
    Check whether an entry is coherent with an Order Block and a Fair Value Gap.
    Returns overlap interval and a coherence flag.
    """
    ob_min, ob_max = min(ob_zone["min"], ob_zone["max"]), max(ob_zone["min"], ob_zone["max"])
    fvg_min, fvg_max = min(fvg_zone["min"], fvg_zone["max"]), max(fvg_zone["min"], fvg_zone["max"])

    overlap_min = max(ob_min, fvg_min)
    overlap_max = min(ob_max, fvg_max)
    coherent = overlap_min <= overlap_max and overlap_min <= entry <= overlap_max

    return {
        "coherent": coherent,
        "overlap": {"min": overlap_min, "max": overlap_max},
        "contradiction": not coherent,
    }


def tp_targets(
    entry: float,
    stop_loss: float,
    direction: str,
    targets_rr: List[float] = None,
) -> List[Dict[str, Any]]:
    """
    Build TP1/TP2/TP3 with prices, R/R and decreasing probabilities.
    """
    if targets_rr is None:
        targets_rr = [2.0, 3.0, 4.0]

    distance = abs(entry - stop_loss)
    if distance == 0:
        distance = 1e-9

    results: List[Dict[str, Any]] = []
    for rr in targets_rr:
        if direction.upper() == "BUY":
            price = entry + rr * distance
        elif direction.upper() == "SELL":
            price = entry - rr * distance
        else:
            raise ValueError("direction must be BUY or SELL")

        probability = round(min(95.0, max(5.0, 80.0 / (1.0 + rr * 0.35))), 2)
        results.append({
            "rr": rr,
            "price": round(price, 6),
            "probability": probability,
        })
    return results


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


def trailing_sl(new_structure: float, current_sl: float, direction: str) -> float:
    """
    Update the stop loss when a new Higher Low (BUY) or Lower High (SELL) forms.
    A 1 % buffer is kept inside the structure to avoid noise wicks.
    """
    if direction.upper() == "BUY":
        # Move stop just under the new higher low, never lower
        candidate = new_structure * 0.99
        return round(max(current_sl, candidate), 6)
    elif direction.upper() == "SELL":
        # Move stop just above the new lower high, never higher
        candidate = new_structure * 1.01
        return round(min(current_sl, candidate), 6)
    else:
        raise ValueError("direction must be BUY or SELL")


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
