"""
X (Twitter) Sentiment — Phase M
Fetches tweets from key accounts via X API v2 (if configured) with
robust Nitter fallback. Analyzes sentiment via FinBERT.

X API v2 free tier: 100 reads/month (very limited)
X API v2 Basic ($100/mo): 10,000 tweets/mo
Nitter: free but unreliable — used as fallback

Configuration: X_BEARER_TOKEN in .env (engine)
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

from config import settings
from utils.logger import get_logger
from utils.rate_limiter import rate_limit
from ml.finbert_sentiment import analyze_batch, aggregate_sentiment, get_sentiment_bonus

logger = get_logger(__name__)
router = APIRouter()

X_BEARER_TOKEN = getattr(settings, "x_bearer_token", "") or ""
X_API_BASE = "https://api.twitter.com/2"

# Updated Nitter instances (rotated regularly as they go down)
NITTER_INSTANCES = [
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
    "https://nitter.net",
    "https://nitter.cz",
    "https://nitter.woodland.cafe",
]

# Key accounts by category — expanded with more alpha sources
TWITTER_ACCOUNTS: dict[str, list[str]] = {
    "crypto": [
        "CoinDesk", "Cointelegraph", "DocumentingBTC", "APompliano",
        "CryptoCapo_", "CryptoKaleo", "InstitutionalCrypto",
    ],
    "BTC/USDT": ["DocumentingBTC", "saylor", "WClementeIII", "BitcoinMagazine"],
    "ETH/USDT": ["VitalikButerin", "sassal0x", "ethereum"],
    "SOL/USDT": ["aeyakovenko", "rajgokal", "SolanaStatus"],
    "forex": ["ForexLive", "kgreifeld", "FXStreetNews", "DailyFX"],
    "XAU/USD": ["Kitco_News", "goldsilver_com", "GoldTelegraph_"],
    "us_stocks": ["zerohedge", "unusual_whales", "WallStreetSilv", "The_Real_Fly"],
}

# Cache: per-category, 15min TTL
_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 900  # 15 min

# Rate limiting for X API
_x_api_calls = {"count": 0, "reset_ts": 0.0}
_X_API_MONTHLY_LIMIT = 99  # Leave 1 as buffer on free tier


def _can_use_x_api() -> bool:
    """Check if we can still use X API (rate limit aware)."""
    if not X_BEARER_TOKEN:
        return False
    now = time.monotonic()
    # Reset counter every 24h (conservative for monthly limit)
    if now - _x_api_calls["reset_ts"] > 86400:
        _x_api_calls["count"] = 0
        _x_api_calls["reset_ts"] = now
    return _x_api_calls["count"] < _X_API_MONTHLY_LIMIT


# ── X API v2 ─────────────────────────────────────────────────────────────────

async def _fetch_x_api_tweets(usernames: list[str], max_results: int = 10) -> List[Dict[str, Any]]:
    """Fetch recent tweets via X API v2."""
    if not _can_use_x_api():
        return []

    tweets = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Step 1: Get user IDs from usernames
            headers = {"Authorization": f"Bearer {X_BEARER_TOKEN}"}
            username_query = ",".join(usernames[:10])  # API allows up to 100 comma-separated
            resp = await client.get(
                f"{X_API_BASE}/users/by",
                params={"usernames": username_query},
                headers=headers,
            )
            if resp.status_code != 200:
                logger.warning("x_api_users_failed", status=resp.status_code)
                return []

            users_data = resp.json().get("data", [])
            user_ids = [u["id"] for u in users_data]
            _x_api_calls["count"] += 1

            if not user_ids:
                return []

            # Step 2: Fetch tweets for these users
            # Use /2/tweets/search/recent with from: operator
            query = " OR ".join(f"from:{uid}" for uid in user_ids[:5])
            resp = await client.get(
                f"{X_API_BASE}/tweets/search/recent",
                params={
                    "query": query,
                    "max_results": min(max_results * len(user_ids[:5]), 100),
                    "tweet.fields": "created_at,public_metrics,author_id,lang",
                    "expansions": "author_id",
                    "user.fields": "username,name,verified",
                },
                headers=headers,
            )
            _x_api_calls["count"] += 1

            if resp.status_code != 200:
                logger.warning("x_api_tweets_failed", status=resp.status_code)
                return []

            data = resp.json()
            users_map = {u["id"]: u for u in data.get("includes", {}).get("users", [])}

            for tweet in data.get("data", []):
                if tweet.get("lang") not in ("en", "fr"):
                    continue
                author = users_map.get(tweet.get("author_id"), {})
                metrics = tweet.get("public_metrics", {})
                tweets.append({
                    "text": tweet.get("text", ""),
                    "author": author.get("username", ""),
                    "author_name": author.get("name", ""),
                    "verified": author.get("verified", False),
                    "created_at": tweet.get("created_at", ""),
                    "likes": metrics.get("like_count", 0),
                    "retweets": metrics.get("retweet_count", 0),
                    "replies": metrics.get("reply_count", 0),
                    "impressions": metrics.get("impression_count", 0),
                    "url": f"https://x.com/{author.get('username', '')}/status/{tweet.get('id', '')}",
                    "source": "x_api",
                })
    except Exception as exc:
        logger.warning("x_api_fetch_failed", error=str(exc))
    return tweets


# ── Nitter fallback ───────────────────────────────────────────────────────────

@rate_limit(max_concurrent=3, min_delay=0.3)
async def _fetch_nitter_account(account: str, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
    """Fetch recent tweets from a Nitter instance for one account."""
    for instance in NITTER_INSTANCES:
        try:
            url = f"{instance}/{account}/rss"
            r = await client.get(url, timeout=6, follow_redirects=True)
            if r.status_code != 200:
                continue

            # Parse RSS
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(r.text, "xml")
            items = soup.find_all("item")

            tweets = []
            for item in items[:10]:
                title_tag = item.find("title")
                desc_tag = item.find("description")
                date_tag = item.find("pubDate")
                link_tag = item.find("link")

                text = title_tag.get_text(strip=True) if title_tag else ""
                if not text:
                    continue
                # Clean HTML from description
                desc = ""
                if desc_tag:
                    desc = BeautifulSoup(desc_tag.get_text(), "html.parser").get_text(strip=True)[:300]

                tweets.append({
                    "text": f"{text} {desc}".strip(),
                    "author": account,
                    "author_name": account,
                    "verified": False,
                    "created_at": date_tag.get_text(strip=True) if date_tag else "",
                    "likes": 0,
                    "retweets": 0,
                    "replies": 0,
                    "impressions": 0,
                    "url": link_tag.get_text(strip=True) if link_tag else "",
                    "source": "nitter",
                })
            return tweets
        except Exception:
            continue

    logger.warning("nitter_all_failed", account=account)
    return []


async def _fetch_nitter_tweets(accounts: list[str]) -> List[Dict[str, Any]]:
    """Fetch tweets from multiple accounts via Nitter."""
    all_tweets: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(
        timeout=10,
        headers={"User-Agent": "TradingOS/1.0 (sentiment research)"},
    ) as client:
        results = await asyncio.gather(
            *[_fetch_nitter_account(acc, client) for acc in accounts[:5]],
            return_exceptions=True,
        )
        for res in results:
            if isinstance(res, list):
                all_tweets.extend(res)
    return all_tweets


# ── Main fetch + sentiment ────────────────────────────────────────────────────

async def fetch_x_sentiment(category: str = "crypto", symbol: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch tweets from key accounts and analyze sentiment.
    Tries X API v2 first, falls back to Nitter.
    """
    # Determine which accounts to fetch
    if symbol and symbol in TWITTER_ACCOUNTS:
        accounts = TWITTER_ACCOUNTS[symbol]
    else:
        accounts = TWITTER_ACCOUNTS.get(category, TWITTER_ACCOUNTS["crypto"])

    # Try X API first
    tweets = []
    source = "nitter"

    if _can_use_x_api():
        tweets = await _fetch_x_api_tweets(accounts, max_results=10)
        if tweets:
            source = "x_api"

    # Fallback to Nitter
    if not tweets:
        tweets = await _fetch_nitter_tweets(accounts)
        source = "nitter" if tweets else "none"

    if not tweets:
        return {
            "category": category,
            "symbol": symbol,
            "overall_sentiment": {
                "overall_label": "neutral",
                "overall_score": 0.0,
                "confidence": 0.0,
                "count": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
            },
            "sentiment_bonus": 0.0,
            "tweet_count": 0,
            "tweets": [],
            "source": "none",
            "error": "All Twitter/X sources unavailable",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    # Deduplicate by text
    seen = set()
    unique = []
    for t in tweets:
        key = t["text"][:100].lower()
        if key not in seen:
            seen.add(key)
            unique.append(t)

    # Analyze sentiment
    texts = [t["text"] for t in unique]
    sentiments = analyze_batch(texts) if texts else []

    for i, t in enumerate(unique):
        if i < len(sentiments):
            t["sentiment"] = {
                "label": sentiments[i].label,
                "score": sentiments[i].score,
                "confidence": sentiments[i].confidence,
            }
        else:
            t["sentiment"] = {"label": "neutral", "score": 0.0, "confidence": 0.0}

    # Aggregate
    agg = aggregate_sentiment(texts) if texts else {
        "overall_label": "neutral", "overall_score": 0.0, "confidence": 0.0,
        "count": 0, "positive_count": 0, "negative_count": 0, "neutral_count": 0,
    }

    # Sort by engagement
    unique.sort(
        key=lambda t: t.get("likes", 0) + t.get("retweets", 0) * 2 + t.get("replies", 0),
        reverse=True,
    )

    bonus = get_sentiment_bonus(agg["overall_label"], agg["overall_score"])

    # Engagement metrics
    total_likes = sum(t.get("likes", 0) for t in unique)
    total_rts = sum(t.get("retweets", 0) for t in unique)
    verified_count = sum(1 for t in unique if t.get("verified"))

    return {
        "category": category,
        "symbol": symbol,
        "overall_sentiment": agg,
        "sentiment_bonus": round(bonus, 2),
        "tweet_count": len(unique),
        "engagement": {
            "total_likes": total_likes,
            "total_retweets": total_rts,
            "verified_accounts": verified_count,
        },
        "accounts_fetched": accounts,
        "tweets": unique[:20],
        "source": source,
        "x_api_calls_remaining": _X_API_MONTHLY_LIMIT - _x_api_calls["count"] if source == "x_api" else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/x/sentiment")
async def x_sentiment_endpoint(
    category: str = Query("crypto", description="Category: crypto, forex, gold, us_stocks"),
    symbol: Optional[str] = Query(None, description="Specific symbol (e.g. BTC/USDT)"),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """GET /social/x/sentiment — X/Twitter sentiment by category or symbol."""
    cache_key = f"x:{category}:{symbol or 'all'}"
    now = time.monotonic()

    if not refresh and cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < _CACHE_TTL:
            return data

    try:
        result = await fetch_x_sentiment(category, symbol=symbol)
        _cache[cache_key] = (now, result)
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"X sentiment unavailable: {exc}") from exc


@router.get("/x/status")
async def x_api_status():
    """GET /social/x/status — Check X API configuration and rate limit status."""
    return {
        "x_api_configured": bool(X_BEARER_TOKEN),
        "x_api_available": _can_use_x_api(),
        "calls_used": _x_api_calls["count"],
        "calls_limit": _X_API_MONTHLY_LIMIT,
        "calls_remaining": max(0, _X_API_MONTHLY_LIMIT - _x_api_calls["count"]),
        "nitter_instances": NITTER_INSTANCES,
        "accounts_tracked": {k: len(v) for k, v in TWITTER_ACCOUNTS.items()},
    }
