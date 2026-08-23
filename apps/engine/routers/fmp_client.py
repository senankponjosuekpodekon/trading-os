"""Financial Modeling Prep client with 24h Redis cache and rate limiting."""
from __future__ import annotations
from typing import Any, Optional
import asyncio

import httpx

import config
from utils.cache import get_cached, set_cached
from utils.http import retry_async
from utils.semaphores import get_semaphore
from utils.logger import get_logger


logger = get_logger(__name__)

FMP_BASE = "https://financialmodelingprep.com/api/v3"


def _to_ticker(symbol: str) -> Optional[str]:
    """Convert internal symbol (AAPL/USD) to FMP ticker (AAPL)."""
    if symbol.endswith("/USD"):
        return symbol[:-4]
    if "/" not in symbol:
        return symbol
    return None


def _has_key() -> bool:
    return bool(config.settings.fmp_api_key)


async def _fmp_get(client: httpx.AsyncClient, endpoint: str) -> Any | None:
    if not _has_key():
        logger.debug("fmp_key_missing", endpoint=endpoint)
        return None

    url = f"{FMP_BASE}/{endpoint}?apikey={config.settings.fmp_api_key}"

    async def _request() -> Any:
        async with get_semaphore("fmp"):
            response = await client.get(url, timeout=10.0)
            if response.status_code == 429:
                logger.warning("fmp_rate_limited", endpoint=endpoint)
                # Do not retry 429 automatically; caller can fallback.
                raise httpx.HTTPStatusError(
                    "Rate limited", request=response.request, response=response
                )
            response.raise_for_status()
            return response.json()

    try:
        return await retry_async(_request, max_retries=1, base_delay=1.0, source="fmp")
    except Exception as exc:
        logger.warning("fmp_request_failed", endpoint=endpoint, error=str(exc))
        return None


async def _cached_fmp(
    symbol: str,
    client: httpx.AsyncClient,
    endpoint: str,
    cache_key: str,
    ttl: int = 86400,
) -> Any | None:
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached
    data = await _fmp_get(client, endpoint)
    if data is not None:
        await set_cached(cache_key, data, ttl=ttl)
    return data


async def fetch_fmp_profile(symbol: str) -> Optional[dict]:
    """Return PE, EPS, market cap, dividend and sector info for a stock."""
    ticker = _to_ticker(symbol)
    if not ticker:
        return None
    async with httpx.AsyncClient() as client:
        data = await _cached_fmp(
            symbol, client, f"profile/{ticker}", f"fmp:profile:{symbol}"
        )
    if not data or not isinstance(data, list) or not data:
        return None
    p = data[0]
    return {
        "pe": _as_float(p.get("pe")),
        "eps": _as_float(p.get("eps")),
        "market_cap": _as_float(p.get("mktCap")),
        "dividend_yield": _as_float(p.get("lastDiv")),
        "sector": p.get("sector"),
        "industry": p.get("industry"),
        "country": p.get("country"),
        "currency": p.get("currency"),
        "company_name": p.get("companyName"),
    }


async def fetch_fmp_earnings(symbol: str) -> Optional[list[dict]]:
    """Return recent earnings calendar/surprises for a stock."""
    ticker = _to_ticker(symbol)
    if not ticker:
        return None
    async with httpx.AsyncClient() as client:
        data = await _cached_fmp(
            symbol, client, f"earnings/{ticker}", f"fmp:earnings:{symbol}"
        )
    if not data or not isinstance(data, list):
        return None
    return [
        {
            "date": e.get("date"),
            "eps": _as_float(e.get("eps")),
            "eps_estimated": _as_float(e.get("epsEstimated")),
            "revenue": _as_float(e.get("revenue")),
            "revenue_estimated": _as_float(e.get("revenueEstimated")),
        }
        for e in data
    ]


async def fetch_fundamentals(symbol: str) -> Optional[dict]:
    """Combine profile + earnings into a single fundamental snapshot."""
    profile, earnings = await asyncio.gather(
        fetch_fmp_profile(symbol),
        fetch_fmp_earnings(symbol),
    )
    if profile is None:
        return None
    return {
        "symbol": symbol,
        **profile,
        "earnings": earnings or [],
    }


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


