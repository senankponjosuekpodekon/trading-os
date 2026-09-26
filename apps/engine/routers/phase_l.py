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
    limit: int = Query(10, ge=1, le=100),
    refresh: bool = Query(False),
):
    from ml.hidden_gems import discover_hidden_gems, _cache, _CACHE_TTL
    import time

    now = time.monotonic()
    key = f"hiddengems:{min_liquidity}:{min_volume}"
    data = _cache.get("gems")
    if not refresh and data and (now - _cache["ts"]) < _CACHE_TTL and _cache.get("key") == key:
        return dict(data, gems=(data.get("gems") or [])[:limit])

    if not refresh:
        from utils.cache import cache as _redis
        rc = await _redis.get(key)
        if rc:
            out = dict(rc, gems=(rc.get("gems") or [])[:limit])
            _cache["gems"], _cache["ts"], _cache["key"] = out, now, key
            return out

    try:
        result = await discover_hidden_gems(
            min_liquidity=min_liquidity,
            min_volume=min_volume,
            limit=limit,
        )
        _cache["gems"] = result
        _cache["ts"] = now
        _cache["key"] = key
        from utils.cache import cache as _redis
        await _redis.set(key, result, ttl=_CACHE_TTL * 3)
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Hidden gems unavailable: {exc}") from exc


@router.get("/ml/hidden-gems/backtest")
async def hidden_gems_backtest(min_hours: float = Query(24, ge=1)):
    """GET /ml/hidden-gems/backtest — calibration du gem_score :
    score enregistré au snapshot vs performance prix mesurée depuis."""
    from ml.hidden_gems import gems_backtest
    return await gems_backtest(min_hours=min_hours)


@router.get("/ml/hidden-gems/model-status")
async def gem_model_status(retrain: bool = Query(False)):
    """GET /ml/hidden-gems/model-status — état du modèle auto-calibré :
    samples, AUC in-sample, win rate, date d'entraînement. retrain=true force."""
    from ml.gem_model import load_gem_model, train_gem_model
    if retrain:
        return await train_gem_model()
    model = await load_gem_model()
    if not model:
        return {"status": "collecting", "note": "modèle pas encore entraîné — snapshots en accumulation"}
    return {"status": "trained", "samples": model["samples"], "auc": model.get("auc"),
            "win_rate": model.get("win_rate"), "trained_at": model.get("trained_at"),
            "horizon_h": model.get("horizon_h"), "win_threshold": model.get("win_threshold")}


@router.get("/ml/smart-money/status")
async def smart_money_status_endpoint():
    """GET /ml/smart-money/status — état de l'index smart-money :
    wallets/deployers trackés par chaîne, tokens jugés, couverture Etherscan."""
    from ml.smart_money import smart_money_status
    return await smart_money_status()


@router.get("/ml/majors/trajectory")
async def majors_trajectory_endpoint(
    limit: int = Query(15, ge=1, le=30),
    refresh: bool = Query(False),
):
    """GET /ml/majors/trajectory — trajectoires longitudinales des majors
    (prix/volume/mcap sur la série de snapshots, commentaire auto par actif)."""
    from ml.majors_tracker import majors_trajectory
    return await majors_trajectory(limit=limit, refresh=refresh)


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
