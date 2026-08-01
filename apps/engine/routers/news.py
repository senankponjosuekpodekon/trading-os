"""
News Router — NewsAPI + Sentiment NLP + RAG ingestion
- Fetch actualités par actif (crypto, forex, BRVM)
- Analyse sentiment via LLM (bullish/bearish/neutral) → ±10 pts confiance
- Ingestion auto dans pgvector pour enrichir le chat RAG
- Cache Redis (TTL 15 min) pour limiter les appels NewsAPI (100/jour plan gratuit)
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import httpx
import asyncio
import json

import config
from utils.cache import get_cached, set_cached
from utils.logger import get_logger
from utils.rate_limiter import rate_limit
from utils.http import retry_async

router = APIRouter()

NEWS_API_KEY    = config.settings.news_api_key
NEWS_BASE_URL   = "https://newsapi.org/v2"
CACHE_TTL_SEC   = 900   # 15 min
DATABASE_URL    = config.settings.database_url

logger = get_logger(__name__)

# Mapping actif → mots-clés de recherche NewsAPI
SYMBOL_KEYWORDS: dict[str, list[str]] = {
    "BTC/USDT":   ["Bitcoin", "BTC"],
    "ETH/USDT":   ["Ethereum", "ETH"],
    "SOL/USDT":   ["Solana", "SOL"],
    "BNB/USDT":   ["BNB", "Binance Coin"],
    "AVAX/USDT":  ["Avalanche", "AVAX"],
    "ADA/USDT":   ["Cardano", "ADA"],
    "XRP/USDT":   ["XRP", "Ripple"],
    "LINK/USDT":  ["Chainlink", "LINK"],
    "LTC/USDT":   ["Litecoin", "LTC"],
    "DOT/USDT":   ["Polkadot", "DOT"],
    "MATIC/USDT": ["Polygon", "MATIC"],
    "EUR/USD":    ["Euro", "EUR/USD", "ECB"],
    "GBP/USD":    ["British Pound", "GBP", "Bank of England"],
    "XAU/USD":    ["Gold", "XAU", "gold price"],
    "WTI/USD":    ["WTI", "crude oil", "oil price"],
    "crypto":     ["cryptocurrency", "crypto market", "DeFi"],
    "forex":      ["forex", "currency", "Federal Reserve", "interest rate"],
}

# Domaines financiers de qualité pour NewsAPI
NEWS_DOMAINS = "coindesk.com,cointelegraph.com,reuters.com,bloomberg.com,ft.com,marketwatch.com,investing.com,dailyhodl.com"


# ── Modèles ────────────────────────────────────────────────────
class NewsArticle(BaseModel):
    title:       str
    description: Optional[str]
    url:         str
    source:      str
    published_at: str
    sentiment:   Optional[str] = None   # bullish | bearish | neutral
    sentiment_score: Optional[float] = None  # -1.0 à +1.0


class NewsRequest(BaseModel):
    symbol:   str
    limit:    int = 5
    analyze:  bool = True   # True = appelle LLM pour sentiment


class SentimentResult(BaseModel):
    symbol:        str
    sentiment:     str       # bullish | bearish | neutral
    score:         float     # -1.0 → -0.3 bearish | -0.3 → 0.3 neutral | 0.3 → 1.0 bullish
    confidence_bonus: int    # ±10 → utilisé par scan.py
    articles:      List[NewsArticle]
    cached:        bool = False


# ── Helpers ────────────────────────────────────────────────────
async def _cache_get(key: str):
    return await get_cached(key)


async def _cache_set(key: str, data):
    await set_cached(key, data, ttl=CACHE_TTL_SEC)


def _keywords_for(symbol: str) -> str:
    kws = SYMBOL_KEYWORDS.get(symbol)
    if not kws:
        base = symbol.split("/")[0]
        kws = [base]
    return " OR ".join(f'"{k}"' for k in kws[:2])


@rate_limit(max_concurrent=1, min_delay=1.0)
async def _fetch_articles(symbol: str, limit: int = 10) -> list[dict]:
    """Appelle NewsAPI /v2/everything et retourne les articles bruts."""
    if not NEWS_API_KEY:
        return []

    query = _keywords_for(symbol)
    params = {
        "q":        query,
        "language": "en",
        "sortBy":   "publishedAt",
        "pageSize": min(limit, 20),
        "domains":  NEWS_DOMAINS,
        "apiKey":   NEWS_API_KEY,
    }
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"{NEWS_BASE_URL}/everything", params=params)
                r.raise_for_status()
                return r.json()
        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="newsapi")
        return data.get("articles", [])
    except Exception as e:
        logger.warning("newsapi_fetch_failed", symbol=symbol, error=str(e))
        return []


async def _analyze_sentiment(articles: list[dict], symbol: str) -> tuple[str, float]:
    """
    Appelle le LLM pour analyser le sentiment global des titres.
    Retourne (sentiment_label, score_float).
    Score: -1.0 (très bearish) → +1.0 (très bullish)
    """
    if not articles:
        return "neutral", 0.0

    from routers.llm import _call_llm, _effective_provider
    if _effective_provider() == "mock":
        return _mock_sentiment(articles)

    headlines = "\n".join(
        f"- {a['title']}" for a in articles[:8] if a.get("title")
    )
    prompt = f"""Analyse le sentiment de marché pour {symbol} basé sur ces titres d'actualité récents.
Réponds UNIQUEMENT avec un JSON valide sur une ligne, format exact :
{{"sentiment": "bullish|bearish|neutral", "score": <float entre -1.0 et 1.0>, "reason": "<1 phrase>"}}

Titres :
{headlines}

Règles :
- bullish si les news indiquent hausse, adoption, régulation positive, partenariat
- bearish si les news indiquent baisse, hack, régulation négative, panique
- neutral si mixte ou pas assez d'info

JSON:"""

    try:
        response = await _call_llm(prompt, max_tokens=80)
        # Extraire le JSON de la réponse
        start = response.find("{")
        end   = response.rfind("}") + 1
        if start >= 0 and end > start:
            parsed = json.loads(response[start:end])
            label  = parsed.get("sentiment", "neutral")
            score  = float(parsed.get("score", 0.0))
            score  = max(-1.0, min(1.0, score))
            if label not in ("bullish", "bearish", "neutral"):
                label = "neutral"
            return label, score
    except Exception:
        pass

    return "neutral", 0.0


def _mock_sentiment(articles: list[dict]) -> tuple[str, float]:
    """Heuristique simple basée sur mots-clés quand LLM non dispo."""
    bullish_words = {"surge", "rally", "bull", "gain", "rise", "high", "record", "adoption", "approve", "launch"}
    bearish_words = {"crash", "drop", "fall", "bear", "hack", "ban", "sell", "low", "warning", "fear", "dump"}
    score = 0.0
    for a in articles[:8]:
        text = (a.get("title", "") + " " + (a.get("description") or "")).lower()
        score += sum(1 for w in bullish_words if w in text)
        score -= sum(1 for w in bearish_words if w in text)

    normalized = max(-1.0, min(1.0, score / max(len(articles), 1)))
    if normalized > 0.15:
        return "bullish", normalized
    if normalized < -0.15:
        return "bearish", normalized
    return "neutral", normalized


def _score_to_bonus(score: float) -> int:
    """Convertit un score sentiment en bonus de confiance (±10)."""
    if score >= 0.3:
        return 10
    if score >= 0.15:
        return 5
    if score <= -0.3:
        return -10
    if score <= -0.15:
        return -5
    return 0


async def _ingest_to_rag(articles: list[dict], symbol: str):
    """Insère les articles du jour dans pgvector pour enrichir le chat RAG."""
    if not articles:
        return 0
    pool = None
    try:
        import asyncpg
        from routers.rag import _embed
        pool_url = DATABASE_URL.replace("postgres://", "postgresql://")
        pool = await asyncpg.create_pool(pool_url, min_size=1, max_size=2)
        inserted = 0
        async with pool.acquire() as conn:
            for a in articles[:5]:
                title   = a.get("title", "")
                content = f"{title}. {a.get('description') or ''}".strip()
                if not content or len(content) < 20:
                    continue
                # Éviter les doublons par titre
                exists = await conn.fetchval(
                    "SELECT COUNT(*) FROM rag_documents WHERE title = $1", title
                )
                if exists:
                    continue
                emb = _embed(content)
                emb_str = "[" + ",".join(str(x) for x in emb) + "]"
                await conn.execute(
                    """INSERT INTO rag_documents (category, title, content, embedding)
                       VALUES ($1, $2, $3, $4::vector)
                       ON CONFLICT DO NOTHING""",
                    "news", title, content, emb_str
                )
                inserted += 1
        return inserted
    except Exception:
        return 0
    finally:
        if pool is not None:
            try:
                await pool.close()
            except Exception:
                pass


# ── Endpoint principal ─────────────────────────────────────────
@router.post("/news/sentiment")
async def get_news_sentiment(req: NewsRequest) -> SentimentResult:
    """
    Fetch les news + analyse sentiment LLM pour un actif.
    Utilisé par scan.py pour enrichir le score de confiance.
    """
    cache_key = f"sentiment:{req.symbol}:{req.limit}"
    cached = await _cache_get(cache_key)
    if cached:
        return SentimentResult(**{**cached, "cached": True})

    if not NEWS_API_KEY:
        return SentimentResult(
            symbol=req.symbol, sentiment="neutral", score=0.0,
            confidence_bonus=0, articles=[], cached=False
        )

    raw_articles = await _fetch_articles(req.symbol, limit=req.limit)

    if req.analyze:
        sentiment_label, score = await _analyze_sentiment(raw_articles, req.symbol)
    else:
        sentiment_label, score = _mock_sentiment(raw_articles)

    bonus = _score_to_bonus(score)

    articles = [
        NewsArticle(
            title=a.get("title", ""),
            description=a.get("description"),
            url=a.get("url", ""),
            source=a.get("source", {}).get("name", ""),
            published_at=a.get("publishedAt", ""),
            sentiment=sentiment_label,
            sentiment_score=round(score, 3),
        )
        for a in raw_articles[:req.limit]
    ]

    result = {
        "symbol":           req.symbol,
        "sentiment":        sentiment_label,
        "score":            round(score, 3),
        "confidence_bonus": bonus,
        "articles":         [a.model_dump() for a in articles],
    }
    await _cache_set(cache_key, result)

    # Ingestion RAG en arrière-plan (non bloquant)
    asyncio.create_task(_ingest_to_rag(raw_articles, req.symbol))

    return SentimentResult(**result, cached=False)


@router.get("/news/articles")
async def get_articles(symbol: str = "crypto", limit: int = 10):
    """Liste les articles récents pour un actif (sans analyse sentiment)."""
    cache_key = f"articles:{symbol}:{limit}"
    cached = await _cache_get(cache_key)
    if cached:
        return {"symbol": symbol, "articles": cached, "cached": True}

    if not NEWS_API_KEY:
        return {"symbol": symbol, "articles": [], "cached": False, "error": "NEWS_API_KEY non configurée"}

    raw = await _fetch_articles(symbol, limit=limit)
    articles = [
        {
            "title":        a.get("title", ""),
            "description":  a.get("description"),
            "url":          a.get("url", ""),
            "source":       a.get("source", {}).get("name", ""),
            "published_at": a.get("publishedAt", ""),
            "image":        a.get("urlToImage"),
        }
        for a in raw[:limit]
    ]
    await _cache_set(cache_key, articles)
    return {"symbol": symbol, "articles": articles, "cached": False}


@router.get("/news/health")
async def news_health():
    configured = bool(NEWS_API_KEY)
    status = "ok" if configured else "no_key"
    docs = 0
    pool = None
    try:
        import asyncpg
        pool = await asyncpg.create_pool(
            DATABASE_URL.replace("postgres://", "postgresql://"), min_size=1, max_size=1
        )
        async with pool.acquire() as conn:
            docs = await conn.fetchval(
                "SELECT COUNT(*) FROM rag_documents WHERE category = 'news'"
            )
    except Exception:
        pass
    finally:
        if pool is not None:
            try:
                await pool.close()
            except Exception:
                pass
    return {
        "status":          status,
        "configured":      configured,
        "cache_ttl_min":   CACHE_TTL_SEC // 60,
        "news_in_rag":     docs,
        "domains":         NEWS_DOMAINS.split(","),
    }


@router.delete("/news/cache")
async def clear_cache():
    """Vide le cache Redis des news (sentiment + articles)."""
    from utils.cache import cache
    count = 0
    try:
        r = await cache.client()
        for prefix in ("sentiment:*", "articles:*"):
            async for key in r.scan_iter(match=prefix):
                await r.delete(key)
                count += 1
    except Exception as e:
        logger.warning("clear_cache failed", error=str(e))
    return {"cleared": count}
