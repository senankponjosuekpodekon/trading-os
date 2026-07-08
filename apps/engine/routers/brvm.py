"""
BRVM Router — Bourse Régionale des Valeurs Mobilières (UEMOA)
Scrape les données de marché depuis brvm.org + calcul indicateurs techniques
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import httpx
import asyncio
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

router = APIRouter()

BRVM_BASE    = "https://www.brvm.org"
BRVM_ACTIONS = f"{BRVM_BASE}/fr/cours-actions/0"
BRVM_HISTORY = f"{BRVM_BASE}/fr/cours-history"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

# Symboles BRVM les plus liquides
TOP_SYMBOLS = [
    "ONTBF", "SGBF", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSIC",
    "ORGT", "BICC", "CBIBF", "ABJC", "STAC",
]


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


async def fetch_brvm_quotes() -> List[dict]:
    """Scrape la page des cours actions de la BRVM."""
    try:
        async with httpx.AsyncClient(timeout=8, headers=HEADERS, follow_redirects=True) as client:
            r = await client.get(BRVM_ACTIONS)
            r.raise_for_status()
    except Exception as e:
        return []

    soup = BeautifulSoup(r.text, "lxml")
    quotes = []

    # Table des cours sur brvm.org
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


def _analyze_brvm_signal(quotes: List[dict]) -> List[dict]:
    """Analyse basique : momentum + variation pour signaux BRVM."""
    results = []
    for q in quotes:
        chg = q["change_pct"]
        vol = q["volume"]

        score = 0
        reasons = []

        if chg > 3:
            score += 30
            reasons.append(f"Forte hausse +{chg}%")
        elif chg > 1:
            score += 15
            reasons.append(f"Hausse +{chg}%")
        elif chg < -3:
            score -= 30
            reasons.append(f"Forte baisse {chg}%")
        elif chg < -1:
            score -= 15
            reasons.append(f"Baisse {chg}%")

        if vol > 10000:
            score += 10 if score > 0 else -10
            reasons.append(f"Volume élevé ({vol:,})")

        if score >= 25:
            signal = "BUY"
        elif score <= -25:
            signal = "SELL"
        else:
            signal = "WATCH"

        results.append({
            **q,
            "signal":     signal,
            "score":      score,
            "confidence": min(abs(score), 90),
            "reasons":    " | ".join(reasons) or "Neutre",
        })

    return sorted(results, key=lambda x: abs(x["score"]), reverse=True)


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
    """Scan BRVM avec signaux momentum."""
    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()
        source = "mock"
    else:
        source = "live"

    if req.symbols:
        quotes = [q for q in quotes if q["symbol"] in req.symbols]

    signals = _analyze_brvm_signal(quotes)
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
