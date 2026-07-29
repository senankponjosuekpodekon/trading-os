"""
BRVM Router — Bourse Régionale des Valeurs Mobilières (UEMOA)
Scrape les données de marché depuis brvm.org + calcul indicateurs techniques
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import asyncio
from datetime import datetime

from scrapers.brvm_scraper import (
    TOP_SYMBOLS,
    fetch_brvm_quotes,
    _mock_brvm_quotes,
    is_brvm_symbol,
)
from scrapers.brvm_fundamentals import fetch_fundamental_scores, fetch_fundamental_metrics

router = APIRouter()

# Re-export pour compatibilité tests existants
fetch_brvm_quotes = fetch_brvm_quotes
_mock_brvm_quotes = _mock_brvm_quotes
is_brvm_symbol = is_brvm_symbol


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


def _analyze_brvm_signal(
    quotes: List[dict],
    fundamental_scores: Optional[dict] = None,
    fundamental_metrics: Optional[dict] = None,
) -> List[dict]:
    """Analyse : momentum + volume + score fondamental optionnel + métriques P/E/dividende."""
    fundamental_scores = fundamental_scores or {}
    fundamental_metrics = fundamental_metrics or {}
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

        # Métriques fondamentales P/E, dividende, ROE, croissance
        metrics = fundamental_metrics.get(q["symbol"])
        if metrics:
            pe = metrics.pe_ratio
            div = metrics.dividend_yield
            growth = metrics.revenue_growth
            roe = metrics.roe
            if pe is not None and pe < 10:
                score += 18
                reasons.append(f"P/E bas ({pe:.1f})")
            elif pe is not None and pe < 15:
                score += 8
                reasons.append(f"P/E modéré ({pe:.1f})")
            if div is not None and div >= 4.0:
                score += 12
                reasons.append(f"Dividende attractif ({div:.1f}%)")
            if growth is not None and growth > 5:
                score += 10
                reasons.append(f"Croissance CA ({growth:.1f}%)")
            if roe is not None and roe > 15:
                score += 8
                reasons.append(f"ROE élevé ({roe:.1f}%)")

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

    # Enrichissement fondamental : fraîcheur des rapports émetteurs + métriques fondamentales
    symbols = [q["symbol"] for q in quotes]
    try:
        f_scores = await asyncio.wait_for(fetch_fundamental_scores(symbols), timeout=12.0)
        fundamental_scores = {s.symbol: s.score for s in f_scores}
    except Exception:
        fundamental_scores = {}

    try:
        metrics_list = await asyncio.wait_for(fetch_fundamental_metrics(symbols), timeout=12.0)
        fundamental_metrics = {m.symbol: m for m in metrics_list}
    except Exception:
        fundamental_metrics = {}

    signals = _analyze_brvm_signal(quotes, fundamental_scores, fundamental_metrics)
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
