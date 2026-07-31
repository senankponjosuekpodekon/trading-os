from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

_feedback_store: Dict[str, List[dict]] = {}
_leaderboard_store: Dict[str, Dict] = {}


class SignalFeedback(BaseModel):
    signal_id: str
    grade: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None
    outcome: Optional[float] = None


@router.post("/feedback")
async def submit_feedback(user_id: str, feedback: SignalFeedback):
    """Store user feedback for a signal and update its quality score."""
    entry = feedback.dict()
    entry["user_id"] = user_id
    _feedback_store.setdefault(feedback.signal_id, []).append(entry)

    # Update leaderboard
    lb = _leaderboard_store.setdefault(user_id, {"user_id": user_id, "feedbacks": 0, "avg_grade": 0.0})
    lb["feedbacks"] += 1
    all_grades = [e["grade"] for entries in _feedback_store.values() for e in entries if e.get("user_id") == user_id]
    lb["avg_grade"] = round(sum(all_grades) / len(all_grades), 2) if all_grades else 0.0

    return {"status": "ok", "feedback_id": len(_feedback_store[feedback.signal_id])}


@router.get("/feedback/{signal_id}")
async def get_feedback(signal_id: str):
    """Return all feedback entries for a signal."""
    return {"data": _feedback_store.get(signal_id, [])}


@router.get("/feedback/{signal_id}/stats")
async def feedback_stats(signal_id: str):
    """Compute average grade and estimated quality score."""
    entries = _feedback_store.get(signal_id, [])
    if not entries:
        return {"average_grade": 0, "feedback_count": 0, "estimated_quality": 0}
    avg = sum(e["grade"] for e in entries) / len(entries)
    outcomes = [e["outcome"] for e in entries if e.get("outcome") is not None]
    avg_outcome = sum(outcomes) / len(outcomes) if outcomes else 0
    estimated_quality = min(100, round((avg / 5) * 100 + avg_outcome * 10))
    return {
        "average_grade": round(avg, 2),
        "feedback_count": len(entries),
        "estimated_quality": estimated_quality,
    }


@router.get("/leaderboard")
async def leaderboard(limit: int = 20):
    """Return top feedback contributors."""
    ranked = sorted(
        _leaderboard_store.values(),
        key=lambda x: x.get("feedbacks", 0),
        reverse=True,
    )
    return {"data": ranked[:limit]}


@router.post("/feedback/{signal_id}/recalculate")
async def recalculate_quality(signal_id: str):
    """Recalculate and store estimated quality for a signal."""
    return await feedback_stats(signal_id)
