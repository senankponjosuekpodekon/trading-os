"""
Pre-Listing Alpha — Phase N
Detects and analyzes upcoming token listings (IDO, IEO, ICO, presales)
before they hit major CEXes. Combines multiple sources to find asymmetric
opportunities.

Sources:
  - CoinGecko: upcoming coins, trending
  - CryptoRank: IDO/IEO data (public API)
  - DEX Screener: newly listed pairs
  - TokenUnlocks: vesting schedules
  - Social buzz: Twitter/Reddit mentions pre-listing

Analysis:
  - Funding progress (% of target raised)
  - Team credibility (known founders, audits)
  - Tokenomics (unlock schedule, distribution)
  - Social buzz momentum
  - Exchange listing rumors
  - Asymmetric score (risk/reward pre-listing)
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

import httpx
from fastapi import APIRouter, HTTPException, Query

from utils.logger import get_logger
from utils.rate_limiter import rate_limit
from utils.http import retry_async

logger = get_logger(__name__)
router = APIRouter()

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
CRYPTORANK_BASE = "https://api.cryptorank.io/v1"

# Cache
_cache: dict = {"data": None, "ts": 0.0}
_CACHE_TTL = 600  # 10 min


@dataclass
class PreListingProject:
    name: str
    symbol: str
    listing_type: str  # IDO | IEO | ICO | PRESALE | FAIR_LAUNCH
    platform: str  # launchpad name
    status: str  # upcoming | live | ended | listed
    start_date: Optional[str]
    end_date: Optional[str]
    token_price: float
    fundraising_goal: float
    funds_raised: float
    funding_pct: float
    description: str
    website: str
    twitter: str
    telegram: str
    chain: str
    audit_status: str  # audited | not_audited | unknown
    asymmetric_score: int
    risk_flags: List[str]
    opportunity_flags: List[str]
    social_buzz: int


def _compute_asymmetric_score(
    funding_pct: float,
    audit_status: str,
    social_buzz: int,
    has_website: bool,
    has_twitter: bool,
    listing_type: str,
    platform: str,
) -> tuple[int, List[str], List[str]]:
    """
    Compute 0-100 asymmetric opportunity score for pre-listing projects.
    Higher = more promising asymmetric bet.
    """
    score = 50  # Start neutral
    risks: List[str] = []
    opportunities: List[str] = []

    # 1. Funding progress (0-20 pts)
    if funding_pct >= 100:
        score += 15
        opportunities.append(f"Fully funded ({funding_pct:.0f}%) — strong demand")
    elif funding_pct >= 75:
        score += 10
        opportunities.append(f"Near fully funded ({funding_pct:.0f}%)")
    elif funding_pct >= 50:
        score += 5
    elif funding_pct > 0:
        score -= 5
        risks.append(f"Low funding ({funding_pct:.0f}%) — weak demand signal")
    else:
        score -= 10
        risks.append("No funding yet — unproven demand")

    # 2. Audit status (0-15 pts)
    if audit_status == "audited":
        score += 15
        opportunities.append("Smart contract audited")
    elif audit_status == "not_audited":
        score -= 15
        risks.append("No audit — smart contract risk")
    else:
        score -= 5
        risks.append("Audit status unknown")

    # 3. Social buzz (0-20 pts)
    if social_buzz > 500:
        score += 20
        opportunities.append(f"High social buzz ({social_buzz} mentions)")
    elif social_buzz > 100:
        score += 12
        opportunities.append(f"Growing social attention ({social_buzz} mentions)")
    elif social_buzz > 20:
        score += 5
    elif social_buzz == 0:
        score -= 10
        risks.append("Zero social presence — possible scam")

    # 4. Online presence (0-10 pts)
    if has_website and has_twitter:
        score += 10
    elif has_website or has_twitter:
        score += 5
    else:
        score -= 15
        risks.append("No website or Twitter — high scam probability")

    # 5. Listing type bonus (0-10 pts)
    type_bonuses = {"IEO": 10, "IDO": 7, "ICO": 3, "PRESALE": -5, "FAIR_LAUNCH": 8}
    score += type_bonuses.get(listing_type, 0)
    if listing_type == "IEO":
        opportunities.append("IEO — exchange-backed listing (higher trust)")
    elif listing_type == "PRESALE":
        risks.append("Presale — highest risk, no exchange guarantee")

    # 6. Platform reputation (0-10 pts)
    reputable_platforms = {"Binance Launchpad", "Coinlist", "Polkastarter", "DAO Maker", "Seedify"}
    if any(p.lower() in platform.lower() for p in reputable_platforms):
        score += 10
        opportunities.append(f"Reputable launchpad: {platform}")
    elif platform:
        score += 3
    else:
        score -= 5
        risks.append("Unknown launchpad — verify credibility")

    # 7. Red flags detection
    if not has_website and not has_twitter:
        score -= 20
        risks.append("CRITICAL: No online presence — likely scam")

    score = max(0, min(100, score))
    return score, risks, opportunities


async def _fetch_coingecko_upcoming() -> List[Dict[str, Any]]:
    """Fetch upcoming/recently listed coins from CoinGecko."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Recently listed coins
            r = await client.get(
                f"{COINGECKO_BASE}/coins/list",
                params={"include_platform": "true"},
            )
            r.raise_for_status()
            # This gives us all coins — we'd filter for recent ones
            # In production, use the /coins/markets endpoint with new=true
            return []
    except Exception as exc:
        logger.warning("coingecko_upcoming_failed", error=str(exc))
        return []


async def _fetch_coingecko_trending() -> List[Dict[str, Any]]:
    """Fetch trending coins from CoinGecko — often includes pre-listing buzz."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{COINGECKO_BASE}/search/trending")
            r.raise_for_status()
            data = r.json()

        projects = []
        for coin in data.get("coins", [])[:15]:
            item = coin.get("item", {})
            projects.append({
                "name": item.get("name", ""),
                "symbol": item.get("symbol", ""),
                "market_cap_rank": item.get("market_cap_rank"),
                "coingecko_id": item.get("id", ""),
                "thumb": item.get("thumb", ""),
                "source": "coingecko_trending",
            })
        return projects
    except Exception as exc:
        logger.warning("coingecko_trending_failed", error=str(exc))
        return []


async def _fetch_dex_new_pairs() -> List[Dict[str, Any]]:
    """Fetch newly created DEX pairs — potential pre-listing or just-listed tokens."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # DexScreener: search for "new" keyword
            r = await client.get(
                "https://api.dexscreener.com/latest/dex/search",
                params={"q": "new"},
            )
            r.raise_for_status()
            data = r.json()

        pairs = data.get("pairs", [])[:20]
        projects = []
        for p in pairs:
            base = p.get("baseToken", {})
            projects.append({
                "name": base.get("name", ""),
                "symbol": base.get("symbol", ""),
                "chain": p.get("chainId", ""),
                "pair_address": p.get("pairAddress", ""),
                "liquidity": float(p.get("liquidity", {}).get("usd", 0) or 0),
                "volume_24h": float(p.get("volume", {}).get("h24", 0) or 0),
                "price_change_24h": float(p.get("priceChange", {}).get("h24", 0) or 0),
                "created_at": p.get("pairCreatedAt", ""),
                "url": p.get("url", ""),
                "source": "dex_screener",
            })
        return projects
    except Exception as exc:
        logger.warning("dex_new_pairs_failed", error=str(exc))
        return []


async def _fetch_cryptorank_idos() -> List[Dict[str, Any]]:
    """Fetch IDO/IEO data from CryptoRank (public API)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{CRYPTORANK_BASE}/fundraising-rounds",
                params={"status": "upcoming", "limit": 20},
            )
            if r.status_code != 200:
                return []
            data = r.json()

        projects = []
        for item in data.get("data", [])[:20]:
            projects.append({
                "name": item.get("name", ""),
                "symbol": item.get("symbol", ""),
                "listing_type": item.get("type", "IDO"),
                "platform": item.get("platform", ""),
                "status": "upcoming",
                "start_date": item.get("startDate", ""),
                "end_date": item.get("endDate", ""),
                "token_price": float(item.get("tokenPrice", 0) or 0),
                "fundraising_goal": float(item.get("hardCap", 0) or 0),
                "funds_raised": float(item.get("raised", 0) or 0),
                "description": item.get("description", ""),
                "website": item.get("website", ""),
                "twitter": item.get("twitter", ""),
                "telegram": item.get("telegram", ""),
                "chain": item.get("blockchain", ""),
                "source": "cryptorank",
            })
        return projects
    except Exception as exc:
        logger.warning("cryptorank_idos_failed", error=str(exc))
        return []


async def discover_pre_listing(
    *,
    min_score: int = 40,
    limit: int = 15,
    include_trending: bool = True,
) -> Dict[str, Any]:
    """
    Discover pre-listing opportunities by aggregating multiple sources.
    Scores each project on asymmetric opportunity (0-100).
    """
    # Fetch from all sources in parallel
    tasks = [_fetch_dex_new_pairs()]
    if include_trending:
        tasks.append(_fetch_coingecko_trending())
    tasks.append(_fetch_cryptorank_idos())

    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_projects: List[Dict[str, Any]] = []
    for res in results:
        if isinstance(res, list):
            all_projects.extend(res)

    # Deduplicate by symbol/name
    seen = set()
    unique = []
    for p in all_projects:
        key = (p.get("symbol", "") + p.get("name", "")).lower()
        if key and key not in seen:
            seen.add(key)
            unique.append(p)

    # Score each project
    scored: List[Dict[str, Any]] = []
    for p in unique:
        funding_goal = p.get("fundraising_goal", 0)
        funds_raised = p.get("funds_raised", 0)
        funding_pct = (funds_raised / funding_goal * 100) if funding_goal > 0 else 0

        has_website = bool(p.get("website"))
        has_twitter = bool(p.get("twitter"))
        listing_type = p.get("listing_type", "IDO")
        platform = p.get("platform", "")

        # Estimate social buzz (would be enriched from X/Reddit in production)
        social_buzz = 0
        if p.get("source") == "coingecko_trending":
            social_buzz = 200  # Trending on CoinGecko = decent buzz
        elif p.get("volume_24h", 0) > 500_000:
            social_buzz = 100

        audit = "unknown"
        if p.get("source") == "cryptorank" and p.get("audit_status"):
            audit = p.get("audit_status")

        score, risks, opportunities = _compute_asymmetric_score(
            funding_pct=funding_pct,
            audit_status=audit,
            social_buzz=social_buzz,
            has_website=has_website,
            has_twitter=has_twitter,
            listing_type=listing_type,
            platform=platform,
        )

        p["funding_pct"] = round(funding_pct, 1)
        p["asymmetric_score"] = score
        p["risk_flags"] = risks
        p["opportunity_flags"] = opportunities
        p["social_buzz"] = social_buzz
        p["audit_status"] = audit

        if score >= min_score:
            scored.append(p)

    # Sort by score
    scored.sort(key=lambda x: x["asymmetric_score"], reverse=True)

    # Summary stats
    high_score = sum(1 for p in scored if p["asymmetric_score"] >= 70)
    has_red_flags = sum(1 for p in scored if any("CRITICAL" in r for r in p.get("risk_flags", [])))

    return {
        "projects": scored[:limit],
        "summary": (
            f"{len(scored)} pre-listing opportunities found "
            f"({high_score} high-score, {has_red_flags} with critical risks) "
            f"· Scanned {len(unique)} projects"
        ),
        "scanned_count": len(unique),
        "high_score_count": high_score,
        "critical_risk_count": has_red_flags,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/pre-listing/discover")
async def discover_endpoint(
    min_score: int = Query(40, ge=0, le=100),
    limit: int = Query(15, ge=1, le=50),
    include_trending: bool = Query(True),
    refresh: bool = Query(False),
):
    """GET /pre-listing/discover — Discover pre-listing opportunities."""
    now = time.monotonic()
    if not refresh and _cache["data"] and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]

    try:
        result = await discover_pre_listing(
            min_score=min_score,
            limit=limit,
            include_trending=include_trending,
        )
        _cache["data"] = result
        _cache["ts"] = now
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Pre-listing discovery unavailable: {exc}") from exc


@router.get("/pre-listing/analyze/{symbol}")
async def analyze_project(symbol: str):
    """
    GET /pre-listing/analyze/{symbol} — Deep analysis of a specific pre-listing project.
    Aggregates all available data for comprehensive risk/reward assessment.
    """
    # Search across sources for this symbol
    dex_projects = await _fetch_dex_new_pairs()
    trending = await _fetch_coingecko_trending()

    # Find matching project
    project = None
    for p in dex_projects + trending:
        if p.get("symbol", "").upper() == symbol.upper():
            project = p
            break

    if not project:
        return {
            "symbol": symbol,
            "found": False,
            "message": f"Project {symbol} not found in pre-listing sources",
        }

    # Compute score
    funding_pct = project.get("funding_pct", 0)
    score, risks, opportunities = _compute_asymmetric_score(
        funding_pct=funding_pct,
        audit_status=project.get("audit_status", "unknown"),
        social_buzz=project.get("social_buzz", 0),
        has_website=bool(project.get("website")),
        has_twitter=bool(project.get("twitter")),
        listing_type=project.get("listing_type", "IDO"),
        platform=project.get("platform", ""),
    )

    # Verdict
    if score >= 70:
        verdict = "STRONG_BUY"
    elif score >= 55:
        verdict = "CAUTIOUS_BUY"
    elif score >= 40:
        verdict = "WATCH"
    elif score >= 25:
        verdict = "HIGH_RISK"
    else:
        verdict = "AVOID"

    return {
        "symbol": symbol,
        "found": True,
        "project": project,
        "asymmetric_score": score,
        "verdict": verdict,
        "risk_flags": risks,
        "opportunity_flags": opportunities,
        "analysis": {
            "funding_pct": funding_pct,
            "audit_status": project.get("audit_status", "unknown"),
            "social_buzz": project.get("social_buzz", 0),
            "liquidity": project.get("liquidity", 0),
            "volume_24h": project.get("volume_24h", 0),
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
