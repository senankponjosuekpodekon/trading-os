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
    fetch_brvm_history,
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
    """Analyse les cours BRVM via evaluate_strategy avec les règles 'BRVM Value Swing'."""
    from routers.strategy_eval import parse_rules, evaluate_strategy

    quotes = await fetch_brvm_quotes()
    if not quotes:
        quotes = _mock_brvm_quotes()

    if symbols:
        quotes = [q for q in quotes if q["symbol"] in symbols]

    # BRVM Value Swing rules (mirrors seed.ts)
    brvm_rules = parse_rules(dict(
        ema_fast=20, ema_slow=50, ema_trend=100, rsi_period=14,
        rsi_oversold=30, rsi_overbought=70, rsi_bullish_zone=45, rsi_bearish_zone=55,
        min_confidence=55, min_dps=50, volume_spike_min=1.1,
        use_price_action=False, use_sr_zones=False, use_patterns=False, atr_min_pct=0.1,
        timeframes=["1d"], trigger="BREAKOUT",
        profiles=["INVESTOR", "SWING"], markets=["STOCKS"],
        filters={"regime": ["TRENDING_BULL", "TRENDING_BEAR", "RANGING"]},
        exit_rules={"sl_atr": 2.0, "tp1_atr": 2.5, "tp2_atr": 4.0},
    ))
    brvm_rules.analysis_timeframe = "1d"
    brvm_rules.entry_timeframe = "1d"

    # Fetch fundamental data for bonus scoring
    try:
        fundamental_scores = await fetch_fundamental_scores()
    except Exception:
        fundamental_scores = {}
    try:
        fundamental_metrics = await fetch_fundamental_metrics()
    except Exception:
        fundamental_metrics = {}

    # Use the existing BRVM-specific analysis for momentum + fundamental scoring
    analyzed = _analyze_brvm_signal(quotes, fundamental_scores, fundamental_metrics)

    results = []
    for q in analyzed:
        price = q["price"]
        chg = q["change_pct"]

        # Fetch historical OHLCV for real indicator computation
        history = await fetch_brvm_history(q["symbol"], "2y")
        if history and len(history) >= 20:
            import pandas as pd
            hdf = pd.DataFrame(history)
            close = hdf["close"].astype(float)
            high = hdf["high"].astype(float)
            low = hdf["low"].astype(float)
            vol = hdf["volume"].astype(float)

            ema20 = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
            ema50 = float(close.ewm(span=50, adjust=False).mean().iloc[-1])
            ema200 = float(close.ewm(span=200, adjust=False).mean().iloc[-1]) if len(close) >= 200 else ema50

            # RSI (Wilder's)
            delta = close.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, 1e-10)
            rsi_val = float((100 - (100 / (1 + rs))).iloc[-1])

            # ATR (14)
            tr = pd.concat([
                high - low,
                (high - close.shift(1)).abs(),
                (low - close.shift(1)).abs(),
            ], axis=1).max(axis=1)
            atr_val = float(tr.rolling(14).mean().iloc[-1])

            # MACD histogram
            ema12 = close.ewm(span=12, adjust=False).mean()
            ema26 = close.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            macd_signal = macd_line.ewm(span=9, adjust=False).mean()
            macd_hist_val = float((macd_line - macd_signal).iloc[-1])

            # Bollinger Bandwidth
            bb_std = close.rolling(20).std()
            bb_bw_val = float((2 * bb_std / close.rolling(20).mean()).iloc[-1]) if len(close) >= 20 else 0.03

            # Volume ratio (today vs 20-day avg)
            vol_avg = vol.rolling(20).mean().iloc[-1] if len(vol) >= 20 else vol.mean()
            vol_ratio = float(vol.iloc[-1] / vol_avg) if vol_avg > 0 else 1.0

            indicators = {
                "close": price,
                "ema20": round(ema20, 2),
                "ema50": round(ema50, 2),
                "ema200": round(ema200, 2),
                "rsi": round(rsi_val, 2),
                "atr": round(atr_val, 2),
                "volume_ratio": round(vol_ratio, 2),
                "macd_hist": round(macd_hist_val, 4),
                "bb_bw": round(bb_bw_val, 4),
            }
            # Real price action from data
            short_ema = ema20
            long_ema = ema50
            if short_ema > long_ema and price > ema200:
                pa_trend = "BULLISH"
            elif short_ema < long_ema and price < ema200:
                pa_trend = "BEARISH"
            else:
                pa_trend = "NEUTRAL"
            pa = {"trend": pa_trend, "bos": False, "bos_dir": None, "choch": False, "structure": "unknown"}
            # Real regime from ADX-like proxy
            if atr_val > 0:
                atr_pct = atr_val / price * 100
                if atr_pct > 2.0 and abs(ema20 - ema50) / price * 100 > 1.0:
                    regime_name = "TRENDING_BULL" if ema20 > ema50 else "TRENDING_BEAR"
                else:
                    regime_name = "RANGING"
            else:
                regime_name = "RANGING"
            regime = {"regime": regime_name, "adx": 25 if "TRENDING" in regime_name else 15, "trend_strength": "MODERATE" if "TRENDING" in regime_name else "WEAK"}
        else:
            # Fallback: no history available, use approximate indicators
            rsi_est = 50 + max(-20, min(20, chg * 4))
            atr_est = price * max(abs(chg), 0.5) / 100
            indicators = {
                "close": price,
                "ema20": price,
                "ema50": price,
                "ema200": price,
                "rsi": rsi_est,
                "atr": atr_est,
                "volume_ratio": 1.0 + (1.0 if q["volume"] > 10000 else 0.0),
                "macd_hist": chg,
                "bb_bw": 0.03,
            }
            pa = {"trend": "BULLISH" if chg > 0 else ("BEARISH" if chg < 0 else "NEUTRAL"), "bos": False, "bos_dir": None, "choch": False, "structure": "unknown"}
            regime = {"regime": "TRENDING_BULL" if chg > 1 else ("TRENDING_BEAR" if chg < -1 else "RANGING"), "adx": 20, "trend_strength": "WEAK"}

        sr = {}
        patterns = {}
        smc = {}

        ev = evaluate_strategy(
            brvm_rules, indicators, pa, sr, patterns, smc=smc, regime=regime,
            timeframe="1d", market="STOCKS",
        )

        # If evaluate_strategy returned NEUTRAL but the BRVM-specific analysis found a signal,
        # use the BRVM signal with the evaluate_strategy SL/TP framework
        signal = ev["signal"]
        confidence = ev["confidence"]
        reasons = ev["reasons"]

        if signal == "NEUTRAL" and q["signal"] in ("BUY", "SELL"):
            # BRVM momentum/fundamental signal was strong but evaluate_strategy filtered it
            # Use the BRVM signal but keep evaluate_strategy's SL/TP and predictive metrics
            signal = q["signal"]
            confidence = q["confidence"]
            reasons = (q["reasons"] or "").split(" | ") if isinstance(q["reasons"], str) else q["reasons"]
            reasons.append("BRVM momentum + fundamental signal")

        # Compute SL/TP from evaluate_strategy's ATR-based framework
        sl = ev["stop_loss"]
        tp1 = ev["take_profit_1"]
        tp2 = ev["take_profit_2"]
        rr = ev["risk_reward"]

        # Fallback SL/TP if evaluate_strategy didn't produce them
        if sl is None and signal in ("BUY", "SELL"):
            sl = round(price * (0.97 if signal == "BUY" else 1.03), 2)
            tp1 = round(price * (1.05 if signal == "BUY" else 0.95), 2)
            tp2 = round(price * (1.10 if signal == "BUY" else 0.90), 2)
            from utils.risk_reward import compute_rr
            rr = compute_rr(price, sl, tp1) if price != sl else None

        results.append({
            "symbol":        q["symbol"],
            "timeframe":     "1d",
            "signal":        signal,
            "confidence":    confidence,
            "entry_price":   round(price, 2),
            "stop_loss":     sl,
            "take_profit_1": tp1,
            "take_profit_2": tp2,
            "risk_reward":   rr,
            "explanation":   " | ".join(reasons) if isinstance(reasons, list) else str(reasons),
            "indicators":    indicators,
            "price_action":  pa,
            "sr_zones":      {},
            "patterns":      {},
            "regime":        regime,
            "smc":           {},
            "dps":           ev.get("dps", 0.0),
            "tps":           ev.get("tps", 0.0),
            "success_probability": ev.get("success_probability", 0.0),
            "expected_move": ev.get("expected_move", {"value": None, "pct": None}),
            "profile_suitability": ev.get("profile_suitability", []),
            "trigger":       "BREAKOUT",
            "signal_pending": False,
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
