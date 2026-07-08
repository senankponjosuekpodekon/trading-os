"""
Deriv Router — Connecteur Deriv API (WebSocket) + stratégie V75 Scalp
Actif : Volatility 75 Index (V75 / R_75)
API Deriv : wss://ws.binaryws.com/websockets/v3
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import json
import os
import time
import websockets
import pandas as pd
import numpy as np
from datetime import datetime

router = APIRouter()

DERIV_WS_URL  = "wss://ws.binaryws.com/websockets/v3?app_id=1089"
DERIV_TOKEN   = os.getenv("DERIV_API_TOKEN", "")
V75_SYMBOL    = "R_75"   # Volatility 75 Index
V75_GRANULARITY = 60     # 1 minute en secondes

# ── Catalogue des symboles Deriv synthétiques ─────────────────
DERIV_SYMBOLS = {
    # Volatility Indices
    "R_10":   {"label": "Volatility 10 Index",    "category": "volatility",  "base_price": 10000.0,  "volatility": 200},
    "R_25":   {"label": "Volatility 25 Index",    "category": "volatility",  "base_price": 50000.0,  "volatility": 600},
    "R_50":   {"label": "Volatility 50 Index",    "category": "volatility",  "base_price": 200000.0, "volatility": 2000},
    "R_75":   {"label": "Volatility 75 Index",    "category": "volatility",  "base_price": 800000.0, "volatility": 5000},
    "R_100":  {"label": "Volatility 100 Index",   "category": "volatility",  "base_price": 1000000.0,"volatility": 8000},
    # Boom & Crash
    "BOOM300":  {"label": "Boom 300 Index",    "category": "boom_crash", "base_price": 8000.0,   "volatility": 50},
    "BOOM500":  {"label": "Boom 500 Index",    "category": "boom_crash", "base_price": 8000.0,   "volatility": 80},
    "BOOM1000": {"label": "Boom 1000 Index",   "category": "boom_crash", "base_price": 8000.0,   "volatility": 120},
    "CRASH300": {"label": "Crash 300 Index",   "category": "boom_crash", "base_price": 8000.0,   "volatility": 50},
    "CRASH500": {"label": "Crash 500 Index",   "category": "boom_crash", "base_price": 8000.0,   "volatility": 80},
    "CRASH1000":{"label": "Crash 1000 Index",  "category": "boom_crash", "base_price": 8000.0,   "volatility": 120},
    # Jump Indices
    "JD10":  {"label": "Jump 10 Index",  "category": "jump", "base_price": 100.0, "volatility": 2},
    "JD25":  {"label": "Jump 25 Index",  "category": "jump", "base_price": 100.0, "volatility": 3},
    "JD50":  {"label": "Jump 50 Index",  "category": "jump", "base_price": 100.0, "volatility": 5},
    "JD75":  {"label": "Jump 75 Index",  "category": "jump", "base_price": 100.0, "volatility": 7},
    "JD100": {"label": "Jump 100 Index", "category": "jump", "base_price": 100.0, "volatility": 10},
    # Step Index
    "STPRNG": {"label": "Step Index", "category": "step", "base_price": 100.0, "volatility": 1},
}


# ── Modèles ──────────────────────────────────────────────────
class DerivScalpRequest(BaseModel):
    symbol:      str = V75_SYMBOL
    bars:        int = 100
    stake:       float = 1.0
    duration:    int = 5         # minutes
    contract_type: str = "CALL"  # CALL | PUT


class DerivTickRequest(BaseModel):
    symbol: str = V75_SYMBOL
    count:  int = 50


# ── Helpers indicateurs ───────────────────────────────────────
def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def _bollinger(series: pd.Series, period: int = 20, std: float = 2.0):
    mid   = series.rolling(period).mean()
    sigma = series.rolling(period).std()
    return mid + std * sigma, mid, mid - std * sigma


# ── Stratégie V75 Scalp ───────────────────────────────────────
def _v75_scalp_strategy(candles: list) -> dict:
    """
    Stratégie scalp V75 sur 1 minute :
    - EMA 8 / EMA 21 crossover
    - RSI 14 : zone 40-60 = neutre, <30 oversold, >70 overbought
    - Bollinger Bands 20,2 : rebond sur bandes
    - Score → CALL / PUT / WAIT
    """
    if len(candles) < 30:
        return {"signal": "WAIT", "confidence": 0, "reason": "Données insuffisantes"}

    df = pd.DataFrame(candles, columns=["time", "open", "high", "low", "close"])
    close = df["close"].astype(float)

    ema8  = _ema(close, 8)
    ema21 = _ema(close, 21)
    rsi   = _rsi(close, 14)
    bb_up, bb_mid, bb_lo = _bollinger(close, 20)

    last  = close.iloc[-1]
    prev  = close.iloc[-2]
    e8    = ema8.iloc[-1];   e8_prev  = ema8.iloc[-2]
    e21   = ema21.iloc[-1];  e21_prev = ema21.iloc[-2]
    rsi_v = rsi.iloc[-1]
    bbu   = bb_up.iloc[-1];  bbl = bb_lo.iloc[-1]; bbm = bb_mid.iloc[-1]

    score   = 0
    reasons = []

    # EMA crossover
    if e8 > e21 and e8_prev <= e21_prev:
        score += 35
        reasons.append("EMA8 croise EMA21 à la hausse (golden cross)")
    elif e8 < e21 and e8_prev >= e21_prev:
        score -= 35
        reasons.append("EMA8 croise EMA21 à la baisse (death cross)")
    elif e8 > e21:
        score += 15
        reasons.append("EMA8 > EMA21 (tendance haussière)")
    elif e8 < e21:
        score -= 15
        reasons.append("EMA8 < EMA21 (tendance baissière)")

    # RSI
    if rsi_v < 30:
        score += 25
        reasons.append(f"RSI survendu ({rsi_v:.1f})")
    elif rsi_v > 70:
        score -= 25
        reasons.append(f"RSI suracheté ({rsi_v:.1f})")
    elif 45 < rsi_v < 55:
        reasons.append(f"RSI neutre ({rsi_v:.1f})")

    # Bollinger
    if last <= bbl:
        score += 20
        reasons.append(f"Prix sur BB Lower (rebond potentiel)")
    elif last >= bbu:
        score -= 20
        reasons.append(f"Prix sur BB Upper (rejet potentiel)")

    # Momentum (dernière bougie)
    if last > prev:
        score += 5
    elif last < prev:
        score -= 5

    # Signal final
    confidence = min(abs(score), 95)
    if score >= 40:
        signal = "CALL"
    elif score <= -40:
        signal = "PUT"
    else:
        signal = "WAIT"

    return {
        "signal":     signal,
        "confidence": confidence,
        "score":      score,
        "indicators": {
            "close":   round(last, 4),
            "ema8":    round(e8, 4),
            "ema21":   round(e21, 4),
            "rsi":     round(rsi_v, 2),
            "bb_upper": round(bbu, 4),
            "bb_mid":   round(bbm, 4),
            "bb_lower": round(bbl, 4),
        },
        "reasons": " | ".join(reasons) or "Aucune condition forte",
    }


# ── Fonctions API Deriv ──────────────────────────────────────
async def _deriv_request(payload: dict, timeout: float = 10.0) -> dict:
    """Envoie une requête à l'API Deriv et retourne la réponse."""
    try:
        async with websockets.connect(DERIV_WS_URL, ping_interval=None) as ws:
            await ws.send(json.dumps(payload))
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            return json.loads(raw)
    except asyncio.TimeoutError:
        return {"error": {"message": "Timeout API Deriv"}}
    except Exception as e:
        return {"error": {"message": str(e)}}


async def _fetch_v75_candles(symbol: str = V75_SYMBOL, count: int = 100) -> list:
    """Récupère les bougies 1min du V75 depuis l'API Deriv."""
    payload = {
        "ticks_history": symbol,
        "adjust_start_time": 1,
        "count": count,
        "end": "latest",
        "granularity": V75_GRANULARITY,
        "style": "candles",
    }
    resp = await _deriv_request(payload)
    if "error" in resp:
        return []

    candles_raw = resp.get("candles", [])
    candles = []
    for c in candles_raw:
        candles.append([
            c.get("epoch", 0),
            float(c.get("open", 0)),
            float(c.get("high", 0)),
            float(c.get("low", 0)),
            float(c.get("close", 0)),
        ])
    return candles


def _mock_candles(symbol: str = "R_75", count: int = 100) -> list:
    """Données simulées pour n'importe quel symbole Deriv si API inaccessible."""
    info = DERIV_SYMBOLS.get(symbol, DERIV_SYMBOLS["R_75"])
    np.random.seed(int(time.time()) % 1000)
    base  = info["base_price"]
    vol   = info["volatility"]
    candles = []
    t = int(time.time()) - count * V75_GRANULARITY
    for i in range(count):
        change = np.random.normal(0, vol)
        open_  = base
        close  = base + change
        high   = max(open_, close) + abs(np.random.normal(0, vol * 0.25))
        low    = min(open_, close) - abs(np.random.normal(0, vol * 0.25))
        candles.append([t + i * V75_GRANULARITY, open_, high, low, close])
        base = close
    return candles


def _mock_v75_candles(count: int = 100) -> list:
    return _mock_candles("R_75", count)


# ── Endpoints REST ───────────────────────────────────────────
@router.get("/deriv/health")
async def deriv_health():
    configured = bool(DERIV_TOKEN)
    # Ping rapide API Deriv
    resp = await _deriv_request({"ping": 1}, timeout=5)
    api_live = "ping" in resp or "pong" in str(resp)
    return {
        "token_configured": configured,
        "api_live":         api_live,
        "symbol":           V75_SYMBOL,
        "status":           "ready" if api_live else "mock_mode",
    }


@router.post("/deriv/analyze")
async def analyze_v75(req: DerivTickRequest):
    """Analyse technique V75 avec stratégie scalp."""
    candles = await _fetch_v75_candles(req.symbol, req.count)
    source  = "live"
    if not candles:
        candles = _mock_v75_candles(req.count)
        source  = "mock"

    analysis = _v75_scalp_strategy(candles)
    last_candle = candles[-1] if candles else []

    return {
        "symbol":    req.symbol,
        "source":    source,
        "candles":   len(candles),
        "last_price": round(last_candle[4], 4) if last_candle else None,
        "timestamp": datetime.utcnow().isoformat(),
        **analysis,
    }


@router.post("/deriv/scalp")
async def scalp_v75(req: DerivScalpRequest):
    """
    Analyse + suggestion de trade scalp V75.
    En mode paper : retourne le trade suggéré sans l'exécuter.
    En mode live (DERIV_TOKEN configuré) : place le contrat via API Deriv.
    """
    candles = await _fetch_v75_candles(req.symbol, 100)
    source  = "live"
    if not candles:
        candles = _mock_v75_candles(100)
        source  = "mock"

    analysis = _v75_scalp_strategy(candles)
    signal   = analysis["signal"]

    # Si WAIT → pas de trade
    if signal == "WAIT":
        return {
            "action":  "NONE",
            "reason":  "Signal trop faible",
            "analysis": analysis,
            "source":   source,
        }

    trade_suggestion = {
        "symbol":        req.symbol,
        "contract_type": signal,   # CALL ou PUT
        "stake":         req.stake,
        "duration":      req.duration,
        "duration_unit": "m",
        "basis":         "stake",
        "currency":      "USD",
    }

    # Mode live : place vraiment le trade via API Deriv
    if DERIV_TOKEN and source == "live":
        # 1. Authorize
        auth_resp = await _deriv_request({"authorize": DERIV_TOKEN})
        if "error" in auth_resp:
            return {"action": "AUTH_FAILED", "error": auth_resp["error"]["message"]}

        # 2. Buy contract
        buy_payload = {
            "buy": 1,
            "price": req.stake,
            "parameters": {
                **trade_suggestion,
                "contract_type": signal,
            },
        }
        buy_resp = await _deriv_request(buy_payload, timeout=15)
        if "error" in buy_resp:
            return {"action": "BUY_FAILED", "error": buy_resp["error"]["message"], "analysis": analysis}

        return {
            "action":      "PLACED",
            "contract_id": buy_resp.get("buy", {}).get("contract_id"),
            "buy_price":   buy_resp.get("buy", {}).get("buy_price"),
            "trade":       trade_suggestion,
            "analysis":    analysis,
            "source":      "live",
        }

    # Mode paper
    return {
        "action":     "PAPER",
        "trade":      trade_suggestion,
        "analysis":   analysis,
        "source":     source,
        "note":       "Paper trade — configurez DERIV_API_TOKEN pour placer des trades réels",
    }


@router.get("/deriv/tick/{symbol}")
async def get_latest_tick(symbol: str = V75_SYMBOL):
    """Dernier tick du symbole."""
    resp = await _deriv_request({"ticks": symbol, "subscribe": 0}, timeout=8)
    if "error" in resp:
        return {"symbol": symbol, "price": None, "source": "mock",
                "note": "API Deriv inaccessible"}
    tick = resp.get("tick", {})
    return {
        "symbol": symbol,
        "price":  tick.get("quote"),
        "time":   tick.get("epoch"),
        "source": "live",
    }


@router.get("/deriv/symbols")
async def list_symbols():
    """Liste tous les symboles Deriv synthétiques supportés."""
    grouped: dict = {}
    for sym, info in DERIV_SYMBOLS.items():
        cat = info["category"]
        if cat not in grouped:
            grouped[cat] = []
        grouped[cat].append({"symbol": sym, "label": info["label"]})
    return {"symbols": DERIV_SYMBOLS, "grouped": grouped}


class MultiAnalyzeRequest(BaseModel):
    symbols: List[str] = ["R_75", "BOOM1000", "CRASH1000"]
    count:   int = 100


@router.post("/deriv/multi-analyze")
async def multi_analyze(req: MultiAnalyzeRequest):
    """Analyse en parallèle plusieurs indices Deriv synthétiques."""
    async def _analyze_one(symbol: str) -> dict:
        candles = await _fetch_v75_candles(symbol, req.count)
        source  = "live"
        if not candles:
            candles = _mock_candles(symbol, req.count)
            source  = "mock"
        analysis = _v75_scalp_strategy(candles)
        last_price = round(candles[-1][4], 4) if candles else None
        info = DERIV_SYMBOLS.get(symbol, {})
        return {
            "symbol":     symbol,
            "label":      info.get("label", symbol),
            "category":   info.get("category", "unknown"),
            "source":     source,
            "last_price": last_price,
            "timestamp":  datetime.utcnow().isoformat(),
            **analysis,
        }

    valid = [s for s in req.symbols if s in DERIV_SYMBOLS]
    if not valid:
        valid = ["R_75"]

    results = await asyncio.gather(*[_analyze_one(s) for s in valid])
    return {
        "count":   len(results),
        "results": list(results),
    }
