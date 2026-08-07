"""
YouTube Sentiment — Phase K
Fetches trending crypto/finance YouTube video metadata and analyzes sentiment.
Uses YouTube Data API v3 if available, falls back to scraping search results.
Sentiment analysis via FinBERT (or heuristic fallback).
"""
from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query

from config import settings
from utils.logger import get_logger
from ml.finbert_sentiment import aggregate_sentiment, get_sentiment_bonus

logger = get_logger(__name__)
router = APIRouter()

YOUTUBE_API_KEY = getattr(settings, "youtube_api_key", "") or ""
YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3"

# Search queries per category
SEARCH_QUERIES: dict[str, list[str]] = {
    "crypto": ["bitcoin price prediction", "crypto market today", "altcoin analysis"],
    "forex": ["forex market today", "EUR USD analysis", "dollar index DXY"],
    "gold": ["gold price analysis", "XAU USD forecast"],
    "us_stocks": ["S&P 500 analysis", "tech stocks today", "AAPL TSLA analysis"],
}

# Cache
_cache: dict = {"data": None, "ts": 0.0}
_CACHE_TTL = 1800  # 30 min


async def _search_youtube_api(query: str, max_results: int = 10) -> list[dict]:
    """Search YouTube via Data API v3."""
    if not YOUTUBE_API_KEY:
        return []

    url = f"{YOUTUBE_BASE}/search"
    params = {
        "part": "snippet",
        "q": query,
        "type": "video",
        "maxResults": max_results,
        "order": "relevance",
        "publishedAfter": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "key": YOUTUBE_API_KEY,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()

    videos = []
    for item in data.get("items", []):
        snippet = item.get("snippet", {})
        video_id = item.get("id", {}).get("videoId", "")
        videos.append({
            "video_id": video_id,
            "title": snippet.get("title", ""),
            "channel": snippet.get("channelTitle", ""),
            "published_at": snippet.get("publishedAt", ""),
            "description": snippet.get("description", "")[:500],
            "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
            "url": f"https://www.youtube.com/watch?v={video_id}" if video_id else "",
        })
    return videos


async def _search_youtube_scrape(query: str, max_results: int = 10) -> list[dict]:
    """Fallback: scrape YouTube search results (no API key)."""
    url = "https://www.youtube.com/results"
    params = {"search_query": query, "sp": "CAI%253D"}  # Sort by upload date
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params, headers=headers, follow_redirects=True)
            r.raise_for_status()
            text = r.text

        # Extract video IDs and titles from the page
        video_ids = re.findall(r'"videoId":"([^"]{11})"', text)
        titles = re.findall(r'"title":{"runs":\[{"text":"([^"]+)"}\]', text)
        channels = re.findall(r'"ownerText":{"runs":\[{"text":"([^"]+)"}\]', text)

        videos = []
        seen = set()
        for i, vid in enumerate(video_ids):
            if vid in seen:
                continue
            seen.add(vid)
            title = titles[i] if i < len(titles) else ""
            channel = channels[i] if i < len(channels) else ""
            videos.append({
                "video_id": vid,
                "title": title,
                "channel": channel,
                "published_at": "",
                "description": "",
                "thumbnail": f"https://img.youtube.com/vi/{vid}/mqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
            })
            if len(videos) >= max_results:
                break
        return videos
    except Exception as exc:
        logger.warning("youtube_scrape_failed", query=query, error=str(exc))
        return []


async def _fetch_video_stats(video_ids: list[str]) -> dict[str, dict]:
    """Fetch view/like/comment counts via YouTube API."""
    if not YOUTUBE_API_KEY or not video_ids:
        return {}

    url = f"{YOUTUBE_BASE}/videos"
    params = {
        "part": "statistics",
        "id": ",".join(video_ids[:50]),
        "key": YOUTUBE_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        stats = {}
        for item in data.get("items", []):
            vid = item.get("id", "")
            s = item.get("statistics", {})
            stats[vid] = {
                "views": int(s.get("viewCount", 0)),
                "likes": int(s.get("likeCount", 0)),
                "comments": int(s.get("commentCount", 0)),
            }
        return stats
    except Exception as exc:
        logger.warning("youtube_stats_failed", error=str(exc))
        return {}


async def fetch_youtube_sentiment(category: str = "crypto") -> dict:
    """
    Fetch trending YouTube videos for a category and analyze sentiment.
    Returns aggregated sentiment + top videos.
    """
    queries = SEARCH_QUERIES.get(category, SEARCH_QUERIES["crypto"])

    async def _process_query(q: str) -> list[dict]:
        if YOUTUBE_API_KEY:
            vids = await _search_youtube_api(q, max_results=8)
        else:
            vids = await _search_youtube_scrape(q, max_results=8)
        return vids

    all_videos: list[dict] = []
    results = await asyncio.gather(*[_process_query(q) for q in queries], return_exceptions=True)
    for res in results:
        if isinstance(res, list):
            all_videos.extend(res)

    # Deduplicate by video_id
    seen = set()
    unique = []
    for v in all_videos:
        vid = v.get("video_id", "")
        if vid and vid not in seen:
            seen.add(vid)
            unique.append(v)

    # Fetch stats if API available
    stats = await _fetch_video_stats([v["video_id"] for v in unique if v.get("video_id")])
    for v in unique:
        v["stats"] = stats.get(v.get("video_id", ""), {})

    # Analyze sentiment on titles + descriptions
    texts = []
    for v in unique:
        text = f"{v.get('title', '')} {v.get('description', '')}".strip()
        if text:
            texts.append(text)

    agg = aggregate_sentiment(texts) if texts else {
        "overall_label": "neutral", "overall_score": 0.0, "confidence": 0.0,
        "count": 0, "positive_count": 0, "negative_count": 0, "neutral_count": 0, "items": [],
    }

    # Attach individual sentiment to videos
    from ml.finbert_sentiment import analyze_batch
    sentiments = analyze_batch(texts) if texts else []
    for i, v in enumerate(unique):
        if i < len(sentiments):
            v["sentiment"] = {
                "label": sentiments[i].label,
                "score": sentiments[i].score,
                "confidence": sentiments[i].confidence,
            }
        else:
            v["sentiment"] = {"label": "neutral", "score": 0.0, "confidence": 0.0}

    # Sort by engagement (views + likes) if available
    unique.sort(key=lambda v: v.get("stats", {}).get("views", 0), reverse=True)

    bonus = get_sentiment_bonus(agg["overall_label"], agg["overall_score"])

    return {
        "category": category,
        "overall_sentiment": agg,
        "sentiment_bonus": round(bonus, 2),
        "video_count": len(unique),
        "videos": unique[:15],
        "source": "youtube_api" if YOUTUBE_API_KEY else "youtube_scrape",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/youtube/sentiment")
async def youtube_sentiment_endpoint(
    category: str = Query("crypto", description="Category: crypto, forex, gold, us_stocks"),
    refresh: bool = Query(False, description="Force refresh cache"),
):
    """GET /social/youtube/sentiment — YouTube video sentiment by category."""
    now = time.monotonic()
    if not refresh and _cache["data"] and (now - _cache["ts"]) < _CACHE_TTL:
        cached = _cache["data"]
        if cached.get("category") == category:
            return cached

    try:
        result = await fetch_youtube_sentiment(category)
        _cache["data"] = result
        _cache["ts"] = now
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"YouTube sentiment unavailable: {exc}") from exc
