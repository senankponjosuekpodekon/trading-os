"""
Hidden Gems Discovery — Phase L
Discovers undervalued tokens by combining on-chain metrics, tokenomics,
social sentiment, and DEX data. Scores tokens on a 0-100 "gem score".

Sources:
  - DEX Screener: liquidity, volume, age, price change
  - Tokenomics: unlock safety, distribution
  - Social: Reddit/YouTube sentiment buzz
  - On-chain: holder growth, whale activity (if available)
"""
from __future__ import annotations

from typing import Any, Dict, List
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)

# Cache
_cache: dict = {"gems": None, "ts": 0.0}
_CACHE_TTL = 600  # 10 min


@dataclass
class GemCandidate:
    symbol: str
    name: str
    chain: str
    price: float
    liquidity: float
    volume_24h: float
    price_change_24h: float
    age_hours: float
    gem_score: int
    reasons: List[str]
    warnings: List[str]
    social_buzz: float
    tokenomics_safety: float


def _compute_gem_score(
    liquidity: float,
    volume_24h: float,
    price_change_24h: float,
    age_hours: float,
    social_buzz: float = 0.0,
    tokenomics_safety: float = 50.0,
) -> tuple[int, List[str], List[str]]:
    """
    Compute a 0-100 gem score.
    Higher = more promising hidden gem.
    """
    score = 0
    reasons: List[str] = []
    warnings: List[str] = []

    # 1. Liquidity (0-25 pts)
    if liquidity >= 500_000:
        score += 25
        reasons.append(f"High liquidity (${liquidity:,.0f})")
    elif liquidity >= 100_000:
        score += 18
        reasons.append(f"Good liquidity (${liquidity:,.0f})")
    elif liquidity >= 30_000:
        score += 10
        reasons.append(f"Moderate liquidity (${liquidity:,.0f})")
    else:
        score += 3
        warnings.append(f"Low liquidity (${liquidity:,.0f}) — high slippage risk")

    # 2. Volume / Liquidity ratio (0-20 pts) — high volume vs liquidity = interest
    vol_liq_ratio = volume_24h / max(liquidity, 1)
    if vol_liq_ratio >= 3.0:
        score += 20
        reasons.append(f"Very high volume/liquidity ratio ({vol_liq_ratio:.1f}x) — strong interest")
    elif vol_liq_ratio >= 1.0:
        score += 14
        reasons.append(f"Good volume/liquidity ratio ({vol_liq_ratio:.1f}x)")
    elif vol_liq_ratio >= 0.3:
        score += 8
    else:
        score += 2
        warnings.append("Low trading volume relative to liquidity")

    # 3. Age — newer tokens with traction are interesting (0-15 pts)
    if age_hours <= 72 and age_hours > 0:
        score += 15
        reasons.append(f"New token ({age_hours:.0f}h old) with early traction")
    elif age_hours <= 168:  # 1 week
        score += 10
        reasons.append(f"Recent token ({age_hours/24:.0f}d old)")
    elif age_hours <= 720:  # 30 days
        score += 5
    else:
        score += 2  # established token, less "hidden"

    # 4. Price change — moderate gains better than extreme (0-15 pts)
    if 5 <= price_change_24h <= 50:
        score += 15
        reasons.append(f"Healthy 24h gain ({price_change_24h:+.1f}%)")
    elif -10 <= price_change_24h <= 5:
        score += 10
        reasons.append(f"Stable price ({price_change_24h:+.1f}%) — accumulation phase?")
    elif price_change_24h > 100:
        score += 5
        warnings.append(f"Extreme 24h pump ({price_change_24h:+.1f}%) — FOMO risk")
    elif price_change_24h > 50:
        score += 8
        warnings.append(f"Large 24h gain ({price_change_24h:+.1f}%) — pullback risk")
    elif price_change_24h < -30:
        score += 3
        warnings.append(f"Sharp 24h drop ({price_change_24h:+.1f}%) — possible capitulation")

    # 5. Social buzz (0-15 pts)
    if social_buzz > 0.3:
        score += 15
        reasons.append(f"Strong social buzz (score: {social_buzz:.2f})")
    elif social_buzz > 0.1:
        score += 10
        reasons.append(f"Growing social attention (score: {social_buzz:.2f})")
    elif social_buzz > 0:
        score += 5

    # 6. Tokenomics safety (0-10 pts)
    if tokenomics_safety >= 80:
        score += 10
        reasons.append("Safe tokenomics (no major unlocks)")
    elif tokenomics_safety >= 60:
        score += 6
    elif tokenomics_safety < 30:
        score += 0
        warnings.append("Dangerous tokenomics — large unlock imminent")

    score = max(0, min(100, score))
    return score, reasons, warnings


async def _fetch_dex_trending() -> List[Dict[str, Any]]:
    """Fetch trending tokens from DexScreener."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # DexScreener trending endpoint
            r = await client.get("https://api.dexscreener.com/token-boosts/top/v1")
            r.raise_for_status()
            data = r.json()

        tokens = []
        for item in data[:30]:  # Top 30 boosted tokens
            tokens.append({
                "symbol": item.get("symbol", ""),
                "name": item.get("name", ""),
                "chain": item.get("chainId", ""),
                "pair_address": item.get("pairAddress", ""),
                "price": float(item.get("priceNative", 0) or 0),
                "liquidity": float(item.get("liquidity", {}).get("usd", 0) or 0),
                "volume_24h": float(item.get("volume", {}).get("h24", 0) or 0),
                "price_change_24h": float(item.get("priceChange", {}).get("h24", 0) or 0),
                "age_hours": 0,  # Not directly available
                "url": item.get("url", ""),
                "socials": item.get("links", {}),
                "description": item.get("description", ""),
            })
        return tokens
    except Exception as exc:
        logger.warning("dex_trending_fetch_failed", error=str(exc))
        return []


async def _fetch_dex_search(query: str = "trending") -> List[Dict[str, Any]]:
    """Fallback: search DexScreener for popular pairs."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.dexscreener.com/latest/dex/search",
                params={"q": query},
            )
            r.raise_for_status()
            data = r.json()

        pairs = data.get("pairs", [])[:20]
        tokens = []
        for p in pairs:
            tokens.append({
                "symbol": p.get("baseToken", {}).get("symbol", ""),
                "name": p.get("baseToken", {}).get("name", ""),
                "chain": p.get("chainId", ""),
                "price": float(p.get("priceUsd", 0) or 0),
                "liquidity": float(p.get("liquidity", {}).get("usd", 0) or 0),
                "volume_24h": float(p.get("volume", {}).get("h24", 0) or 0),
                "price_change_24h": float(p.get("priceChange", {}).get("h24", 0) or 0),
                "age_hours": 0,
                "url": p.get("url", ""),
                "pair_address": p.get("pairAddress", ""),
            })
        return tokens
    except Exception as exc:
        logger.warning("dex_search_fetch_failed", error=str(exc))
        return []


async def discover_hidden_gems(
    *,
    min_liquidity: float = 50_000,
    min_volume: float = 100_000,
    max_age_hours: float = 168,  # 1 week
    limit: int = 10,
) -> Dict[str, Any]:
    """
    Discover hidden gem tokens from DEX data.
    Scores and ranks tokens by gem_score.
    """
    # Fetch trending tokens
    tokens = await _fetch_dex_trending()
    if not tokens:
        tokens = await _fetch_dex_search()

    if not tokens:
        return {
            "gems": [],
            "summary": "No tokens found from DEX sources",
            "fetched_at": _now_iso(),
        }

    # Filter by minimum criteria
    filtered = [
        t for t in tokens
        if t.get("liquidity", 0) >= min_liquidity
        and t.get("volume_24h", 0) >= min_volume
    ]

    # Also include tokens below thresholds if they're very new (age check skipped since we don't have it)
    if not filtered:
        filtered = tokens  # Don't return empty if we have tokens

    # Enrich with social sentiment + tokenomics data
    import asyncio as _asyncio
    from routers.social_sentiment import fetch_social_metrics
    from routers.tokenomics import fetch_tokenomics

    async def _enrich_token(t: dict) -> dict:
        sym = t.get("symbol", "")
        if not sym:
            return t
        try:
            social = await _asyncio.wait_for(fetch_social_metrics(sym), timeout=5.0)
            t["social_buzz"] = min(1.0, social.get("social_dominance", 0) / 10.0)
        except Exception:
            t["social_buzz"] = 0.0
        try:
            tokenomics = await _asyncio.wait_for(fetch_tokenomics(sym), timeout=5.0)
            unlock_pct = tokenomics.get("next_unlock_pct", 0)
            t["tokenomics_safety"] = max(0, 100 - unlock_pct * 5)
        except Exception:
            t["tokenomics_safety"] = 50.0
        return t

    filtered = await _asyncio.gather(*[_enrich_token(t) for t in filtered[:50]], return_exceptions=False)

    # Score each token
    candidates: List[GemCandidate] = []
    for t in filtered:
        score, reasons, warnings = _compute_gem_score(
            liquidity=t.get("liquidity", 0),
            volume_24h=t.get("volume_24h", 0),
            price_change_24h=t.get("price_change_24h", 0),
            age_hours=t.get("age_hours", 168),  # Default to 1 week if unknown
            social_buzz=t.get("social_buzz", 0),
            tokenomics_safety=t.get("tokenomics_safety", 50),
        )

        candidates.append(GemCandidate(
            symbol=t.get("symbol", ""),
            name=t.get("name", ""),
            chain=t.get("chain", ""),
            price=t.get("price", 0),
            liquidity=t.get("liquidity", 0),
            volume_24h=t.get("volume_24h", 0),
            price_change_24h=t.get("price_change_24h", 0),
            age_hours=t.get("age_hours", 0),
            gem_score=score,
            reasons=reasons,
            warnings=warnings,
            social_buzz=t.get("social_buzz", 0),
            tokenomics_safety=t.get("tokenomics_safety", 50),
        ))

    # Sort by gem_score descending
    candidates.sort(key=lambda c: c.gem_score, reverse=True)

    top_gems = candidates[:limit]

    return {
        "gems": [
            {
                "symbol": c.symbol,
                "name": c.name,
                "chain": c.chain,
                "price": c.price,
                "liquidity": c.liquidity,
                "volume_24h": c.volume_24h,
                "price_change_24h": c.price_change_24h,
                "gem_score": c.gem_score,
                "social_buzz": c.social_buzz,
                "tokenomics_safety": c.tokenomics_safety,
                "reasons": c.reasons,
                "warnings": c.warnings,
                "url": next((t.get("url", "") for t in filtered if t.get("symbol") == c.symbol), ""),
            }
            for c in top_gems
        ],
        "summary": f"{len(top_gems)} hidden gems discovered (scanned {len(tokens)} tokens)",
        "scanned_count": len(tokens),
        "fetched_at": _now_iso(),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
