"""
Phase L — Portfolio Rebalancing + Hidden Gems + AI Defense endpoints.
- POST /ml/rebalance : portfolio rebalancing suggestions
- GET  /ml/hidden-gems : discover undervalued tokens
- POST /ml/ai-defense : run AI defense checks for a symbol
"""
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


# ── Portfolio Rebalancing ────────────────────────────────────────────────────

class RebalanceRequest(BaseModel):
    positions: List[Dict[str, Any]]
    profile: str = Field("moderate", description="conservative | moderate | aggressive")
    total_capital: Optional[float] = None
    portfolio_risk: Optional[Dict[str, Any]] = None


@router.post("/ml/rebalance")
async def rebalance(body: RebalanceRequest):
    from ml.portfolio_rebalancing import compute_rebalancing
    return compute_rebalancing(
        body.positions,
        profile=body.profile,
        total_capital=body.total_capital,
        portfolio_risk=body.portfolio_risk,
    )


# ── Hidden Gems ──────────────────────────────────────────────────────────────

@router.get("/ml/hidden-gems")
async def hidden_gems(
    min_liquidity: float = Query(50_000, ge=0),
    min_volume: float = Query(100_000, ge=0),
    limit: int = Query(10, ge=1, le=50),
    refresh: bool = Query(False),
):
    from ml.hidden_gems import discover_hidden_gems, _cache, _CACHE_TTL
    import time

    now = time.monotonic()
    if not refresh and _cache["gems"] and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["gems"]

    try:
        result = await discover_hidden_gems(
            min_liquidity=min_liquidity,
            min_volume=min_volume,
            limit=limit,
        )
        _cache["gems"] = result
        _cache["ts"] = now
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Hidden gems unavailable: {exc}") from exc


# ── AI Defense ───────────────────────────────────────────────────────────────

class DefenseRequest(BaseModel):
    symbol: str
    price_change_24h: float = 0
    price_change_1h: float = 0
    volume_24h: float = 0
    liquidity: float = 0
    liquidity_24h_ago: float = 0
    age_hours: float = 0
    social_score: float = 0
    social_volume: int = 0
    atr_pct: float = 0
    vix: float = 0


@router.post("/ml/ai-defense")
async def ai_defense(body: DefenseRequest):
    from ml.ai_defense import run_defense_checks
    return run_defense_checks(
        body.symbol,
        price_change_24h=body.price_change_24h,
        price_change_1h=body.price_change_1h,
        volume_24h=body.volume_24h,
        liquidity=body.liquidity,
        liquidity_24h_ago=body.liquidity_24h_ago,
        age_hours=body.age_hours,
        social_score=body.social_score,
        social_volume=body.social_volume,
        atr_pct=body.atr_pct,
        vix=body.vix,
    )
