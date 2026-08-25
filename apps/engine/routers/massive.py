"""Massive (massive.com) data proxy — crypto, stocks, forex.

Uses MASSIVE_API_KEY via Authorization: Bearer.
Free plan limited, so failures are non-fatal.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Path, Query

import config
from utils.http import retry_async

router = APIRouter()

MASSIVE_BASE = "https://api.massive.com/v3"


def _api_key() -> str | None:
    return config.settings.massive_api_key or None


async def _massive_get(path: str) -> Any:
    token = _api_key()
    if not token:
        raise HTTPException(status_code=400, detail="MASSIVE_API_KEY not configured")

    url = f"{MASSIVE_BASE}/{path}"
    
    async def _do_request() -> Any:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )
            if r.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid Massive API key")
            if r.status_code == 429:
                raise HTTPException(status_code=429, detail="Massive rate limit")
            if r.status_code != 200:
                return {"error": f"Massive returned {r.status_code}", "detail": r.text}
            return r.json()
    
    try:
        return await retry_async(_do_request, max_retries=2, base_delay=0.5, source="massive")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Massive error: {exc}") from exc


@router.get("/ticker/{ticker}")
async def massive_ticker(
    ticker: str = Path(..., description="Massive ticker, e.g. X:BTCUSD"),
):
    """Ticker overview from Massive."""
    return await _massive_get(f"tickers/{ticker}")


@router.get("/ohlcv/{ticker}")
async def massive_ohlcv(
    ticker: str = Path(..., description="Massive ticker, e.g. X:BTCUSD"),
    multiplier: int = Query(1, ge=1),
    timespan: str = Query("day", description="minute, hour, day, week, month, quarter, year"),
    from_date: str = Query(..., description="YYYY-MM-DD or millisecond timestamp"),
    to_date: str = Query(..., description="YYYY-MM-DD or millisecond timestamp"),
    limit: int = Query(1000, ge=1, le=50000),
):
    """Custom OHLCV bars from Massive."""
    path = f"aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from_date}/{to_date}?limit={limit}"
    return await _massive_get(path)
