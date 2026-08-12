"""
News Scraper — Scraper propriétaire multi-sources, zéro dépendance API payante.

Sources couvertes :
  RSS/Sites     : CoinDesk, CoinTelegraph, Decrypt, The Block, Bitcoin Magazine,
                  Reuters (crypto/forex), Investing.com, FXStreet, ForexLive,
                  Kitco (or/métaux), BRVM officiel, Jeune Afrique (BRVM/Afrique)
  Reddit        : r/CryptoCurrency, r/Bitcoin, r/ethtrader, r/Forex (JSON API public)
  Twitter/X     : Via Nitter instances publiques (sans clé)
  CryptoPanic   : API publique (sans clé, limitée)
  Fear & Greed  : alternative.me (gratuit, sans clé)

Pipeline :
  1. Fetch parallèle toutes sources → articles bruts
  2. Déduplication par hash titre
  3. Normalisation format commun
  4. Analyse sentiment (LLM ou heuristique)
  5. Cache 15 min par symbole
  6. Ingestion RAG pgvector en arrière-plan
  7. Endpoint : GET /scraper/news/{symbol}
               GET /scraper/fear-greed
               GET /scraper/social/{symbol}
               POST /scraper/refresh
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import asyncio
import hashlib
import time
import re

import httpx
from bs4 import BeautifulSoup

import config
from utils.logger import get_logger
from utils.rate_limiter import rate_limit

router = APIRouter()

DATABASE_URL = config.settings.database_url

logger = get_logger(__name__)

CACHE_TTL = 900  # 15 min
_cache: dict[str, tuple[float, list]] = {}

# ── Modèles ──────────────────────────────────────────────────────────────────

class ScrapedArticle(BaseModel):
    title:        str
    url:          str
    source:       str
    source_type:  str        # rss | reddit | social | api
    published_at: Optional[str] = None
    summary:      Optional[str] = None
    sentiment:    Optional[str] = None   # bullish | bearish | neutral
    score:        Optional[float] = None
    hash:         Optional[str] = None


class FearGreedResult(BaseModel):
    value:       int
    label:       str          # "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
    signal:      str          # contrarian_buy | neutral | contrarian_sell
    bonus:       int          # ±20 pts pour scan.py
    timestamp:   Optional[str] = None


class SocialPost(BaseModel):
    text:        str
    source:      str          # reddit | nitter
    author:      Optional[str] = None
    score:       Optional[int] = None   # reddit upvotes
    url:         Optional[str] = None
    sentiment:   Optional[str] = None


# ── Sources RSS ───────────────────────────────────────────────────────────────

RSS_SOURCES: dict[str, list[str]] = {
    "crypto": [
        "https://www.coindesk.com/arc/outboundfeeds/rss/",
        "https://cointelegraph.com/rss",
        "https://decrypt.co/feed",
        "https://www.theblock.co/rss.xml",
        "https://bitcoinmagazine.com/.rss/full/",
        "https://cryptopanic.com/news/rss/",
    ],
    "bitcoin": [
        "https://www.coindesk.com/arc/outboundfeeds/rss/?category=markets",
        "https://bitcoinmagazine.com/.rss/full/",
    ],
    "ethereum": [
        "https://cointelegraph.com/rss/tag/ethereum",
        "https://decrypt.co/feed",
    ],
    "forex": [
        "https://www.forexlive.com/feed/news",
        "https://www.fxstreet.com/rss/news",
        "https://feeds.reuters.com/reuters/businessNews",
    ],
    "gold": [
        "https://www.kitco.com/rss/kitco-news.xml",
        "https://feeds.reuters.com/reuters/businessNews",
    ],
    "brvm": [
        "https://www.jeuneafrique.com/feed/",
        "https://www.financialafrik.com/feed/",
        "https://feeds.reuters.com/reuters/AFRICAOnlineNews",
    ],
    "macro": [
        "https://feeds.reuters.com/reuters/businessNews",
        "https://feeds.reuters.com/reuters/topNews",
        "https://www.investing.com/rss/news.rss",
    ],
}

# Mots-clés par symbole pour filtrer les articles non pertinents
SYMBOL_KEYWORDS: dict[str, list[str]] = {
    "BTC/USDT":   ["bitcoin", "btc"],
    "ETH/USDT":   ["ethereum", "eth", "ether"],
    "SOL/USDT":   ["solana", "sol"],
    "BNB/USDT":   ["bnb", "binance"],
    "AVAX/USDT":  ["avalanche", "avax"],
    "ADA/USDT":   ["cardano", "ada"],
    "XRP/USDT":   ["xrp", "ripple"],
    "LINK/USDT":  ["chainlink", "link"],
    "LTC/USDT":   ["litecoin", "ltc"],
    "DOT/USDT":   ["polkadot", "dot"],
    "MATIC/USDT": ["polygon", "matic"],
    "EUR/USD":    ["euro", "eur", "ecb", "european central"],
    "GBP/USD":    ["pound", "gbp", "bank of england", "boe"],
    "USD/JPY":    ["yen", "jpy", "bank of japan", "boj"],
    "XAU/USD":    ["gold", "xau", "bullion"],
    "WTI/USD":    ["oil", "wti", "crude", "opec"],
    "crypto":     ["crypto", "bitcoin", "ethereum", "blockchain", "defi", "web3"],
    "brvm":       ["brvm", "west africa", "waemu", "bourse abidjan", "afrique"],
    "ONTBF":      ["onatel", "burkina"],
    "SNTS":       ["sonatel", "senegal"],
    "ORGT":       ["oragroup", "togo"],
    "ORAC":       ["orange", "cote d'ivoire", "ivoire"],
    "ETIT":       ["ecobank", "etit"],
    "BOABF":      ["bank of africa", "burkina"],
    "BOAC":       ["bank of africa", "cote d'ivoire", "ivoire"],
    "SGBC":       ["societe generale", "cote d'ivoire", "ivoire"],
    "ABJC":       ["servair", "abidjan"],
    "CIEC":       ["cie", "cote d'ivoire", "ivoire", "electricite"],
    "BICC":       ["bici", "cote d'ivoire", "ivoire"],
    "CBIBF":      ["coris", "burkina"],
    "STAC":       ["setao", "cote d'ivoire", "ivoire"],
    "LNBB":       ["loterie", "benin"],
    "PALC":       ["palm", "cote d'ivoire", "ivoire"],
    "SOGC":       ["sogb", "palm"],
    "SIVC":       ["sicogi", "erium"],
    "NSBC":       ["nsia", "banque"],
    "TTLC":       ["totalenergies", "cote d'ivoire", "ivoire"],
    "NTLC":       ["nestle", "cote d'ivoire", "ivoire"],
    "UNLC":       ["unilever", "cote d'ivoire", "ivoire"],
    "FTSC":       ["filtisac", "cote d'ivoire", "ivoire"],
    "SAFC":       ["safca", "cote d'ivoire", "ivoire"],
    "SCRC":       ["sucrivoire", "cote d'ivoire", "ivoire"],
    "SDSC":       ["africa global logistics", "cote d'ivoire", "ivoire"],
    "CFAC":       ["cfao", "cote d'ivoire", "ivoire"],
    "SHEC":       ["vivo energy", "cote d'ivoire", "ivoire"],
    "SPHC":       ["saph", "cote d'ivoire", "ivoire"],
    "SDCC":       ["sode", "cote d'ivoire", "ivoire"],
    "SEMC":       ["siem", "eviosys", "cote d'ivoire", "ivoire"],
    "SLBC":       ["solibra", "cote d'ivoire", "ivoire"],
    "SMBC":       ["smb", "cote d'ivoire", "ivoire"],
    "STBC":       ["sitab", "cote d'ivoire", "ivoire"],
    "PRSC":       ["tractafric", "cote d'ivoire", "ivoire"],
    "CABC":       ["sicable", "cote d'ivoire", "ivoire"],
    "BNBC":       ["bernabe", "cote d'ivoire", "ivoire"],
    "BICB":       ["bicec", "benin"],
    "NEIC":       ["nei-ceda", "cote d'ivoire", "ivoire"],
    "BOAB":       ["bank of africa", "benin"],
    "BOAM":       ["bank of africa", "mali"],
    "BOAN":       ["bank of africa", "niger"],
    "BOAS":       ["bank of africa", "senegal"],
    "TTLS":       ["totalenergies", "senegal"],
    "UNXC":       ["uniwax", "cote d'ivoire", "ivoire"],
    "SICC":       ["sicor", "cote d'ivoire", "ivoire"],
    "ECOC":       ["ecobank", "cote d'ivoire", "ivoire"],
}

# Reddit subreddits par marché
REDDIT_SUBS: dict[str, list[str]] = {
    "BTC/USDT":   ["Bitcoin", "CryptoCurrency"],
    "ETH/USDT":   ["ethtrader", "CryptoCurrency"],
    "SOL/USDT":   ["solana", "CryptoCurrency"],
    "XRP/USDT":   ["Ripple", "CryptoCurrency"],
    "crypto":     ["CryptoCurrency", "CryptoMarkets", "SatoshiStreetBets"],
    "EUR/USD":    ["Forex", "investing"],
    "GBP/USD":    ["Forex", "investing"],
    "forex":      ["Forex", "investing", "economics"],
    "XAU/USD":    ["Gold", "investing", "wallstreetbets"],
    "brvm":       [],
}

# Nitter instances publiques (Twitter sans clé API)
NITTER_INSTANCES = [
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
    "https://nitter.net",
]

# Comptes Twitter clés par marché
TWITTER_ACCOUNTS: dict[str, list[str]] = {
    "crypto":  ["CoinDesk", "Cointelegraph", "DocumentingBTC", "APompliano"],
    "BTC/USDT": ["DocumentingBTC", "saylor", "WClementeIII"],
    "ETH/USDT": ["VitalikButerin", "sassal0x"],
    "forex":   ["ForexLive", "kgreifeld", "FXStreetNews"],
    "XAU/USD": ["Kitco_News", "goldsilver_com"],
    "brvm":    [],
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:12]


def _cache_get(key: str) -> Optional[list]:
    if key in _cache:
        ts, data = _cache[key]
        if time.monotonic() - ts < CACHE_TTL:
            return data
        del _cache[key]
    return None


def _cache_set(key: str, data: list):
    _cache[key] = (time.monotonic(), data)


def _symbol_to_source_category(symbol: str) -> str:
    if any(x in symbol for x in ["EUR", "GBP", "JPY", "USD", "CHF", "CAD", "AUD"]):
        if "XAU" in symbol:
            return "gold"
        return "forex"
    from scrapers.brvm_scraper import is_brvm_symbol
    if is_brvm_symbol(symbol) or "BRVM" in symbol:
        return "brvm"
    return "crypto"


def _is_relevant(text: str, symbol: str) -> bool:
    keywords = SYMBOL_KEYWORDS.get(symbol, [])
    if not keywords:
        return True
    text_lower = text.lower()
    return any(kw in text_lower for kw in keywords)


def _sentiment_heuristic(text: str) -> tuple[str, float]:
    bullish = {"surge", "rally", "bull", "gain", "rise", "high", "record",
               "adoption", "approve", "launch", "partnership", "upgrade",
               "all-time", "breakout", "buy", "accumulate", "positive"}
    bearish = {"crash", "drop", "fall", "bear", "hack", "ban", "sell", "low",
               "warning", "fear", "dump", "scam", "fraud", "attack", "exploit",
               "lawsuit", "regulation", "fine", "bankruptcy", "collapse"}
    words = set(re.findall(r'\b\w+\b', text.lower()))
    b = len(words & bullish)
    s = len(words & bearish)
    total = b + s
    if total == 0:
        return "neutral", 0.0
    score = (b - s) / total
    if score > 0.2:
        return "bullish", round(score, 2)
    if score < -0.2:
        return "bearish", round(score, 2)
    return "neutral", round(score, 2)


# ── Fetch RSS ─────────────────────────────────────────────────────────────────

@rate_limit(max_concurrent=5, min_delay=0.1)
async def _fetch_rss(url: str, source_name: str, symbol: str,
                     client: httpx.AsyncClient) -> list[ScrapedArticle]:
    try:
        r = await client.get(url, timeout=8, follow_redirects=True)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "xml")
        items = soup.find_all("item")
        if not items:
            items = soup.find_all("entry")  # Atom feeds

        articles = []
        seen = set()
        for item in items[:20]:
            title = (item.find("title") or item.find("name"))
            title = title.get_text(strip=True) if title else ""
            if not title or not _is_relevant(title, symbol):
                continue

            link = item.find("link")
            url_art = (link.get("href") or link.get_text(strip=True)) if link else ""

            pub = item.find("pubDate") or item.find("published") or item.find("updated")
            pub_str = pub.get_text(strip=True) if pub else None

            desc = item.find("description") or item.find("summary")
            summary = BeautifulSoup(
                desc.get_text(strip=True), "html.parser"
            ).get_text()[:300] if desc else None

            h = _hash(title)
            if h in seen:
                continue
            seen.add(h)

            sentiment, score = _sentiment_heuristic(f"{title} {summary or ''}")
            articles.append(ScrapedArticle(
                title=title,
                url=url_art,
                source=source_name,
                source_type="rss",
                published_at=pub_str,
                summary=summary,
                sentiment=sentiment,
                score=score,
                hash=h,
            ))
        return articles
    except Exception as e:
        logger.warning("rss_fetch_failed", source=source_name, url=url, symbol=symbol, error=str(e))
        return []


# ── Fetch Reddit JSON (API publique, sans clé) ────────────────────────────────

@rate_limit(max_concurrent=3, min_delay=0.2)
async def _fetch_reddit(subreddit: str, symbol: str,
                        client: httpx.AsyncClient) -> list[ScrapedArticle]:
    try:
        url = f"https://www.reddit.com/r/{subreddit}/hot.json?limit=25"
        headers = {"User-Agent": "TradingOS/1.0 (research bot)"}
        r = await client.get(url, headers=headers, timeout=8, follow_redirects=True)
        r.raise_for_status()
        data = r.json()
        posts = data.get("data", {}).get("children", [])

        articles = []
        for post in posts:
            d = post.get("data", {})
            title = d.get("title", "")
            if not title or not _is_relevant(title, symbol):
                continue
            if d.get("score", 0) < 10:
                continue

            sentiment, score = _sentiment_heuristic(title)
            articles.append(ScrapedArticle(
                title=title,
                url=f"https://reddit.com{d.get('permalink', '')}",
                source=f"r/{subreddit}",
                source_type="reddit",
                published_at=None,
                summary=d.get("selftext", "")[:200] or None,
                sentiment=sentiment,
                score=score,
                hash=_hash(title),
            ))
        return articles
    except Exception as e:
        logger.warning("reddit_fetch_failed", subreddit=subreddit, symbol=symbol, error=str(e))
        return []


# ── Fetch Nitter (Twitter sans API) ──────────────────────────────────────────

@rate_limit(max_concurrent=3, min_delay=0.2)
async def _fetch_nitter(account: str, symbol: str,
                        client: httpx.AsyncClient) -> list[ScrapedArticle]:
    for instance in NITTER_INSTANCES:
        try:
            url = f"{instance}/{account}/rss"
            r = await client.get(url, timeout=6, follow_redirects=True)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "xml")
            items = soup.find_all("item")

            articles = []
            for item in items[:10]:
                title_tag = item.find("title")
                title = title_tag.get_text(strip=True) if title_tag else ""
                if not title or not _is_relevant(title, symbol):
                    continue

                link = item.find("link")
                url_art = link.get_text(strip=True) if link else ""

                pub = item.find("pubDate")
                pub_str = pub.get_text(strip=True) if pub else None

                sentiment, score = _sentiment_heuristic(title)
                articles.append(ScrapedArticle(
                    title=title,
                    url=url_art,
                    source=f"@{account}",
                    source_type="social",
                    published_at=pub_str,
                    summary=None,
                    sentiment=sentiment,
                    score=score,
                    hash=_hash(title),
                ))
            return articles
        except Exception as e:
            logger.warning("nitter_instance_failed", account=account, instance=instance, symbol=symbol, error=str(e))
            continue
    logger.warning("nitter_all_instances_failed", account=account, symbol=symbol)
    return []


# ── Fetch CryptoPanic (API publique limitée, sans clé) ───────────────────────

@rate_limit(max_concurrent=1, min_delay=0.5)
async def _fetch_cryptopanic(symbol: str, client: httpx.AsyncClient) -> list[ScrapedArticle]:
    cat = _symbol_to_source_category(symbol)
    if cat not in ("crypto", "bitcoin", "ethereum"):
        return []
    currency = symbol.split("/")[0].lower() if "/" in symbol else symbol.lower()
    try:
        url = f"https://cryptopanic.com/api/v1/posts/?auth_token=&public=true&currencies={currency}"
        r = await client.get(url, timeout=8, follow_redirects=True)
        r.raise_for_status()
        data = r.json()
        results = data.get("results", [])

        articles = []
        for post in results[:15]:
            title = post.get("title", "")
            if not title:
                continue
            votes = post.get("votes", {})
            bullish_votes = votes.get("positive", 0)
            bearish_votes = votes.get("negative", 0)
            total_votes = bullish_votes + bearish_votes

            if total_votes > 0:
                vote_score = (bullish_votes - bearish_votes) / total_votes
                if vote_score > 0.2:
                    sentiment = "bullish"
                elif vote_score < -0.2:
                    sentiment = "bearish"
                else:
                    sentiment = "neutral"
            else:
                sentiment, vote_score = _sentiment_heuristic(title)

            articles.append(ScrapedArticle(
                title=title,
                url=post.get("url", ""),
                source="CryptoPanic",
                source_type="api",
                published_at=post.get("published_at"),
                summary=None,
                sentiment=sentiment,
                score=round(vote_score if total_votes > 0 else 0.0, 2),
                hash=_hash(title),
            ))
        return articles
    except Exception as e:
        logger.warning("cryptopanic_fetch_failed", symbol=symbol, error=str(e))
        return []


# ── Fear & Greed Index ────────────────────────────────────────────────────────

@rate_limit(max_concurrent=1, min_delay=0.5)
async def _fetch_fear_greed(client: httpx.AsyncClient) -> FearGreedResult:
    try:
        r = await client.get("https://api.alternative.me/fng/", timeout=6)
        r.raise_for_status()
        data = r.json()
        entry = data.get("data", [{}])[0]
        value = int(entry.get("value", 50))
        label = entry.get("value_classification", "Neutral")
        timestamp = entry.get("timestamp")

        if value <= 20:
            signal, bonus = "contrarian_buy", 20
        elif value <= 35:
            signal, bonus = "contrarian_buy", 10
        elif value >= 80:
            signal, bonus = "contrarian_sell", -20
        elif value >= 65:
            signal, bonus = "contrarian_sell", -10
        else:
            signal, bonus = "neutral", 0

        return FearGreedResult(
            value=value,
            label=label,
            signal=signal,
            bonus=bonus,
            timestamp=timestamp,
        )
    except Exception as e:
        logger.warning("fear_greed_fetch_failed", error=str(e))
        return FearGreedResult(value=50, label="Neutral", signal="neutral",
                               bonus=0, timestamp=None)


# ── Agrégateur principal ──────────────────────────────────────────────────────

async def scrape_all_sources(symbol: str) -> list[ScrapedArticle]:
    """Scrape toutes les sources en parallèle pour un symbole donné."""
    cached = _cache_get(f"scraper:{symbol}")
    if cached is not None:
        return cached

    cat = _symbol_to_source_category(symbol)
    rss_urls = RSS_SOURCES.get(cat, RSS_SOURCES["crypto"])
    reddit_subs = REDDIT_SUBS.get(symbol, REDDIT_SUBS.get(cat, []))
    twitter_accounts = TWITTER_ACCOUNTS.get(symbol, TWITTER_ACCOUNTS.get(cat, []))

    async with httpx.AsyncClient(
        timeout=10,
        headers={"User-Agent": "TradingOS/1.0"},
        limits=httpx.Limits(max_connections=30),
    ) as client:
        tasks = []
        source_names: list[str] = []

        for url in rss_urls:
            source_name = url.split("/")[2].replace("www.", "")
            tasks.append(asyncio.wait_for(_fetch_rss(url, source_name, symbol, client), timeout=5.0))
            source_names.append(f"rss:{source_name}")

        for sub in reddit_subs[:3]:
            tasks.append(asyncio.wait_for(_fetch_reddit(sub, symbol, client), timeout=5.0))
            source_names.append(f"reddit:{sub}")

        for account in twitter_accounts[:3]:
            tasks.append(asyncio.wait_for(_fetch_nitter(account, symbol, client), timeout=5.0))
            source_names.append(f"nitter:{account}")

        if cat == "crypto":
            tasks.append(asyncio.wait_for(_fetch_cryptopanic(symbol, client), timeout=5.0))
            source_names.append("cryptopanic")

        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_articles: list[ScrapedArticle] = []
    seen_hashes: set[str] = set()

    for source_name, batch in zip(source_names, results):
        if isinstance(batch, Exception):
            err = "timeout" if isinstance(batch, asyncio.TimeoutError) else str(batch)
            logger.warning("scraper_source_failed", symbol=symbol, source=source_name, error=err)
            continue
        for art in batch:
            if art.hash and art.hash in seen_hashes:
                continue
            seen_hashes.add(art.hash or _hash(art.title))
            all_articles.append(art)

    all_articles = all_articles[:50]
    _cache_set(f"scraper:{symbol}", all_articles)
    return all_articles


def aggregate_sentiment(articles: list[ScrapedArticle]) -> dict:
    """Calcule le sentiment agrégé de tous les articles scrapés."""
    if not articles:
        return {"label": "neutral", "score": 0.0, "bonus": 0,
                "bullish": 0, "bearish": 0, "neutral": 0}

    counts = {"bullish": 0, "bearish": 0, "neutral": 0}
    total_score = 0.0

    for a in articles:
        label = a.sentiment or "neutral"
        counts[label] = counts.get(label, 0) + 1
        total_score += a.score or 0.0

    avg_score = total_score / len(articles)
    dominant = max(counts, key=counts.get)

    if avg_score >= 0.3:
        bonus = 15
    elif avg_score >= 0.15:
        bonus = 8
    elif avg_score <= -0.3:
        bonus = -15
    elif avg_score <= -0.15:
        bonus = -8
    else:
        bonus = 0

    return {
        "label": dominant,
        "score": round(avg_score, 3),
        "bonus": bonus,
        "bullish": counts["bullish"],
        "bearish": counts["bearish"],
        "neutral":  counts["neutral"],
    }


async def _ingest_scraped_to_rag(articles: list[ScrapedArticle], symbol: str):
    """Insère les articles scrapés dans pgvector pour le RAG."""
    if not articles:
        return 0
    try:
        from routers.rag import _embed, _get_pool
        pool = await _get_pool()
        inserted = 0
        async with pool.acquire() as conn:
            for a in articles[:10]:
                content = f"{a.title}. {a.summary or ''}".strip()
                if len(content) < 20:
                    continue
                exists = await conn.fetchval(
                    "SELECT COUNT(*) FROM rag_documents WHERE title = $1", a.title
                )
                if exists:
                    continue
                emb = _embed(content)
                emb_str = "[" + ",".join(str(x) for x in emb) + "]"
                await conn.execute(
                    """INSERT INTO rag_documents (category, title, content, embedding)
                       VALUES ($1, $2, $3, $4::vector) ON CONFLICT DO NOTHING""",
                    f"news_scraped_{a.source_type}", a.title, content, emb_str
                )
                inserted += 1
        return inserted
    except Exception as e:
        logger.warning("rag_ingest_failed", symbol=symbol, error=str(e))
        return 0


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/scraper/news/{symbol:path}")
async def get_scraped_news(symbol: str, limit: int = 20):
    """
    Scrape toutes les sources (RSS + Reddit + Nitter + CryptoPanic)
    et retourne articles + sentiment agrégé.
    """
    articles = await scrape_all_sources(symbol)
    sentiment = aggregate_sentiment(articles)

    asyncio.create_task(_ingest_scraped_to_rag(articles[:10], symbol))

    return {
        "symbol":    symbol,
        "count":     len(articles),
        "sentiment": sentiment,
        "sources":   list({a.source for a in articles}),
        "articles":  [a.model_dump() for a in articles[:limit]],
        "cached":    False,
    }


@router.get("/scraper/fear-greed")
async def get_fear_greed():
    """
    Fear & Greed Index (alternative.me).
    Retourne valeur 0-100 + signal contrarian + bonus scan.py.
    """
    cached = _cache_get("fear_greed")
    if cached:
        return cached[0] if cached else {}

    async with httpx.AsyncClient(timeout=6) as client:
        result = await _fetch_fear_greed(client)

    _cache_set("fear_greed", [result.model_dump()])
    return result


@router.get("/scraper/social/{symbol:path}")
async def get_social_posts(symbol: str, limit: int = 15):
    """
    Fetch posts Reddit + Nitter uniquement (sans RSS ni API).
    Utile pour détecter le sentiment social brut, non filtré par médias.
    """
    reddit_subs = REDDIT_SUBS.get(symbol, ["CryptoCurrency"])
    twitter_accounts = TWITTER_ACCOUNTS.get(symbol, [])

    async with httpx.AsyncClient(
        timeout=10,
        headers={"User-Agent": "TradingOS/1.0"},
    ) as client:
        tasks = [_fetch_reddit(sub, symbol, client) for sub in reddit_subs[:3]]
        tasks += [_fetch_nitter(acc, symbol, client) for acc in twitter_accounts[:3]]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    posts: list[ScrapedArticle] = []
    seen = set()
    for batch in results:
        if isinstance(batch, Exception):
            continue
        for art in batch:
            h = art.hash or _hash(art.title)
            if h in seen:
                continue
            seen.add(h)
            posts.append(art)

    sentiment = aggregate_sentiment(posts)
    return {
        "symbol":    symbol,
        "count":     len(posts),
        "sentiment": sentiment,
        "posts":     [p.model_dump() for p in posts[:limit]],
    }


@router.delete("/scraper/cache")
async def clear_scraper_cache():
    count = len(_cache)
    _cache.clear()
    return {"cleared": count}


@router.get("/scraper/sources")
async def list_sources():
    """Liste toutes les sources configurées par catégorie."""
    return {
        "rss":     RSS_SOURCES,
        "reddit":  REDDIT_SUBS,
        "twitter": TWITTER_ACCOUNTS,
        "other":   ["CryptoPanic (API public)", "alternative.me Fear & Greed"],
    }
