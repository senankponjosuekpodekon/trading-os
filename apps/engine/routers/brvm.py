"""
BRVM Router — Bourse Régionale des Valeurs Mobilières (UEMOA)
Scrape les données de marché depuis brvm.org + calcul indicateurs techniques
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import httpx
import asyncio
from datetime import datetime
from bs4 import BeautifulSoup

router = APIRouter()

BRVM_BASE    = "https://www.brvm.org"
BRVM_ACTIONS = f"{BRVM_BASE}/fr/cours-actions/0"
BRVM_HISTORY = f"{BRVM_BASE}/fr/cours-history"

WESTBOURSE_BASE     = "https://www.westbourse.com"
WESTBOURSE_ACTIONS  = f"{WESTBOURSE_BASE}/api/public/v1/actions"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

# Symboles BRVM les plus liquides
BRVM_SYMBOLS = [
    "ONTBF", "SGBF", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSIC",
    "ORGT", "BICC", "CBIBF", "ABJC", "STAC",
]

# Alias legacy
TOP_SYMBOLS = BRVM_SYMBOLS


class BrvmQuote(BaseModel):
    symbol:   str
    name:     str
    price:    float
    change:   float
    change_pct: float
    volume:   int
    market:   str = "BRVM"
    currency: str = "XOF"


class BrvmScanRequest(BaseModel):
    symbols:   Optional[List[str]] = None
    timeframe: str = "1d"


async def _fetch_westbourse_quotes() -> List[dict]:
    """Récupère les cours via l'API publique Westbourse."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.get(WESTBOURSE_ACTIONS)
            r.raise_for_status()
            payload = r.json()
    except Exception:
        return []

    actions = payload.get("actions") or []
    quotes = []
    for a in actions:
        try:
            symbol = a.get("code", "")
            name   = a.get("nom", "")
            price  = float(a.get("cours", 0) or 0)
            chg_pct = float(a.get("variation_pct", 0) or 0)
            volume = int(a.get("volume", 0) or 0)
            if not symbol or price <= 0:
                continue
            quotes.append({
                "symbol":     symbol,
                "name":       name,
                "price":      price,
                "change":     round(price * chg_pct / 100, 2),
                "change_pct": chg_pct,
                "volume":     volume,
                "market":     "BRVM",
                "currency":   "XOF",
            })
        except (ValueError, TypeError):
            continue
    return quotes


async def _fetch_scraped_brvm_quotes() -> List[dict]:
    """Scrape la page des cours actions de la BRVM (fallback)."""
    try:
        async with httpx.AsyncClient(timeout=8, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(BRVM_ACTIONS)
            r.raise_for_status()
    except Exception:
        return []

    soup = BeautifulSoup(r.text, "lxml")
    quotes = []

    table = soup.find("table", {"id": "table-sm"}) or soup.find("table", class_=lambda c: c and "cours" in c.lower())
    if not table:
        tables = soup.find_all("table")
        table = tables[0] if tables else None

    if not table:
        return []

    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 5:
            continue
        try:
            symbol  = cols[0].get_text(strip=True)
            name    = cols[1].get_text(strip=True) if len(cols) > 1 else symbol
            price   = float(cols[2].get_text(strip=True).replace(" ", "").replace(",", ".") or 0)
            change  = float(cols[3].get_text(strip=True).replace(" ", "").replace(",", ".").replace("%", "") or 0)
            volume  = int(cols[4].get_text(strip=True).replace(" ", "") or 0)
            quotes.append({
                "symbol":     symbol,
                "name":       name,
                "price":      price,
                "change":     change * price / 100 if abs(change) < 100 else change,
                "change_pct": change if abs(change) < 100 else round(change / price * 100, 2),
                "volume":     volume,
                "market":     "BRVM",
                "currency":   "XOF",
            })
        except (ValueError, IndexError):
            continue

    return quotes


async def fetch_brvm_quotes() -> List[dict]:
    """Cours BRVM : Westbourse en priorité, scraping en fallback."""
    quotes = await _fetch_westbourse_quotes()
    if quotes:
        return quotes
    return await _fetch_scraped_brvm_quotes()


def _mock_brvm_quotes() -> List[dict]:
    """Données de démo si le scraping échoue (marché fermé / indispo)."""
    import random
    random.seed(42)
    mock = []
    prices = {
        "ONTBF": 2150, "SGBF": 8500, "BOABF": 6200, "ETIT": 24, "SIVC": 755,
        "PALC": 7200, "SOGC": 1050, "SNTS": 4800, "CIEC": 680, "NSIC": 3200,
        "ORGT": 9100, "BICC": 530, "CBIBF": 3700, "ABJC": 1850, "STAC": 11500,
    }
    names = {
        "ONTBF": "ONATEL Burkina Faso", "SGBF": "Société Générale BF",
        "BOABF": "Bank of Africa BF", "ETIT": "Ecobank Transnational",
        "SIVC": "SICOGI", "PALC": "Palm CI", "SOGC": "SOGB",
        "SNTS": "Sonatel", "CIEC": "CIE", "NSIC": "NSIA Banque CI",
        "ORGT": "Orange CI", "BICC": "BICI CI", "CBIBF": "Coris Bank",
        "ABJC": "Abidjan.net", "STAC": "SOLIBRA",
    }
    for sym in TOP_SYMBOLS:
        p = prices.get(sym, 1000)
        chg_pct = round(random.uniform(-3.5, 4.5), 2)
        mock.append({
            "symbol":     sym,
            "name":       names.get(sym, sym),
            "price":      p,
            "change":     round(p * chg_pct / 100, 0),
            "change_pct": chg_pct,
            "volume":     random.randint(100, 50000),
            "market":     "BRVM",
            "currency":   "XOF",
        })
    return mock


def _analyze_brvm_signal(quotes: List[dict], fundamental_scores: Optional[dict] = None) -> List[dict]:
    """Analyse : momentum + volume + score fondamental optionnel."""
    fundamental_scores = fundamental_scores or {}
    results = []
    for q in quotes:
        chg = q["change_pct"]
        vol = q["volume"]

        score = 0
        reasons = []

        if chg > 5:
            score += 40
            reasons.append(f"Forte hausse +{chg}%")
        elif chg > 3:
            score += 25
            reasons.append(f"Hausse +{chg}%")
        elif chg > 1:
            score += 10
            reasons.append(f"Relief hausse +{chg}%")
        elif chg < -5:
            score -= 40
            reasons.append(f"Forte baisse {chg}%")
        elif chg < -3:
            score -= 25
            reasons.append(f"Baisse {chg}%")
        elif chg < -1:
            score -= 10
            reasons.append(f"Relief baisse {chg}%")

        if vol > 10000:
            score += 20 if score > 0 else -20
            reasons.append(f"Volume élevé ({vol:,})")

        f_score = fundamental_scores.get(q["symbol"], 0)
        if f_score >= 20:
            score += 15
            reasons.append("Rapport récent < 7 jours")
        elif f_score >= 10:
            score += 8
            reasons.append("Rapport récent < 30 jours")
        elif f_score >= 5:
            score += 4
            reasons.append("Rapport récent < 90 jours")

        if score >= 25:
            signal = "BUY"
        elif score <= -25:
            signal = "SELL"
        else:
            signal = "WATCH"

        # Normalisation : score max BRVM ≈ 75 (momentum 40 + volume 20 + fondamental 15)
        # sans SMC ni Price Action (disponibles uniquement sur crypto/forex).
        # On ramène sur 95 pour une confidence comparable aux autres marchés.
        BRVM_SCORE_MAX = 75
        confidence_normalized = min(95, round(abs(score) / BRVM_SCORE_MAX * 95))

        results.append({
            **q,
            "signal":     signal,
            "score":      score,
            "confidence": confidence_normalized,
            "reasons":    " | ".join(reasons) or "Neutre",
        })

    return sorted(results, key=lambda x: abs(x["score"]), reverse=True)


async def analyze_brvm_symbols(symbols: Optional[List[str]] = None) -> List[dict]:
    """Analyse les cours BRVM et retourne des résultats au format standard du scan."""
    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()

    if symbols:
        quotes = [q for q in quotes if q["symbol"] in symbols]

    analyzed = _analyze_brvm_signal(quotes)
    results = []
    for q in analyzed:
        price = q["price"]
        signal = q["signal"]
        # SL / TP classiques BRVM : 3% de risque, 5% premier objectif
        sl = round(price * (0.97 if signal == "BUY" else 1.03), 2)
        tp1 = round(price * (1.05 if signal == "BUY" else 0.95), 2)
        tp2 = round(price * (1.10 if signal == "BUY" else 0.90), 2)
        rr = round(abs(tp1 - price) / abs(price - sl), 2) if signal in ("BUY", "SELL") and price != sl else None

        results.append({
            "symbol":        q["symbol"],
            "timeframe":     "1d",
            "signal":        signal,
            "confidence":    q["confidence"],
            "entry_price":   round(price, 2),
            "stop_loss":     sl,
            "take_profit_1": tp1,
            "take_profit_2": tp2,
            "risk_reward":   rr,
            "explanation":   q["reasons"] or "Neutre",
            "indicators":    {
                "close": price, "change_pct": q["change_pct"], "volume": q["volume"],
            },
            "price_action":  {},
            "sr_zones":      {},
            "patterns":      {},
            "regime":        {},
            "smc":           {},
            "source":        "brvm",
            "market":        "BRVM",
            "currency":      "XOF",
        })
    return results


def is_brvm_symbol(symbol: str) -> bool:
    return symbol in BRVM_SYMBOLS


@router.get("/brvm/quotes")
async def get_brvm_quotes():
    """Cours temps réel BRVM."""
    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()
        return {"quotes": quotes, "count": len(quotes), "source": "mock", "timestamp": datetime.utcnow().isoformat()}
    return {"quotes": quotes, "count": len(quotes), "source": "live", "timestamp": datetime.utcnow().isoformat()}


@router.post("/brvm/scan")
async def scan_brvm(req: BrvmScanRequest):
    """Scan BRVM : momentum + volume + données fondamentales."""
    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()
        source = "mock"
    else:
        source = "live"

    if req.symbols:
        quotes = [q for q in quotes if q["symbol"] in req.symbols]

    # Enrichissement fondamental : fraîcheur des rapports émetteurs
    from routers.brvm_reports import fetch_fundamental_scores
    symbols = [q["symbol"] for q in quotes]
    try:
        f_scores = await asyncio.wait_for(fetch_fundamental_scores(symbols), timeout=12.0)
        fundamental_scores = {s.symbol: s.score for s in f_scores}
    except Exception:
        fundamental_scores = {}

    signals = _analyze_brvm_signal(quotes, fundamental_scores)
    buys  = [s for s in signals if s["signal"] == "BUY"]
    sells = [s for s in signals if s["signal"] == "SELL"]

    return {
        "results":   signals,
        "total":     len(signals),
        "buys":      len(buys),
        "sells":     len(sells),
        "source":    source,
        "market":    "BRVM",
        "currency":  "XOF",
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/brvm/top-movers")
async def get_top_movers():
    """Top hausses et baisses du jour."""
    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()
        source = "mock"
    else:
        source = "live"

    sorted_q = sorted(quotes, key=lambda x: x["change_pct"], reverse=True)
    return {
        "top_gainers": sorted_q[:5],
        "top_losers":  sorted_q[-5:],
        "source":      source,
        "timestamp":   datetime.utcnow().isoformat(),
    }


@router.get("/brvm/health")
def brvm_health():
    return {"status": "ok", "market": "BRVM", "symbols_tracked": len(TOP_SYMBOLS)}
