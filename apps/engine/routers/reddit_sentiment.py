"""
Reddit Sentiment — Phase K
Fetches Reddit posts from finance/crypto subreddits and analyzes sentiment
using FinBERT. Provides aggregated sentiment + per-post results.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

from utils.logger import get_logger
from ml.finbert_sentiment import analyze_batch, aggregate_sentiment, get_sentiment_bonus

logger = get_logger(__name__)
router = APIRouter()

# Subreddits per category
SUBREDDITS: dict[str, list[str]] = {
    "crypto": ["CryptoCurrency", "Bitcoin", "ethtrader", "altcoin"],
    "forex": ["Forex", "FX_trading"],
    "gold": ["Gold", "preciousmetals"],
    "us_stocks": ["stocks", "investing", "wallstreetbets"],
}

# Cache
_cache: dict = {"data": None, "ts": 0.0, "category": None}
_CACHE_TTL = 1800  # 30 min


async def _fetch_subreddit_posts(subreddit: str, limit: int = 25) -> list[dict]:
    """Fetch hot posts from a subreddit via Reddit's public JSON API."""
    url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit={limit}"
    headers = {"User-Agent": "TradingOS/1.0 (sentiment research)"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers=headers, follow_redirects=True)
            r.raise_for_status()
            data = r.json()

        posts = []
        children = data.get("data", {}).get("children", [])
        for child in children:
            d = child.get("data", {})
            title = d.get("title", "")
            if not title:
                continue
            posts.append({
                "title": title,
                "selftext": (d.get("selftext", "") or "")[:500],
                "score": d.get("score", 0),
                "upvote_ratio": d.get("upvote_ratio", 0),
                "num_comments": d.get("num_comments", 0),
                "created_utc": d.get("created_utc", 0),
                "permalink": f"https://reddit.com{d.get('permalink', '')}",
                "subreddit": f"r/{subreddit}",
                "flair": d.get("link_flair_text", ""),
            })
        return posts
    except Exception as exc:
        logger.warning("reddit_fetch_failed", subreddit=subreddit, error=str(exc))
        return []


async def fetch_reddit_sentiment(category: str = "crypto", min_score: int = 10) -> dict:
    """
    Fetch Reddit posts for a category and analyze sentiment.
    Filters low-engagement posts and aggregates sentiment.
    """
    subs = SUBREDDITS.get(category, SUBREDDITS["crypto"])

    # Fetch all subreddits in parallel
    results = await asyncio.gather(
        *[_fetch_subreddit_posts(sub, limit=25) for sub in subs],
        return_exceptions=True,
    )

    all_posts: list[dict] = []
    for res in results:
        if isinstance(res, list):
            all_posts.extend(res)

    # Filter by minimum score
    filtered = [p for p in all_posts if p.get("score", 0) >= min_score]

    # Deduplicate by title
    seen_titles = set()
    unique = []
    for p in filtered:
        t = p["title"].lower()
        if t not in seen_titles:
            seen_titles.add(t)
            unique.append(p)

    # Analyze sentiment on title + selftext
    texts = [f"{p['title']} {p.get('selftext', '')}".strip() for p in unique]
    sentiments = analyze_batch(texts) if texts else []

    for i, p in enumerate(unique):
        if i < len(sentiments):
            p["sentiment"] = {
                "label": sentiments[i].label,
                "score": sentiments[i].score,
                "confidence": sentiments[i].confidence,
            }
        else:
            p["sentiment"] = {"label": "neutral", "score": 0.0, "confidence": 0.0}

    # Aggregate
    agg = aggregate_sentiment(texts) if texts else {
        "overall_label": "neutral", "overall_score": 0.0, "confidence": 0.0,
        "count": 0, "positive_count": 0, "negative_count": 0, "neutral_count": 0, "items": [],
    }

    # Sort by score (engagement)
    unique.sort(key=lambda p: p.get("score", 0), reverse=True)

    bonus = get_sentiment_bonus(agg["overall_label"], agg["overall_score"])

    # Compute engagement metrics
    total_score = sum(p.get("score", 0) for p in unique)
    total_comments = sum(p.get("num_comments", 0) for p in unique)
    avg_upvote_ratio = sum(p.get("upvote_ratio", 0) for p in unique) / len(unique) if unique else 0

    return {
        "category": category,
        "overall_sentiment": agg,
        "sentiment_bonus": round(bonus, 2),
        "post_count": len(unique),
        "engagement": {
            "total_score": total_score,
            "total_comments": total_comments,
            "avg_upvote_ratio": round(avg_upvote_ratio, 3),
        },
        "subreddits_fetched": subs,
        "posts": unique[:20],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/reddit/sentiment")
async def reddit_sentiment_endpoint(
    category: str = Query("crypto", description="Category: crypto, forex, gold, us_stocks"),
    min_score: int = Query(10, ge=0, le=1000, description="Minimum Reddit score filter"),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """GET /social/reddit/sentiment — Reddit post sentiment by category."""
    now = time.monotonic()
    if not refresh and _cache["data"] and (now - _cache["ts"]) < _CACHE_TTL and _cache["category"] == category:
        return _cache["data"]

    try:
        result = await fetch_reddit_sentiment(category, min_score=min_score)
        _cache["data"] = result
        _cache["ts"] = now
        _cache["category"] = category
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Reddit sentiment unavailable: {exc}") from exc


@router.get("/sentiment/aggregate")
async def aggregate_social_sentiment(
    category: str = Query("crypto", description="Category to aggregate"),
    refresh: bool = Query(False, description="Force refresh"),
):
    """
    GET /social/sentiment/aggregate — Combined YouTube + Reddit + LunarCrush sentiment.
    Returns a unified sentiment score across all social sources.
    """
    from routers.social_sentiment import fetch_social_metrics

    # Fetch all sources in parallel
    yt_task = fetch_youtube_sentiment(category)
    rd_task = fetch_reddit_sentiment(category)

    # LunarCrush for top symbols
    lc_symbols = {
        "crypto": "BTC",
        "forex": "EUR",
        "gold": "XAU",
        "us_stocks": "AAPL",
    }
    lc_task = fetch_social_metrics(lc_symbols.get(category, "BTC"))

    yt, rd, lc = await asyncio.gather(yt_task, rd_task, lc_task, return_exceptions=True)

    # Collect sentiment scores
    scores = []
    sources = {}

    if isinstance(yt, dict) and "overall_sentiment" in yt:
        yt_score = yt["overall_sentiment"].get("overall_score", 0)
        scores.append(yt_score)
        sources["youtube"] = {
            "label": yt["overall_sentiment"].get("overall_label", "neutral"),
            "score": yt_score,
            "video_count": yt.get("video_count", 0),
        }

    if isinstance(rd, dict) and "overall_sentiment" in rd:
        rd_score = rd["overall_sentiment"].get("overall_score", 0)
        scores.append(rd_score)
        sources["reddit"] = {
            "label": rd["overall_sentiment"].get("overall_label", "neutral"),
            "score": rd_score,
            "post_count": rd.get("post_count", 0),
            "engagement": rd.get("engagement", {}),
        }

    if isinstance(lc, dict):
        galaxy = lc.get("galaxy_score", 50)
        lc_score = (galaxy - 50) / 50  # normalize 0-100 to -1..1
        scores.append(lc_score)
        sources["lunarcrush"] = {
            "galaxy_score": galaxy,
            "alt_rank": lc.get("alt_rank", 0),
            "social_dominance": lc.get("social_dominance", 0),
            "score": round(lc_score, 3),
        }

    # Compute blended score
    blended = sum(scores) / len(scores) if scores else 0.0
    if blended > 0.1:
        blended_label = "positive"
    elif blended < -0.1:
        blended_label = "negative"
    else:
        blended_label = "neutral"

    bonus = get_sentiment_bonus(blended_label, blended)

    return {
        "category": category,
        "blended_sentiment": {
            "label": blended_label,
            "score": round(blended, 4),
            "confidence": round(min(abs(blended) + 0.3, 0.95), 4),
        },
        "sentiment_bonus": round(bonus, 2),
        "sources": sources,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
