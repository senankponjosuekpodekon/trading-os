"""
Social sentiment layer — LunarCrush integration.
Optional API key; when missing/unreachable we fallback to a plausible mock table.
"""
import httpx
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException

from config import settings
from utils.rate_limiter import rate_limit
from utils.http import retry_async

router = APIRouter()

LUNARCRUSH_API_KEY = settings.lunarcrush_api_key
LUNARCRUSH_BASE = "https://api.lunarcrush.com/v2"

# Mock social metrics by symbol for demo / API-fail fallback
_SOCIAL_MOCK = {
    "BTC": {"galaxy_score": 62, "alt_rank": 12, "social_dominance": 18.5, "interactions_per_post": 245},
    "ETH": {"galaxy_score": 58, "alt_rank": 18, "social_dominance": 12.3, "interactions_per_post": 198},
    "SOL": {"galaxy_score": 71, "alt_rank": 5, "social_dominance": 8.7, "interactions_per_post": 320},
    "ADA": {"galaxy_score": 45, "alt_rank": 35, "social_dominance": 2.1, "interactions_per_post": 85},
    "DOT": {"galaxy_score": 39, "alt_rank": 42, "social_dominance": 1.4, "interactions_per_post": 60},
    "AVAX": {"galaxy_score": 52, "alt_rank": 28, "social_dominance": 2.8, "interactions_per_post": 110},
    "LINK": {"galaxy_score": 48, "alt_rank": 31, "social_dominance": 2.5, "interactions_per_post": 95},
    "MATIC": {"galaxy_score": 41, "alt_rank": 40, "social_dominance": 1.8, "interactions_per_post": 70},
    "BNB": {"galaxy_score": 55, "alt_rank": 22, "social_dominance": 4.5, "interactions_per_post": 140},
    "XRP": {"galaxy_score": 64, "alt_rank": 10, "social_dominance": 7.2, "interactions_per_post": 260},
    "DOGE": {"galaxy_score": 68, "alt_rank": 8, "social_dominance": 9.1, "interactions_per_post": 410},
    "UNI": {"galaxy_score": 44, "alt_rank": 36, "social_dominance": 1.2, "interactions_per_post": 55},
    "AAVE": {"galaxy_score": 47, "alt_rank": 33, "social_dominance": 1.0, "interactions_per_post": 48},
    "LDO": {"galaxy_score": 43, "alt_rank": 38, "social_dominance": 0.9, "interactions_per_post": 42},
    "ARB": {"galaxy_score": 49, "alt_rank": 29, "social_dominance": 1.6, "interactions_per_post": 88},
    "OP": {"galaxy_score": 46, "alt_rank": 34, "social_dominance": 1.3, "interactions_per_post": 65},
}


def _symbol_base(symbol: str) -> str:
    return symbol.split("/")[0]


@rate_limit(max_concurrent=5, min_delay=0.1)
async def _http_get(url: str, params: Optional[dict] = None, source: str = "lunarcrush"):
    async def _do():
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params or {})
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, max_retries=1, base_delay=0.5, source=source)


async def fetch_social_metrics(symbol: str) -> dict:
    """Fetch LunarCrush social metrics for a symbol. Fallback to mock if no key/failure."""
    base = _symbol_base(symbol)
    if not LUNARCRUSH_API_KEY:
        return _mock_metrics(base)

    try:
        data = await _http_get(
            f"{LUNARCRUSH_BASE}",
            params={
                "data": "assets",
                "key": LUNARCRUSH_API_KEY,
                "symbol": base,
                "interval": "day",
                "data_points": 1,
            },
        )
        assets = data.get("data") if isinstance(data, dict) else data
        if assets and isinstance(assets, list):
            asset = assets[0]
            return {
                "symbol": base,
                "galaxy_score": float(asset.get("galaxy_score", 0)),
                "alt_rank": int(asset.get("alt_rank", 0)),
                "social_dominance": float(asset.get("social_dominance", 0)),
                "interactions_per_post": float(asset.get("average_interactions_per_post", 0)),
                "source": "lunarcrush",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
    except Exception:
        pass
    return _mock_metrics(base)


def _mock_metrics(base: str) -> dict:
    defaults = {"galaxy_score": 50, "alt_rank": 50, "social_dominance": 1.0, "interactions_per_post": 50}
    data = _SOCIAL_MOCK.get(base, defaults)
    return {
        "symbol": base,
        **data,
        "source": "mock",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/{symbol}")
async def social_endpoint(symbol: str):
    """Endpoint: GET /social/{symbol} → social metrics."""
    try:
        return await fetch_social_metrics(symbol)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Social sentiment unavailable: {e}") from e


def social_bonus(metrics: dict, signal_direction: str) -> tuple[int, list[str]]:
    """
    Social momentum bonus.
    Galaxy Score > 60 + AltRank improving (< 20) → +12 pts in signal direction.
    Enhanced with FinBERT sentiment when available.
    """
    bonus = 0
    reasons = []
    galaxy = metrics.get("galaxy_score", 0) or 0
    alt_rank = metrics.get("alt_rank", 999) or 999
    dominance = metrics.get("social_dominance", 0) or 0

    if galaxy > 60 and alt_rank < 20:
        bonus += 12
        reasons.append(f"Social: Galaxy Score {galaxy:.0f} + AltRank {alt_rank} trending → momentum {signal_direction}")
    elif galaxy > 55 and dominance > 5:
        bonus += 8
        reasons.append(f"Social: dominance {dominance:.1f}% + Galaxy {galaxy:.0f} → mild momentum")

    # FinBERT sentiment enhancement (Phase K integration)
    finbert_label = metrics.get("finbert_label")
    finbert_score = metrics.get("finbert_score", 0) or 0
    if finbert_label:
        direction_match = (
            (finbert_label == "positive" and signal_direction == "BUY") or
            (finbert_label == "negative" and signal_direction == "SELL")
        )
        if direction_match and abs(finbert_score) > 0.3:
            bonus += min(int(abs(finbert_score) * 10), 8)
            reasons.append(f"FinBERT: {finbert_label} sentiment ({finbert_score:+.2f}) aligns with {signal_direction}")
        elif not direction_match and abs(finbert_score) > 0.3:
            bonus -= min(int(abs(finbert_score) * 5), 5)
            reasons.append(f"FinBERT: {finbert_label} sentiment ({finbert_score:+.2f}) conflicts with {signal_direction}")

    return bonus, reasons
