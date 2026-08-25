"""Coinalyze router — CEX futures metrics for tokens.

Endpoints: funding rate, open interest, liquidation history, long/short ratio.
Uses COINALYZE_API_KEY (header `api_key`).
"""
from __future__ import annotations

import os
from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

COINALYZE_BASE = "https://api.coinalyze.net/v1"


def _api_key() -> str | None:
    return os.getenv("COINALYZE_API_KEY")


async def _coinalyze_get(endpoint: str, params: dict) -> List[dict]:
    token = _api_key()
    if not token:
        raise HTTPException(status_code=400, detail="COINALYZE_API_KEY not configured")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{COINALYZE_BASE}/{endpoint}",
                headers={"api_key": token},
                params=params,
            )
            if r.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid Coinalyze API key")
            if r.status_code == 429:
                raise HTTPException(status_code=429, detail="Coinalyze rate limit")
            if r.status_code != 200:
                return []
            return r.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Coinalyze error: {exc}") from exc


@router.get("/futures/funding-rate")
async def get_funding_rate(symbols: str = Query(..., description="Comma-separated symbols, e.g. BTCUSDT_PERP.A")):
    """Current funding rate for the given perpetual symbols."""
    return await _coinalyze_get("funding-rate", {"symbols": symbols})


@router.get("/futures/open-interest")
async def get_open_interest(symbols: str = Query(..., description="Comma-separated symbols")):
    """Current open interest for the given perpetual symbols."""
    return await _coinalyze_get("open-interest", {"symbols": symbols})


@router.get("/futures/liquidations")
async def get_liquidations(
    symbols: str = Query(..., description="Comma-separated symbols"),
    interval: str = Query("1h", description="Interval, e.g. 1h, 4h, 1d"),
    limit: int = Query(100, ge=1, le=1000),
):
    """Liquidation history for the given symbols."""
    return await _coinalyze_get(
        "liquidation-history",
        {"symbols": symbols, "interval": interval, "limit": limit},
    )


@router.get("/futures/long-short-ratio")
async def get_long_short_ratio(symbols: str = Query(..., description="Comma-separated symbols")):
    """Long/short ratio for the given symbols."""
    return await _coinalyze_get("long-short-ratio", {"symbols": symbols})
