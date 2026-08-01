"""
Sprint 7 — Données on-chain / marchés dérivés.
Fournit le contexte crypto : funding rate, open interest, spot-perp basis, BTC dominance.
"""
from fastapi import APIRouter, HTTPException
import httpx
import asyncio
from typing import Optional

from utils.rate_limiter import rate_limit
from utils.http import retry_async

router = APIRouter()

BINANCE_SPOT = "https://api.binance.com/api/v3"
BINANCE_FUT = "https://fapi.binance.com/fapi/v1"
COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global"

_cache: dict[str, tuple[float, any]] = {}
CACHE_TTL = 300  # 5 min


def _get(key: str):
    import time
    if key in _cache:
        ts, val = _cache[key]
        if time.monotonic() - ts < CACHE_TTL:
            return val
    return None


def _set(key: str, val: any):
    import time
    _cache[key] = (time.monotonic(), val)


def _binance_symbol(symbol: str) -> str:
    base = symbol.split("/")[0]
    return f"{base}USDT"


@rate_limit(max_concurrent=5, min_delay=0.1)
async def _binance_get(url: str, params: Optional[dict] = None):
    async def _do():
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, max_retries=1, base_delay=0.5, source="binance")


@router.get("/funding/{symbol}")
async def funding_rate(symbol: str):
    """Dernier funding rate Binance Futures pour un symbole."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"funding:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _binance_get(f"{BINANCE_FUT}/fundingRate", params={"symbol": bin_sym, "limit": 1})
        if not data:
            raise HTTPException(status_code=404, detail=f"No funding data for {symbol}")
        entry = data[0]
        rate = float(entry.get("fundingRate", 0))
        result = {
            "symbol": symbol,
            "funding_rate": round(rate * 100, 4),  # %
            "annualized": round(rate * 100 * 3 * 365, 2),  # 3x par jour
            "timestamp": entry.get("fundingTime"),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Funding rate unavailable: {e}") from e


@router.get("/open-interest/{symbol}")
async def open_interest(symbol: str):
    """Open interest Binance Futures."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"oi:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _binance_get(f"{BINANCE_FUT}/openInterest", params={"symbol": bin_sym})
        result = {
            "symbol": symbol,
            "open_interest": float(data.get("openInterest", 0)),
            "timestamp": data.get("closeTime"),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Open interest unavailable: {e}") from e


@router.get("/spot-perp-basis/{symbol}")
async def spot_perp_basis(symbol: str):
    """Écart prix perpétuel vs spot (premium/discount)."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"basis:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        spot, perp = await asyncio.gather(
            _binance_get(f"{BINANCE_SPOT}/ticker/price", params={"symbol": bin_sym}),
            _binance_get(f"{BINANCE_FUT}/ticker/price", params={"symbol": bin_sym}),
        )
        spot_price = float(spot.get("price", 0))
        perp_price = float(perp.get("price", 0))
        if spot_price <= 0:
            raise ValueError("spot price missing")
        basis = (perp_price - spot_price) / spot_price * 100
        result = {
            "symbol": symbol,
            "spot_price": spot_price,
            "perp_price": perp_price,
            "basis_pct": round(basis, 3),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Basis unavailable: {e}") from e


@router.get("/btc-dominance")
async def btc_dominance():
    """BTC dominance from CoinGecko."""
    cache_key = "btc_dominance"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(COINGECKO_GLOBAL)
                r.raise_for_status()
                return r.json()
        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        btc = data.get("data", {}).get("market_cap_percentage", {}).get("btc", 0)
        result = {"btc_dominance": round(float(btc), 2)}
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"BTC dominance unavailable: {e}") from e


CRYPTO_BASES = {"BTC", "ETH", "SOL", "BNB", "AVAX", "XRP", "LINK", "ADA", "DOT", "MATIC"}


def is_crypto_symbol(symbol: str) -> bool:
    return symbol.endswith("/USDT") and symbol.split("/")[0] in CRYPTO_BASES


def onchain_bonus(
    context: dict,
    signal_direction: str,
    fear_greed_value: Optional[int] = None,
) -> tuple[int, list[str]]:
    """
    Bonus/malus de score basé sur le contexte on-chain (Fear&Greed + Funding Rate).
    signal_direction : 'BUY' | 'SELL'. Max : ±25 pts.
    """
    bonus = 0
    reasons: list[str] = []

    # Fear & Greed (contrarian)
    if fear_greed_value is not None:
        if fear_greed_value < 20:
            if signal_direction == "BUY":
                bonus += 20
                reasons.append(f"On-chain: Fear&Greed extreme fear ({fear_greed_value}) — contrarian BUY")
            else:
                bonus -= 15
                reasons.append(f"On-chain: Fear&Greed extreme fear ({fear_greed_value}) — SELL affaibli")
        elif fear_greed_value > 80:
            if signal_direction == "SELL":
                bonus += 20
                reasons.append(f"On-chain: Fear&Greed extreme greed ({fear_greed_value}) — contrarian SELL")
            else:
                bonus -= 15
                reasons.append(f"On-chain: Fear&Greed extreme greed ({fear_greed_value}) — BUY affaibli")

    # Funding rate (squeeze)
    funding = (context or {}).get("funding_rate") or {}
    rate = funding.get("funding_rate")
    if rate is not None:
        if rate < -0.01 and signal_direction == "BUY":
            bonus += 15
            reasons.append(f"On-chain: funding négatif ({rate}%) — shorts surpeuplés, long squeeze")
        elif rate > 0.05 and signal_direction == "SELL":
            bonus += 15
            reasons.append(f"On-chain: funding élevé ({rate}%) — longs surpeuplés, short squeeze")

    bonus = max(-25, min(25, bonus))
    return bonus, reasons


@router.get("/context/{symbol}")
async def onchain_context(symbol: str):
    """Agrège les données on-chain pour un symbole crypto."""
    if not is_crypto_symbol(symbol):
        return {}

    results = await asyncio.gather(
        funding_rate(symbol),
        open_interest(symbol),
        spot_perp_basis(symbol),
        btc_dominance(),
        return_exceptions=True,
    )
    return {
        "funding_rate": results[0] if not isinstance(results[0], Exception) else None,
        "open_interest": results[1] if not isinstance(results[1], Exception) else None,
        "spot_perp_basis": results[2] if not isinstance(results[2], Exception) else None,
        "btc_dominance": results[3] if not isinstance(results[3], Exception) else None,
    }
