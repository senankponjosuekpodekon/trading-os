"""Whale tracker router — on-chain accumulation/distribution signals."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Path, Query

router = APIRouter()

# Tokens supported by CryptoQuant base slug mapping
CRYPTOQUANT_SUPPORTED = {"btc", "eth", "xrp", "ltc", "bch", "ada", "sol"}


def _cryptoquant_slug(symbol: str) -> str | None:
    s = symbol.lower().strip()
    return s if s in CRYPTOQUANT_SUPPORTED else None


async def _fetch_cryptoquant(
    symbol: str, endpoint: str, params: Dict[str, Any]
) -> List[Dict[str, Any]]:
    token = os.getenv("CRYPTOQUANT_API_KEY")
    if not token:
        return []
    slug = _cryptoquant_slug(symbol)
    if not slug:
        return []
    base = "https://api.cryptoquant.com/v1"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"{base}/{slug}/{endpoint}",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            if r.status_code != 200:
                return []
            payload = r.json()
            result = payload.get("result", {})
            data = result.get("data") if isinstance(result, dict) else None
            return data if isinstance(data, list) else []
    except Exception:
        return []


async def _fetch_exchange_netflow(symbol: str, limit: int = 7) -> float:
    """Net inflow to exchanges: positive = deposit/pressure, negative = withdrawal."""
    data = await _fetch_cryptoquant(
        symbol,
        "exchange-flows/netflow",
        {"window": "day", "limit": limit, "exchange": "all_exchange"},
    )
    if not data:
        return 0.0
    total = sum(float(pt.get("netflow_total", 0) or 0) for pt in data)
    return round(total, 4)


async def _fetch_whale_ratio(symbol: str, limit: int = 7) -> float:
    """Average exchange whale ratio over N days."""
    data = await _fetch_cryptoquant(
        symbol,
        "flow-indicator/exchange-whale-ratio",
        {"window": "day", "limit": limit, "exchange": "all_exchange"},
    )
    if not data:
        return 0.0
    values = [float(pt.get("exchange_whale_ratio", 0) or 0) for pt in data]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


async def _fetch_large_transactions(symbol: str, limit: int = 7) -> int:
    """Count of large transactions (> $100k) on the network."""
    data = await _fetch_cryptoquant(
        symbol,
        "network-data/large-transactions",
        {"window": "day", "limit": limit},
    )
    if not data:
        return 0
    return sum(int(pt.get("transaction_count", 0) or 0) for pt in data)


def _compute_whale_signal(
    netflow_7d: float,
    whale_ratio: float,
    large_tx: int,
) -> tuple[str, int, List[str]]:
    """Determine accumulation/distribution regime and a 0-100 score."""
    signals: List[str] = []
    score = 50

    if netflow_7d < 0:
        score += 20
        signals.append("Exchange outflows (accumulation)")
    elif netflow_7d > 0:
        score -= 20
        signals.append("Exchange inflows (distribution)")

    # High whale ratio > 0.9 often means whale-led selling pressure
    if whale_ratio > 0.9:
        score -= 15
        signals.append("High whale inflow ratio (>0.9) — distribution risk")
    elif whale_ratio > 0.7:
        score -= 5
    elif 0.2 < whale_ratio < 0.5:
        score += 10
        signals.append("Whale ratio healthy — low selling pressure")

    if large_tx > 100:
        score += 10 if netflow_7d < 0 else -10
        signals.append("Elevated whale transactions")

    if score >= 70:
        regime = "ACCUMULATION"
    elif score >= 45:
        regime = "NEUTRAL"
    else:
        regime = "DISTRIBUTION"

    score = max(0, min(100, score))
    return regime, score, signals


@router.get("/whale-tracker/{asset}")
async def get_whale_tracker(
    asset: str = Path(..., description="Asset symbol, e.g. BTC, ETH"),
    days: int = Query(7, ge=1, le=30),
):
    """Return whale accumulation/distribution signal for an asset."""
    if not _cryptoquant_slug(asset):
        raise HTTPException(
            status_code=400,
            detail=f"Asset {asset} is not supported by CryptoQuant. Try {', '.join(sorted(CRYPTOQUANT_SUPPORTED))}."
        )

    netflow = await _fetch_exchange_netflow(asset, limit=days)
    whale_ratio = await _fetch_whale_ratio(asset, limit=days)
    large_tx = await _fetch_large_transactions(asset, limit=days)
    regime, score, signals = _compute_whale_signal(netflow, whale_ratio, large_tx)

    return {
        "asset": asset.upper(),
        "window_days": days,
        "regime": regime,
        "whale_score": score,
        "netflow_7d": netflow,
        "whale_ratio_7d_avg": whale_ratio,
        "large_transactions_7d": large_tx,
        "signals": signals,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
