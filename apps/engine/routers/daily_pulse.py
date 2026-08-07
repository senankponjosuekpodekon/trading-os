"""
Daily Pulse — Brief matinal automatisé compilé via LLM.
Compile news RSS + market data + economic calendar en un brief structuré.
Endpoint: GET /ai/daily-pulse
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import asyncio
import json
import time

from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

# ── Cache ────────────────────────────────────────────────────────────────────

_CACHE_TTL = 7200  # 2h
_cache: dict = {"brief": None, "ts": 0.0}


# ── System prompt for Daily Pulse ────────────────────────────────────────────

_DAILY_PULSE_SYSTEM_PROMPT = """Tu es un analyste financier senior. Tu compiles un brief matinal professionnel pour des traders et investisseurs.

Format de réponse (JSON valide):

{
  "headline": "Titre principal du jour (1 phrase)",
  "market_summary": {
    "crypto": "Résumé crypto en 2-3 phrases",
    "forex": "Résumé forex en 2-3 phrases",
    "commodities": "Résumé matières premières en 2-3 phrases",
    "macro": "Contexte macro économique en 2-3 phrases"
  },
  "what_changed": [
    "Point 1: ce qui a changé overnight",
    "Point 2: ...",
    "Point 3: ..."
  ],
  "why_it_matters": [
    "Pourquoi le point 1 compte pour le trading",
    "Pourquoi le point 2 compte...",
  ],
  "what_to_watch": [
    {"event": "Nom de l'événement", "time": "Heure UTC approximative", "impact": "high/medium/low"},
  ],
  "risk_flags": [
    "Risque 1 à surveiller aujourd'hui",
  ],
  "sentiment": {
    "crypto": "bullish|bearish|neutral",
    "forex": "bullish|bearish|neutral",
    "overall": "risk-on|risk-off|neutral"
  }
}

Règles:
- Sois factuel, cite les sources quand possible.
- 5 minutes de lecture max.
- Pas de conseils d'investissement, juste de l'analyse.
- Réponds UNIQUEMENT avec le JSON, sans texte avant ou après.
- Langue: français.
"""


# ── Data gathering ───────────────────────────────────────────────────────────

async def _gather_market_data() -> dict:
    """Gather market data from multiple sources for the Daily Pulse."""
    data: dict = {"articles": [], "macro": {}, "fear_greed": None, "prices": {}}

    # 1. RSS articles
    try:
        from scrapers.rss_aggregator import get_cached_articles
        data["articles"] = await get_cached_articles()
    except Exception as e:
        logger.warning("daily_pulse_rss_failed", error=str(e))

    # 2. Fear & Greed Index
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get("https://api.alternative.me/fng/?limit=1")
            if r.status_code == 200:
                fng = r.json().get("data", [{}])[0]
                data["fear_greed"] = {
                    "value": int(fng.get("value", 0)),
                    "label": fng.get("value_classification", ""),
                }
    except Exception:
        pass

    # 3. Key prices via yfinance
    try:
        import yfinance as yf
        loop = asyncio.get_running_loop()

        def _fetch_prices():
            prices = {}
            tickers = {
                "BTC": "BTC-USD",
                "ETH": "ETH-USD",
                "DXY": "DX-Y.NYB",
                "GOLD": "GC=F",
                "SP500": "^GSPC",
                "NASDAQ": "^IXIC",
            }
            for name, ticker in tickers.items():
                try:
                    t = yf.Ticker(ticker)
                    hist = t.history(period="2d", interval="1d")
                    if not hist.empty:
                        current = float(hist["Close"].iloc[-1])
                        prev = float(hist["Close"].iloc[-2]) if len(hist) > 1 else current
                        change_pct = ((current - prev) / prev * 100) if prev else 0
                        prices[name] = {
                            "price": round(current, 2),
                            "change_pct": round(change_pct, 2),
                        }
                except Exception:
                    continue
            return prices

        data["prices"] = await loop.run_in_executor(None, _fetch_prices)
    except Exception:
        pass

    # 4. Economic calendar (high-impact events today)
    try:
        from scrapers.forex_calendar_scraper import get_cached_calendar
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        events = await get_cached_calendar()
        today_events = [
            {
                "title": e.get("title", ""),
                "country": e.get("country", ""),
                "impact": e.get("impact", ""),
                "time": e["datetime"].isoformat() if e.get("datetime") else None,
            }
            for e in events
            if e.get("impact") == "High"
            and e.get("datetime")
            and abs((e["datetime"] - now).total_seconds()) < 86400  # ±24h
        ]
        data["calendar"] = today_events
    except Exception:
        data["calendar"] = []

    return data


def _build_prompt(data: dict) -> str:
    """Build the LLM prompt from gathered data."""
    sections = []

    # Articles
    articles = data.get("articles", [])[:30]
    if articles:
        lines = []
        for a in articles:
            line = f"- [{a['source']}] {a['title']}"
            if a.get("summary"):
                line += f" — {a['summary'][:150]}"
            lines.append(line)
        sections.append("ARTICLES RSS RÉCENTS:\n" + "\n".join(lines))

    # Prices
    prices = data.get("prices", {})
    if prices:
        lines = []
        for name, info in prices.items():
            lines.append(f"- {name}: ${info['price']} ({'+' if info['change_pct'] >= 0 else ''}{info['change_pct']}%)")
        sections.append("PRIX CLÉS:\n" + "\n".join(lines))

    # Fear & Greed
    fng = data.get("fear_greed")
    if fng:
        sections.append(f"FEAR & GREED INDEX: {fng['value']} ({fng['label']})")

    # Calendar
    cal = data.get("calendar", [])
    if cal:
        lines = [f"- {e['title']} ({e['country']}) — {e.get('time', 'N/A')}" for e in cal]
        sections.append("ÉVÉNEMENTS ÉCONOMIQUES HIGH IMPACT (24h):\n" + "\n".join(lines))

    return _DAILY_PULSE_SYSTEM_PROMPT + "\n\nDONNÉES DU JOUR:\n\n" + "\n\n".join(sections)


# ── Endpoint ─────────────────────────────────────────────────────────────────

class DailyPulseResponse(BaseModel):
    brief: dict
    raw_data: dict
    provider: str
    model: str
    generated_at: str


@router.get("/ai/daily-pulse")
async def get_daily_pulse(refresh: bool = False):
    """
    Get the Daily Pulse — a compiled morning brief.
    Cached for 2h, use ?refresh=true to force refresh.
    """
    now = time.monotonic()
    if not refresh and _cache["brief"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["brief"]

    # Gather data
    data = await _gather_market_data()

    # Build prompt and call LLM
    from routers.llm import _call_llm_with_fallback
    prompt = _build_prompt(data)

    raw, provider, model = await _call_llm_with_fallback(prompt, max_tokens=1200)

    # Parse JSON response
    import re
    raw_clean = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
    raw_clean = re.sub(r'\s*```$', '', raw_clean.strip())

    try:
        brief = json.loads(raw_clean)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', raw)
        if match:
            try:
                brief = json.loads(match.group())
            except json.JSONDecodeError:
                brief = {
                    "headline": "Daily Pulse — Erreur de compilation",
                    "raw": raw,
                    "error": "LLM did not return valid JSON",
                }
        else:
            brief = {
                "headline": "Daily Pulse — Erreur de compilation",
                "raw": raw,
                "error": "LLM did not return valid JSON",
            }

    result = {
        "brief": brief,
        "raw_data": {
            "articles_count": len(data.get("articles", [])),
            "prices": data.get("prices", {}),
            "fear_greed": data.get("fear_greed"),
            "calendar_events": len(data.get("calendar", [])),
        },
        "provider": provider,
        "model": model,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    _cache["brief"] = result
    _cache["ts"] = now

    return result
