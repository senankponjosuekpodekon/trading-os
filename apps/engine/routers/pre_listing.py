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
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query

from utils.logger import get_logger

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
    github_commits_30d: int = 0,
    tvl_millions: float = 0,
    tvl_growing: bool = False,
    healthy_unlocks: bool | None = None,
    top_holder_pct: float | None = None,
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

    # 7. GitHub developer activity (0-15 pts)
    if github_commits_30d >= 30:
        score += 15
        opportunities.append(f"Active dev team ({github_commits_30d} commits/30j)")
    elif github_commits_30d >= 10:
        score += 8
        opportunities.append(f"Steady development ({github_commits_30d} commits/30j)")
    elif github_commits_30d > 0:
        score += 3
    elif has_website or has_twitter:
        # only penalize if project claims to exist but no commits
        score -= 5
        risks.append("No recent GitHub activity")

    # 8. TVL growth (0-15 pts)
    if tvl_millions >= 10:
        score += 15
        opportunities.append(f"Strong TVL ${tvl_millions:.1f}M")
    elif tvl_millions >= 1:
        score += 10
        opportunities.append(f"Growing TVL ${tvl_millions:.1f}M")
    elif tvl_millions > 0:
        score += 5
    if tvl_millions > 0 and not tvl_growing:
        score -= 3
        risks.append("TVL not growing")

    # 9. Token unlock / vesting health (0-10 pts)
    if healthy_unlocks is True:
        score += 10
        opportunities.append("Healthy vesting schedule (> 12 mois team)")
    elif healthy_unlocks is False:
        score -= 10
        risks.append("Team vesting < 12 mois or heavy upcoming unlock")

    # 10. Holder concentration (0-10 pts)
    if top_holder_pct is not None:
        if top_holder_pct < 30:
            score += 10
            opportunities.append("Low top-holder concentration")
        elif top_holder_pct < 50:
            score += 5
        elif top_holder_pct > 70:
            score -= 10
            risks.append("High concentration — whale dump risk")

    # 11. Red flags detection
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


def _extract_github_repo(website: str, name: str) -> str | None:
    """Try to extract github.com/owner/repo from a project website."""
    if not website:
        return None
    m = re.search(r"github\.com/([^\s\"<>/]+/[^\s\"<>/]+)", website)
    if m:
        return m.group(1).rstrip("/")
    # try common docs link
    if "github.com" in website:
        parsed = urlparse(website)
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"
    return None


async def _fetch_github_activity(repo: str) -> dict | None:
    """Fetch GitHub activity for a repo."""
    if not repo:
        return None
    headers = {}
    token = os.getenv("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # repo info
            r = await client.get(f"https://api.github.com/repos/{repo}", headers=headers)
            if r.status_code != 200:
                return None
            info = r.json()
            # commits last 30 days
            since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            c = await client.get(
                f"https://api.github.com/repos/{repo}/commits",
                headers=headers,
                params={"since": since, "per_page": 100},
            )
            commits = c.json() if c.status_code == 200 else []
            return {
                "stars": int(info.get("stargazers_count", 0)),
                "commits_30d": min(len(commits), 100),
                "updated_at": info.get("updated_at"),
                "repo": repo,
            }
    except Exception as exc:
        logger.debug("github_activity_failed", repo=repo, error=str(exc))
        return None


_DFLLAMA_PROTOCOLS: list[dict] | None = None
_DFLLAMA_TS: float = 0.0
_DFLLAMA_TTL = 1800  # 30 min


async def _fetch_defillama_protocols() -> list[dict]:
    """Fetch DeFiLlama protocols list (cached 30 min)."""
    global _DFLLAMA_PROTOCOLS, _DFLLAMA_TS
    now = time.monotonic()
    if _DFLLAMA_PROTOCOLS and (now - _DFLLAMA_TS) < _DFLLAMA_TTL:
        return _DFLLAMA_PROTOCOLS
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get("https://api.llama.fi/protocols")
            r.raise_for_status()
            _DFLLAMA_PROTOCOLS = r.json()
            _DFLLAMA_TS = now
            return _DFLLAMA_PROTOCOLS
    except Exception as exc:
        logger.warning("defillama_protocols_failed", error=str(exc))
        return []


async def _match_defillama_protocol(name: str, symbol: str) -> dict | None:
    """Match a project by name or symbol in DeFiLlama protocols."""
    protocols = await _fetch_defillama_protocols()
    if not protocols:
        return None
    name_lower = name.lower()
    symbol_lower = symbol.lower()
    for p in protocols:
        p_name = (p.get("name") or "").lower()
        p_symbol = (p.get("symbol") or "").lower()
        p_slug = (p.get("slug") or "").lower()
        if (
            p_name == name_lower
            or p_slug == name_lower.replace(" ", "-")
            or p_symbol == symbol_lower
        ):
            return p
    return None


async def _fetch_defillama_tvl(name: str, symbol: str) -> dict | None:
    """Fetch TVL for a protocol via DeFiLlama."""
    proto = await _match_defillama_protocol(name, symbol)
    if not proto:
        return None
    try:
        slug = proto.get("slug")
        if not slug:
            return None
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"https://api.llama.fi/protocol/{slug}")
            r.raise_for_status()
            data = r.json()
            tvl = data.get("tvl")
            current_tvl = float(tvl[-1].get("totalLiquidityUSD", 0)) if tvl and isinstance(tvl, list) else 0
            # Compare current TVL to average of previous 7 days
            points = [float(pt.get("totalLiquidityUSD", 0) or 0) for pt in tvl[-8:] if pt.get("totalLiquidityUSD")]
            if len(points) >= 2:
                current = points[-1]
                avg_prev = sum(points[:-1]) / (len(points) - 1)
            else:
                current = current_tvl
                avg_prev = current_tvl
            return {
                "tvl_usd": round(current, 2),
                "tvl_millions": round(current / 1_000_000, 2),
                "tvl_growing": current > avg_prev,
                "chain": (proto.get("chain") or data.get("chain") or ""),
                "github": proto.get("github") or data.get("github"),
            }
    except Exception as exc:
        logger.debug("defillama_tvl_failed", name=name, error=str(exc))
        return None


async def _fetch_coingecko_supply(symbol: str) -> dict | None:
    """
    Free CoinGecko tokenomics fallback for TokenUnlocks.
    Uses /coins/markets to get circulating/total/max supply.
    Returns vesting health estimate: healthy if > 50% already in circulation.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{COINGECKO_BASE}/coins/markets",
                params={
                    "vs_currency": "usd",
                    "symbols": symbol.lower(),
                    "per_page": 1,
                    "page": 1,
                    "sparkline": "false",
                },
            )
            if r.status_code != 200:
                return None
            data = r.json()
            if not isinstance(data, list) or not data:
                return None
            item = data[0]
            circ = item.get("circulating_supply") or 0
            total = item.get("total_supply") or item.get("max_supply") or 0
            max_sup = item.get("max_supply") or total
            if not (circ and max_sup):
                return None
            unlocked_pct = circ / max_sup
            # Healthy if most supply already in circulation -> less dilution overhang
            return {
                "next_unlock_pct": 0.0,
                "team_vesting_months": 0.0,
                "healthy": unlocked_pct >= 0.5,
                "circulating_supply": circ,
                "total_supply": total,
                "max_supply": max_sup,
                "source": "coingecko",
            }
    except Exception as exc:
        logger.debug("coingecko_supply_failed", symbol=symbol, error=str(exc))
        return None


async def _fetch_token_unlocks(symbol: str) -> dict | None:
    """TokenUnlocks — fetch vesting info. Falls back to free CoinGecko supply."""
    token = os.getenv("TOKENUNLOCKS_API_KEY")
    if token:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.tokenunlocks.com/api/v1/unlock",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"symbol": symbol.upper()},
                )
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "next_unlock_pct": float(data.get("next_unlock_pct", 0) or 0),
                        "team_vesting_months": float(data.get("team_vesting_months", 0) or 0),
                        "healthy": data.get("team_vesting_months", 0) >= 12,
                        "source": "tokenunlocks",
                    }
        except Exception as exc:
            logger.debug("token_unlocks_failed", symbol=symbol, error=str(exc))

    # Free fallback via CoinGecko tokenomics
    return await _fetch_coingecko_supply(symbol)


async def _fetch_reddit_mentions(query: str) -> dict | None:
    """Free social mentions from Reddit search JSON."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = {"User-Agent": "trading-os/1.0 (mention tracker)"}
            r = await client.get(
                "https://www.reddit.com/search.json",
                headers=headers,
                params={
                    "q": query,
                    "limit": 25,
                    "sort": "new",
                    "t": "week",
                },
            )
            if r.status_code != 200:
                return None
            data = r.json()
            posts = data.get("data", {}).get("children", [])
            titles = [p.get("data", {}).get("title") for p in posts if p.get("data")]
            return {
                "mentions": len(posts),
                "latest_title": titles[0] if titles else None,
                "source": "reddit",
            }
    except Exception as exc:
        logger.debug("reddit_mentions_failed", query=query, error=str(exc))
        return None


async def _fetch_cryptopanic_mentions(query: str) -> dict | None:
    """CryptoPanic mentions count, falls back to Reddit if no key."""
    token = os.getenv("CRYPTOPANIC_API_KEY")
    if token:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://cryptopanic.com/api/v1/posts/",
                    params={"auth_token": token, "currencies": query.upper(), "kind": "news"},
                )
                if r.status_code == 200:
                    data = r.json()
                    return {
                        "mentions": len(data.get("results", [])),
                        "latest_title": (data.get("results") or [{}])[0].get("title"),
                        "source": "cryptopanic",
                    }
        except Exception as exc:
            logger.debug("cryptopanic_failed", query=query, error=str(exc))
    # Free fallback
    return await _fetch_reddit_mentions(query)


PARSE_ICODROPS_ID = "76b07962-2f33-4a7c-95ed-74dfc5509dba"


async def _fetch_parse_icodrops(
    status: str = "upcoming",
    page: int = 1,
    limit: int = 10,
) -> list[dict]:
    """
    Parse-managed ICO Drops API.
    Requires PARSE_API_KEY. Free tier: 200 credits, 5 req/min.
    Endpoints: get_upcoming_icos, get_active_icos, get_ended_icos
    """
    token = os.getenv("PARSE_API_KEY")
    if not token:
        return []
    if status not in {"upcoming", "active", "ended"}:
        status = "upcoming"
    endpoint = f"get_{status}_icos"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                f"https://api.parse.bot/scraper/{PARSE_ICODROPS_ID}/{endpoint}",
                headers={"X-API-Key": token, "User-Agent": "trading-os/1.0"},
                params={"page": page, "limit": limit},
            )
            if r.status_code != 200:
                logger.warning("parse_icodrops_failed", status=status, code=r.status_code)
                return []
            data = r.json()
            items = data.get("projects") if isinstance(data, dict) else data
            if not isinstance(items, list):
                return []

            projects = []
            for item in items:
                ecosystems = item.get("ecosystems") or []
                categories = item.get("categories") or []
                projects.append({
                    "name": item.get("name", ""),
                    "symbol": (item.get("ticker") or "").upper(),
                    "listing_type": (item.get("round") or "ICO").upper().replace(" ", "_"),
                    "platform": "ICO Drops (Parse)",
                    "status": status,
                    "start_date": item.get("date", ""),
                    "fundraising_goal": float(item.get("pre_valuation") or 0),
                    "funds_raised": float(item.get("raised") or 0),
                    "website": item.get("url", ""),
                    "twitter": "",
                    "chain": ecosystems[0] if isinstance(ecosystems, list) and ecosystems else "",
                    "ecosystems": ecosystems,
                    "categories": categories,
                    "investors": item.get("investors") or [],
                    "slug": item.get("slug", ""),
                    "source": "parse_icodrops",
                })
            return projects
    except Exception as exc:
        logger.warning("parse_icodrops_error", status=status, error=str(exc))
        return []


async def _fetch_icodrops() -> list[dict]:
    """
    ICO Drops source — currently unavailable via free/automated channels.

    - The WordPress REST endpoint (/wp-json/wp/v2/posts) returns 404.
    - The public HTML pages are JavaScript-rendered, so plain httpx scraping
      does not expose the ICO list reliably.
    - A paid API or headless-browser scraper would be needed to make this
      source production-grade.

    Returns an empty list while logging the limitation.
    """
    logger.debug("icodrops_unavailable", reason="wp-json 404, js-rendered html")
    return []


async def _enrich_project(p: Dict[str, Any]) -> None:
    """Enrich a single project with GitHub, TVL, unlocks, social."""
    name = p.get("name", "")
    symbol = p.get("symbol", "")
    if not name or not symbol:
        return

    # DeFiLlama TVL + chain + github
    df = await _fetch_defillama_tvl(name, symbol)
    if df:
        p["tvl_usd"] = df.get("tvl_usd", 0)
        p["tvl_millions"] = df.get("tvl_millions", 0)
        p["tvl_growing"] = df.get("tvl_growing", False)
        if df.get("github"):
            p["github"] = df.get("github")
        if df.get("chain"):
            p["chain"] = df.get("chain")

    # GitHub activity
    repo = _extract_github_repo(p.get("github") or p.get("website") or "", name)
    if not repo and (p.get("github") or "").startswith("github.com/"):
        # direct github link
        repo = p.get("github", "").replace("https://", "").replace("http://", "").lstrip("/")
        repo = re.sub(r"^github\.com/", "", repo).split("?")[0]
    if repo and "/" in repo and not repo.startswith("http"):
        gh = await _fetch_github_activity(repo)
        if gh:
            p["github_commits_30d"] = gh.get("commits_30d", 0)
            p["github_stars"] = gh.get("stars", 0)

    # TokenUnlocks vesting
    tu = await _fetch_token_unlocks(symbol)
    if tu:
        p["healthy_unlocks"] = tu.get("healthy")
        p["next_unlock_pct"] = tu.get("next_unlock_pct")

    # CryptoPanic mentions
    cp = await _fetch_cryptopanic_mentions(symbol)
    if cp:
        p["cryptopanic_mentions"] = cp.get("mentions", 0)


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
    tasks.append(_fetch_parse_icodrops(status="upcoming", limit=10))
    tasks.append(_fetch_icodrops())

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

    # Enrich with GitHub, TVL, unlocks, CryptoPanic
    if unique:
        await asyncio.gather(*(_enrich_project(p) for p in unique), return_exceptions=True)

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

        # Social buzz = base + CryptoPanic mentions
        social_buzz = p.get("cryptopanic_mentions", 0)
        if p.get("source") == "coingecko_trending":
            social_buzz += 200
        elif p.get("volume_24h", 0) > 500_000:
            social_buzz += 100

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
            github_commits_30d=p.get("github_commits_30d", 0),
            tvl_millions=p.get("tvl_millions", 0),
            tvl_growing=p.get("tvl_growing", False),
            healthy_unlocks=p.get("healthy_unlocks"),
            top_holder_pct=p.get("top_holder_pct"),
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

    # Enrich with GitHub, TVL, unlocks, CryptoPanic
    await _enrich_project(project)

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
        github_commits_30d=project.get("github_commits_30d", 0),
        tvl_millions=project.get("tvl_millions", 0),
        tvl_growing=project.get("tvl_growing", False),
        healthy_unlocks=project.get("healthy_unlocks"),
        top_holder_pct=project.get("top_holder_pct"),
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
