"""
Daily Pulse — Brief matinal automatisé compilé via LLM.
Compile news RSS + market data + economic calendar en un brief structuré.
Endpoint: GET /ai/daily-pulse
"""
from fastapi import APIRouter
from pydantic import BaseModel
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
        from datetime import datetime, timezone
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

def _try_loads(candidate: str):
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _parse_llm_json(raw: str) -> dict:
    """Parse le JSON du brief LLM. Répare les sorties tronquées en
    supprimant la queue incomplète puis en fermant les accolades/chaînes
    ouvertes. Retourne un brief de fallback si tout échoue."""
    import re

    cleaned = re.sub(r'^```(?:json)?\s*', '', raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r'\s*```$', '', cleaned.strip())

    for candidate in (cleaned, raw.strip()):
        parsed = _try_loads(candidate)
        if isinstance(parsed, dict):
            return parsed
        match = re.search(r'\{[\s\S]*\}', candidate)
        if match:
            parsed = _try_loads(match.group())
            if isinstance(parsed, dict):
                return parsed

    # Réparation : garder jusqu'à la dernière structure complète puis fermer
    text = match.group() if match else cleaned
    repaired = _close_truncated_json(text)
    parsed = _try_loads(repaired) if repaired else None
    if isinstance(parsed, dict):
        return parsed

    # Dernier recours : extraire au moins le headline
    hm = re.search(r'"headline"\s*:\s*"([^"]+)"', text)
    brief = {
        "headline": hm.group(1) if hm else "Daily Pulse — Erreur de compilation",
        "raw": raw,
    }
    if not hm:
        brief["error"] = "LLM did not return valid JSON"
    return brief


def _scan_json_state(text: str):
    """Retourne (in_str, stack, commas) — commas = positions des virgules
    hors-string, stack = caractères ouvrants `{`/`[` non fermés."""
    in_str = esc = False
    stack: list[str] = []
    commas: list[int] = []
    for i, ch in enumerate(text):
        if esc:
            esc = False
            continue
        if in_str:
            if ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in '{[':
            stack.append(ch)
        elif ch in '}]':
            if stack:
                stack.pop()
        elif ch == ',':
            commas.append(i)
    return in_str, stack, commas


def _close_truncated_json(text: str) -> str | None:
    """Referme un JSON tronqué en coupant progressivement jusqu'à la
    dernière virgule hors-string puis en ajoutant les `}`/`]`/`"` manquants.
    Retourne le premier candidat qui parse, sinon None."""
    if not text.startswith('{'):
        return None

    cut = text
    while True:
        in_str, stack, commas = _scan_json_state(cut)
        if not stack:
            break  # déjà équilibré (parse géré en amont)

        candidate = cut + ('"' if in_str else '')
        candidate += ''.join('}' if c == '{' else ']' for c in reversed(stack))
        if _try_loads(candidate) is not None:
            return candidate

        # Coupe après la dernière virgule complète (on jette le token coupé)
        if not commas:
            return None
        cut = cut[: commas[-1]].rstrip(' \n\t,:')
        if not cut or cut.lstrip('{[') == '':
            return None
    return None


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

    raw, provider, model = await _call_llm_with_fallback(prompt, max_tokens=3000)

    # Parse JSON response — le LLM peut retourner du JSON tronqué (max_tokens
    # atteint) ou entouré de fences markdown. On tente le brut, puis la
    # réparation du JSON coupé (fermeture des accolades ouvertes).
    brief = _parse_llm_json(raw)

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
