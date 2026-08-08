"""Market cap tier classification for crypto assets.

Tiers:
  MICRO  < $50M
  SMALL  $50M – $500M
  MID    $500M – $10B
  LARGE  > $10B

Source: CoinGecko API (free, no key required) with in-memory cache (TTL 1h).
For non-crypto assets, tier is inferred from asset type.
"""
import asyncio

import httpx

from utils.cache import cache

_CACHE_TTL = 3600  # 1 hour
_CACHE_PREFIX = "mcap:"

# Fallback static tiers for well-known assets (updated manually)
_STATIC_TIERS: dict[str, str] = {
    "BTC": "LARGE", "ETH": "LARGE", "BNB": "LARGE", "SOL": "LARGE",
    "XRP": "LARGE", "ADA": "LARGE", "AVAX": "MID", "DOT": "MID",
    "LINK": "MID", "MATIC": "MID", "ATOM": "MID", "LTC": "MID",
    "TRX": "MID", "TON": "MID", "DOGE": "LARGE",
    "SHIB": "MID", "PEPE": "SMALL", "WIF": "SMALL",
    "PAXG": "MID",
}


def _tier_from_mcap(mcap_usd: float) -> str:
    if mcap_usd < 50_000_000:
        return "MICRO"
    if mcap_usd < 500_000_000:
        return "SMALL"
    if mcap_usd < 10_000_000_000:
        return "MID"
    return "LARGE"


async def fetch_market_cap_tier(symbol: str) -> str:
    """Return market cap tier for a crypto symbol (MICRO/SMALL/MID/LARGE).

    Uses CoinGecko API with Redis cache. Falls back to static tiers for
    well-known assets, and defaults to MID for unknown crypto.
    """
    base = symbol.split("/")[0].upper()

    # Non-crypto assets get deterministic tiers
    # (caller should only pass crypto, but be defensive)
    if base in _STATIC_TIERS:
        return _STATIC_TIERS[base]

    # Check Redis cache
    try:
        cached = await cache.get(f"{_CACHE_PREFIX}{base}")
        if cached:
            return cached if isinstance(cached, str) else str(cached)
    except Exception:
        pass

    # CoinGecko API (free, no key)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Search for coin ID
            resp = await client.get(
                "https://api.coingecko.com/api/v3/search",
                params={"query": base},
            )
            if resp.status_code == 200:
                coins = resp.json().get("coins", [])
                if coins:
                    coin_id = coins[0]["id"]
                    # Fetch market data
                    detail = await client.get(
                        f"https://api.coingecko.com/api/v3/coins/{coin_id}",
                        params={"localization": "false", "tickers": "false",
                                "market_data": "true", "community_data": "false",
                                "developer_data": "false", "sparkline": "false"},
                    )
                    if detail.status_code == 200:
                        mcap = detail.json().get("market_data", {}).get("market_cap", {}).get("usd")
                        if mcap and isinstance(mcap, (int, float)):
                            tier = _tier_from_mcap(float(mcap))
                            # Cache it
                            try:
                                await cache.set(f"{_CACHE_PREFIX}{base}", tier, ttl=_CACHE_TTL)
                            except Exception:
                                pass
                            return tier
    except (httpx.HTTPError, asyncio.TimeoutError, Exception):
        pass

    # Default for unknown crypto
    return "MID"


def get_market_cap_tier_sync(symbol: str, asset_type: str) -> str:
    """Synchronous fallback — uses static tiers or asset-type defaults."""
    if asset_type != "CRYPTO":
        if asset_type in ("FOREX", "COMMODITY"):
            return "LARGE"
        if asset_type in ("SYNTHETIC",):
            return "LARGE"
        if asset_type == "BRVM":
            return "SMALL"
        if asset_type == "US_STOCK":
            return "LARGE"
        return "MID"

    base = symbol.split("/")[0].upper()
    return _STATIC_TIERS.get(base, "MID")
