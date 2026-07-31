"""
DEX token discovery — detect new tokens on DEXes before they reach CMC/CEX.
Sources: DexScreener (free, no key, 300 req/min) + GeckoTerminal (free, no key, 10 req/min).
"""
import time
from typing import Optional
from fastapi import APIRouter, HTTPException

from utils.rate_limiter import rate_limit

router = APIRouter()

DEXSCREENER_BASE = "https://api.dexscreener.com"
GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2"

_cache: dict[str, tuple[float, any]] = {}
CACHE_TTL = 120  # 2 min


def _get(key: str):
    if key in _cache:
        ts, val = _cache[key]
        if time.monotonic() - ts < CACHE_TTL:
            return val
    return None


def _set(key: str, val: any):
    _cache[key] = (time.monotonic(), val)


@rate_limit(max_concurrent=5, min_delay=0.2)
async def _http_get(url: str, params: Optional[dict] = None):
    import httpx
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params=params or {})
        r.raise_for_status()
        return r.json()


# ── DexScreener: search pairs across all chains ───────────────────
@router.get("/search")
async def search_dex_pairs(q: str):
    """Search DEX pairs by token name, symbol, or address across 80+ chains."""
    cache_key = f"search:{q}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _http_get(f"{DEXSCREENER_BASE}/latest/dex/search", params={"q": q})
        pairs = data.get("pairs", []) if isinstance(data, dict) else []
        results = []
        for p in pairs[:30]:
            results.append({
                "chain": p.get("chainId"),
                "dex": p.get("dexId"),
                "pair_address": p.get("pairAddress"),
                "base_token": {
                    "address": p.get("baseToken", {}).get("address"),
                    "name": p.get("baseToken", {}).get("name"),
                    "symbol": p.get("baseToken", {}).get("symbol"),
                },
                "quote_token": {
                    "symbol": p.get("quoteToken", {}).get("symbol"),
                },
                "price_usd": float(p.get("priceUsd", 0) or 0),
                "price_native": float(p.get("priceNative", 0) or 0),
                "liquidity_usd": float((p.get("liquidity") or {}).get("usd", 0) or 0),
                "volume_24h": float((p.get("volume") or {}).get("h24", 0) or 0),
                "tx_24h": (
                    int((p.get("txns") or {}).get("h24", {}).get("buys", 0))
                    + int((p.get("txns") or {}).get("h24", {}).get("sells", 0))
                ),
                "price_change_24h": float((p.get("priceChange") or {}).get("h24", 0) or 0),
                "fdv": float(p.get("fdv", 0) or 0),
                "market_cap": float(p.get("marketCap", 0) or 0),
                "pair_created_at": p.get("pairCreatedAt"),
                "url": p.get("url"),
                "info": {
                    "socials": p.get("info", {}).get("socials", []) if p.get("info") else [],
                    "websites": p.get("info", {}).get("websites", []) if p.get("info") else [],
                },
            })
        _set(cache_key, {"query": q, "count": len(results), "pairs": results})
        return {"query": q, "count": len(results), "pairs": results}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DexScreener search failed: {e}") from e


# ── DexScreener: latest token profiles (newly listed) ─────────────
@router.get("/new-tokens")
async def latest_token_profiles():
    """Get latest token profiles from DexScreener (newly listed/enhanced tokens)."""
    cache_key = "new_tokens"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _http_get(f"{DEXSCREENER_BASE}/token-profiles/latest/v1")
        if not isinstance(data, list):
            return {"count": 0, "tokens": []}
        tokens = []
        for t in data[:50]:
            tokens.append({
                "chain": t.get("chainId"),
                "token_address": t.get("tokenAddress"),
                "url": t.get("url"),
                "icon": t.get("icon"),
                "header": t.get("header"),
                "description": t.get("description"),
                "links": t.get("links", []),
            })
        _set(cache_key, {"count": len(tokens), "tokens": tokens})
        return {"count": len(tokens), "tokens": tokens}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DexScreener new tokens failed: {e}") from e


# ── DexScreener: top boosted tokens (trending) ────────────────────
@router.get("/trending")
async def top_boosted_tokens():
    """Get top boosted tokens from DexScreener (trending on DEX)."""
    cache_key = "trending"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _http_get(f"{DEXSCREENER_BASE}/token-boosts/top/v1")
        if not isinstance(data, list):
            return {"count": 0, "tokens": []}
        tokens = []
        for t in data[:30]:
            tokens.append({
                "chain": t.get("chainId"),
                "token_address": t.get("tokenAddress"),
                "url": t.get("url"),
                "icon": t.get("icon"),
                "header": t.get("header"),
                "description": t.get("description"),
                "links": t.get("links", []),
                "boosts": t.get("numberOfBoosts", 0),
                "total_boosts": t.get("totalAmount", 0),
            })
        _set(cache_key, {"count": len(tokens), "tokens": tokens})
        return {"count": len(tokens), "tokens": tokens}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DexScreener trending failed: {e}") from e


# ── DexScreener: token details by address ─────────────────────────
@router.get("/token/{chain}/{token_address}")
async def get_token_pairs(chain: str, token_address: str):
    """Get all DEX pairs for a specific token on a specific chain."""
    cache_key = f"token:{chain}:{token_address}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _http_get(
            f"{DEXSCREENER_BASE}/token-pairs/v1/{chain}/{token_address}"
        )
        if not isinstance(data, list):
            return {"count": 0, "pairs": []}
        pairs = []
        for p in data[:20]:
            pairs.append({
                "pair_address": p.get("pairAddress"),
                "dex": p.get("dexId"),
                "price_usd": float(p.get("priceUsd", 0) or 0),
                "liquidity_usd": float((p.get("liquidity") or {}).get("usd", 0) or 0),
                "volume_24h": float((p.get("volume") or {}).get("h24", 0) or 0),
                "tx_24h": (
                    int((p.get("txns") or {}).get("h24", {}).get("buys", 0))
                    + int((p.get("txns") or {}).get("h24", {}).get("sells", 0))
                ),
                "price_change_24h": float((p.get("priceChange") or {}).get("h24", 0) or 0),
                "fdv": float(p.get("fdv", 0) or 0),
                "market_cap": float(p.get("marketCap", 0) or 0),
                "pair_created_at": p.get("pairCreatedAt"),
                "url": p.get("url"),
            })
        _set(cache_key, {"chain": chain, "token": token_address, "count": len(pairs), "pairs": pairs})
        return {"chain": chain, "token": token_address, "count": len(pairs), "pairs": pairs}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DexScreener token pairs failed: {e}") from e


# ── GeckoTerminal: new pools (last 48h) ───────────────────────────
@router.get("/new-pools")
async def new_pools(network: Optional[str] = None):
    """
    Get newly created liquidity pools (last 48h) from GeckoTerminal.
    If network is specified, filter to that chain only.
    """
    cache_key = f"new_pools:{network or 'all'}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        if network:
            url = f"{GECKOTERMINAL_BASE}/networks/{network}/new_pools"
        else:
            url = f"{GECKOTERMINAL_BASE}/networks/new_pools"
        data = await _http_get(url)
        pools_data = data.get("data", []) if isinstance(data, dict) else []
        pools = []
        for p in pools_data[:50]:
            attrs = p.get("attributes", {})
            rels = p.get("relationships", {})
            base_token_id = (rels.get("base_token") or {}).get("data", {}).get("id", "")
            pools.append({
                "pool_address": attrs.get("address"),
                "name": attrs.get("name"),
                "base_token_price_usd": float(attrs.get("base_token_price_usd", 0) or 0),
                "quote_token_price_usd": float(attrs.get("quote_token_price_usd", 0) or 0),
                "pool_created_at": attrs.get("pool_created_at"),
                "reserve_in_usd": float(attrs.get("reserve_in_usd", 0) or 0),
                "fdv_usd": float(attrs.get("fdv_usd", 0) or 0),
                "market_cap_usd": float(attrs.get("market_cap_usd", 0) or 0),
                "volume_24h": float((attrs.get("volume_usd") or {}).get("h24", 0) or 0),
                "tx_24h_buys": int((attrs.get("transactions_count") or {}).get("h24", {}).get("buys", 0)),
                "tx_24h_sells": int((attrs.get("transactions_count") or {}).get("h24", {}).get("sells", 0)),
                "base_token_id": base_token_id,
            })
        _set(cache_key, {"network": network or "all", "count": len(pools), "pools": pools})
        return {"network": network or "all", "count": len(pools), "pools": pools}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"GeckoTerminal new pools failed: {e}") from e


# ── GeckoTerminal: trending pools ─────────────────────────────────
@router.get("/trending-pools")
async def trending_pools(network: Optional[str] = None):
    """Get trending pools from GeckoTerminal."""
    cache_key = f"trending_pools:{network or 'all'}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        if network:
            url = f"{GECKOTERMINAL_BASE}/networks/{network}/trending_pools"
        else:
            url = f"{GECKOTERMINAL_BASE}/networks/trending_pools"
        data = await _http_get(url)
        pools_data = data.get("data", []) if isinstance(data, dict) else []
        pools = []
        for p in pools_data[:30]:
            attrs = p.get("attributes", {})
            pools.append({
                "pool_address": attrs.get("address"),
                "name": attrs.get("name"),
                "base_token_price_usd": float(attrs.get("base_token_price_usd", 0) or 0),
                "reserve_in_usd": float(attrs.get("reserve_in_usd", 0) or 0),
                "fdv_usd": float(attrs.get("fdv_usd", 0) or 0),
                "market_cap_usd": float(attrs.get("market_cap_usd", 0) or 0),
                "volume_24h": float((attrs.get("volume_usd") or {}).get("h24", 0) or 0),
                "price_change_24h": float((attrs.get("price_change_percentage") or {}).get("h24", 0) or 0),
                "tx_24h_buys": int((attrs.get("transactions_count") or {}).get("h24", {}).get("buys", 0)),
                "tx_24h_sells": int((attrs.get("transactions_count") or {}).get("h24", {}).get("sells", 0)),
            })
        _set(cache_key, {"network": network or "all", "count": len(pools), "pools": pools})
        return {"network": network or "all", "count": len(pools), "pools": pools}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"GeckoTerminal trending pools failed: {e}") from e


# ── Moonshot risk assessment for a DEX token ──────────────────────
@router.get("/risk-check/{chain}/{token_address}")
async def dex_risk_check(chain: str, token_address: str):
    """
    Red flags checklist for a DEX-traded token (moonshot risk assessment).
    Combines DexScreener pair data with basic risk heuristics.
    """
    cache_key = f"risk:{chain}:{token_address}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _http_get(
            f"{DEXSCREENER_BASE}/token-pairs/v1/{chain}/{token_address}"
        )
        if not isinstance(data, list) or not data:
            raise HTTPException(status_code=404, detail="Token not found on DEX")

        # Aggregate across all pairs
        total_liquidity = sum(float((p.get("liquidity") or {}).get("usd", 0) or 0) for p in data)
        total_volume_24h = sum(float((p.get("volume") or {}).get("h24", 0) or 0) for p in data)
        total_tx_24h = sum(
            int((p.get("txns") or {}).get("h24", {}).get("buys", 0))
            + int((p.get("txns") or {}).get("h24", {}).get("sells", 0))
            for p in data
        )
        fdv = float(data[0].get("fdv", 0) or 0)
        market_cap = float(data[0].get("marketCap", 0) or 0)
        pair_count = len(data)
        oldest_pair = min(
            (p.get("pairCreatedAt", 0) for p in data if p.get("pairCreatedAt")),
            default=0,
        )

        # ── Red flags checklist ──
        red_flags = []
        warnings = []
        risk_score = 0  # 0 = safe, 100 = extreme risk

        # 1. Liquidity check
        if total_liquidity < 10_000:
            red_flags.append(f"EXTREME: Liquidity ${total_liquidity:,.0f} < $10K — rug pull risk")
            risk_score += 30
        elif total_liquidity < 100_000:
            warnings.append(f"HIGH: Liquidity ${total_liquidity:,.0f} < $100K — low liquidity")
            risk_score += 15
        elif total_liquidity < 500_000:
            warnings.append(f"MODERATE: Liquidity ${total_liquidity:,.0f} < $500K")
            risk_score += 5

        # 2. Volume / liquidity ratio (wash trading detection)
        if total_liquidity > 0:
            vol_liq_ratio = total_volume_24h / total_liquidity
            if vol_liq_ratio > 50:
                red_flags.append(f"EXTREME: Volume/liquidity ratio {vol_liq_ratio:.1f}x — possible wash trading")
                risk_score += 25
            elif vol_liq_ratio > 20:
                warnings.append(f"HIGH: Volume/liquidity ratio {vol_liq_ratio:.1f}x — suspicious activity")
                risk_score += 10

        # 3. Market cap / FDV ratio (token unlock risk)
        if fdv > 0 and market_cap > 0:
            mc_fdv_ratio = market_cap / fdv
            if mc_fdv_ratio < 0.3:
                red_flags.append(f"EXTREME: MC/FDV ratio {mc_fdv_ratio:.2f} — {((1-mc_fdv_ratio)*100):.0f}% of tokens unlocked, dump risk")
                risk_score += 20
            elif mc_fdv_ratio < 0.5:
                warnings.append(f"HIGH: MC/FDV ratio {mc_fdv_ratio:.2f} — large unlocked supply")
                risk_score += 10

        # 4. Pair age (new token = higher risk)
        if oldest_pair:
            age_hours = (time.time() - oldest_pair / 1000) / 3600 if oldest_pair > 1e12 else (time.time() - oldest_pair) / 3600
            if age_hours < 24:
                red_flags.append(f"EXTREME: Token created {age_hours:.1f}h ago — brand new, extreme risk")
                risk_score += 20
            elif age_hours < 72:
                warnings.append(f"HIGH: Token created {age_hours:.1f}h ago — very new")
                risk_score += 10
            elif age_hours < 168:
                warnings.append(f"MODERATE: Token created {age_hours:.1f}h ago — relatively new")
                risk_score += 5

        # 5. Pair count (single DEX = higher risk)
        if pair_count == 1:
            warnings.append("MODERATE: Only 1 DEX pair — limited market access")
            risk_score += 5

        # 6. Tx count (low activity = potential dead token)
        if total_tx_24h < 10:
            warnings.append(f"LOW: Only {total_tx_24h} transactions in 24h — low activity")
            risk_score += 5

        # Determine risk level
        if risk_score >= 60:
            risk_level = "EXTREME"
        elif risk_score >= 35:
            risk_level = "HIGH"
        elif risk_score >= 15:
            risk_level = "MODERATE"
        else:
            risk_level = "LOW"

        result = {
            "chain": chain,
            "token_address": token_address,
            "risk_level": risk_level,
            "risk_score": min(risk_score, 100),
            "red_flags": red_flags,
            "warnings": warnings,
            "metrics": {
                "total_liquidity_usd": round(total_liquidity, 2),
                "total_volume_24h": round(total_volume_24h, 2),
                "total_tx_24h": total_tx_24h,
                "fdv": round(fdv, 2),
                "market_cap": round(market_cap, 2),
                "pair_count": pair_count,
                "oldest_pair_timestamp": oldest_pair,
            },
            "market_cap_tier": (
                "MICRO" if market_cap < 50e6 else
                "SMALL" if market_cap < 1e9 else
                "MID" if market_cap < 10e9 else
                "LARGE"
            ),
            "source": "dexscreener",
        }
        _set(cache_key, result)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Risk check failed: {e}") from e
