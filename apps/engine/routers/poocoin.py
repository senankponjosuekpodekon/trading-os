"""PooCoin BSC DEX candle proxy.

The official PooCoin site fetches via an obfuscated `data` query parameter.
We use the direct `api2.poocoin.app/candles-bsc` query-param endpoint,
which accepts lpAddress, baseLp, interval, limit and to as described in
current community reverse-engineering.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

POOCOIN_BASE = "https://api2.poocoin.app"


async def _poocoin_get(path: str, params: dict) -> Any:
    url = f"{POOCOIN_BASE}{path}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=headers, params=params)
            if r.status_code == 403:
                raise HTTPException(
                    status_code=403,
                    detail="PooCoin blocked the request — user-agent or IP may be restricted",
                )
            if r.status_code == 429:
                raise HTTPException(status_code=429, detail="PooCoin rate limit")
            if r.status_code != 200:
                return {"error": f"PooCoin returned {r.status_code}", "detail": r.text}
            return r.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"PooCoin error: {exc}") from exc


@router.get("/candles-bsc")
async def poocoin_candles_bsc(
    lpAddress: str = Query(..., description="PancakeSwap LP pair contract address"),
    interval: str = Query("15m", description="e.g. 5m, 15m, 1h, 4h, 1d"),
    limit: int = Query(100, ge=1, le=1000),
    to: str = Query(
        datetime.now(timezone.utc).isoformat(),
        description="ISO timestamp for the newest candle",
    ),
    baseLp: str | None = Query(
        None,
        description="Optional base LP address (stable-coin side)",
    ),
):
    """BSC token candles from PooCoin."""
    params: dict[str, Any] = {
        "lpAddress": lpAddress,
        "interval": interval,
        "limit": limit,
        "to": to,
    }
    if baseLp:
        params["baseLp"] = baseLp
    return await _poocoin_get("/candles-bsc", params)
