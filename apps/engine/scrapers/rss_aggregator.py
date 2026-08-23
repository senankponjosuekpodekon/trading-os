"""
RSS Aggregator — Fetch multi-source RSS feeds for Daily Pulse compilation.
Lightweight module: fetch all sources in parallel, deduplicate, return recent articles.
Used by daily_pulse.py to compile the morning brief.
"""
import asyncio
import hashlib
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from bs4 import BeautifulSoup

from utils.logger import get_logger

logger = get_logger(__name__)

# ── RSS Sources by category ──────────────────────────────────────────────────

RSS_FEEDS: dict[str, list[dict]] = {
    "crypto": [
        {"name": "CoinDesk",       "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
        {"name": "CoinTelegraph",  "url": "https://cointelegraph.com/rss"},
        {"name": "Decrypt",        "url": "https://decrypt.co/feed"},
        {"name": "The Block",      "url": "https://www.theblock.co/rss.xml"},
        {"name": "BitcoinMagazine", "url": "https://bitcoinmagazine.com/.rss/full/"},
    ],
    "macro": [
        {"name": "Reuters Biz",    "url": "https://feeds.reuters.com/reuters/businessNews"},
        {"name": "Reuters Top",    "url": "https://feeds.reuters.com/reuters/topNews"},
        {"name": "Investing.com",  "url": "https://www.investing.com/rss/news.rss"},
    ],
    "forex": [
        {"name": "ForexLive",      "url": "https://www.forexlive.com/feed/news"},
        {"name": "FXStreet",       "url": "https://www.fxstreet.com/rss/news"},
    ],
    "gold": [
        {"name": "Kitco News",     "url": "https://www.kitco.com/rss/kitco-news.xml"},
    ],
    "brvm": [
        {"name": "Jeune Afrique",  "url": "https://www.jeuneafrique.com/feed/"},
        {"name": "Financial Afrik", "url": "https://www.financialafrik.com/feed/"},
    ],
    "africa": [
        {"name": "BBC Africa",          "url": "https://feeds.bbci.co.uk/news/world/africa/rss.xml",      "country": "Pan-African"},
        {"name": "Africanews",          "url": "https://www.africanews.com/rss/",                          "country": "Pan-African"},
        {"name": "Reuters Africa",      "url": "https://www.reutersagency.com/feed/?taxonomy=regions&primary=74", "country": "Pan-African"},
        {"name": "News24 South Africa", "url": "https://www.news24.com/feeds/rss",                          "country": "South Africa"},
        {"name": "Business Day SA",     "url": "https://www.businessday.co.za/feed/",                       "country": "South Africa"},
        {"name": "The Citizen SA",      "url": "https://citizen.co.za/feed/",                               "country": "South Africa"},
        {"name": "Premium Times NG",    "url": "https://www.premiumtimesng.com/feed",                       "country": "Nigeria"},
        {"name": "The Guardian NG",     "url": "https://guardian.ng/feed/",                                 "country": "Nigeria"},
        {"name": "Daily Nation KE",     "url": "https://www.nation.co.ke/rss",                              "country": "Kenya"},
        {"name": "The Standard KE",     "url": "https://www.standardmedia.co.ke/rss",                       "country": "Kenya"},
        {"name": "MyJoyOnline GH",      "url": "https://www.myjoyonline.com/feed/",                         "country": "Ghana"},
        {"name": "GhanaWeb",            "url": "https://www.ghanaweb.com/rss/news",                         "country": "Ghana"},
        {"name": "Fratmat CI",          "url": "https://fratmat.info/feed/",                                "country": "Cote d'Ivoire"},
    ],
}

# All sources combined
ALL_FEEDS: list[dict] = []
for feeds in RSS_FEEDS.values():
    ALL_FEEDS.extend(feeds)

# ── Cache ────────────────────────────────────────────────────────────────────

_CACHE_TTL = 3600  # 1h
_cache: dict = {"articles": None, "ts": 0.0}


def _hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:12]


async def _fetch_single_feed(
    feed: dict,
    client: httpx.AsyncClient,
    max_items: int = 15,
) -> list[dict]:
    """Fetch a single RSS feed and return normalized articles."""
    try:
        r = await client.get(feed["url"], timeout=10, follow_redirects=True)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "xml")
        items = soup.find_all("item")
        if not items:
            items = soup.find_all("entry")  # Atom

        articles = []
        for item in items[:max_items]:
            title_tag = item.find("title")
            title = title_tag.get_text(strip=True) if title_tag else ""
            if not title:
                continue

            link_tag = item.find("link")
            if link_tag:
                url = link_tag.get("href") or link_tag.get_text(strip=True)
            else:
                url = ""

            pub_tag = item.find("pubDate") or item.find("published") or item.find("updated")
            pub_str = pub_tag.get_text(strip=True) if pub_tag else None

            desc_tag = item.find("description") or item.find("summary")
            summary = ""
            if desc_tag:
                summary = BeautifulSoup(desc_tag.get_text(strip=True), "html.parser").get_text()[:300]

            articles.append({
                "title":       title,
                "url":         url,
                "source":      feed["name"],
                "country":     feed.get("country", ""),
                "published":   pub_str,
                "summary":     summary,
                "hash":        _hash(title),
                "fetched_at":  datetime.now(timezone.utc).isoformat(),
            })
        return articles
    except Exception as e:
        logger.warning("rss_fetch_failed", source=feed["name"], url=feed["url"], error=str(e))
        return []


async def fetch_all_feeds(categories: Optional[list[str]] = None) -> list[dict]:
    """
    Fetch all RSS feeds in parallel, deduplicate by title hash.
    Returns articles sorted by published date (newest first).
    """
    feeds = []
    if categories:
        for cat in categories:
            feeds.extend(RSS_FEEDS.get(cat, []))
    else:
        feeds = ALL_FEEDS

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *[_fetch_single_feed(f, client) for f in feeds],
            return_exceptions=True,
        )

    all_articles: list[dict] = []
    seen_hashes: set[str] = set()

    for result in results:
        if isinstance(result, Exception):
            continue
        for article in result:
            h = article["hash"]
            if h in seen_hashes:
                continue
            seen_hashes.add(h)
            all_articles.append(article)

    # Sort by published date if available (newest first)
    def _sort_key(a: dict) -> str:
        return a.get("published") or a.get("fetched_at") or ""

    all_articles.sort(key=_sort_key, reverse=True)
    return all_articles


async def get_cached_articles(categories: Optional[list[str]] = None) -> list[dict]:
    """Return cached articles or refresh if stale."""
    now = time.monotonic()
    if _cache["articles"] is None or (now - _cache["ts"]) > _CACHE_TTL:
        articles = await fetch_all_feeds(categories)
        _cache["articles"] = articles
        _cache["ts"] = now
    return _cache["articles"] or []


def invalidate_cache() -> None:
    _cache["articles"] = None
    _cache["ts"] = 0.0
