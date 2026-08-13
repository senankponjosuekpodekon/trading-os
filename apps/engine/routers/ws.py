"""
WebSocket /ws/prices — prix live depuis Binance (via poll 3s)
/ws/signals — dernier scan diffusé aux clients connectés
"""
import asyncio
import json
import random
import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set

from utils.deriv_symbols import to_wire_symbol

from utils.http import retry_async
from utils.logger import get_logger
from utils.circuit_breaker import BREAKERS, State as BreakerState

router = APIRouter()
logger = get_logger(__name__)

BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"
SYMBOLS_BINANCE   = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
    "AVAXUSDT", "ADAUSDT", "DOTUSDT", "LINKUSDT",
    "MATICUSDT", "ATOMUSDT", "LTCUSDT", "XRPUSDT",
    "DOGEUSDT", "TRXUSDT", "TONUSDT", "PAXGUSDT",
]

# Mapping symbole interne → ticker yfinance pour prix snapshot Forex/Commodités
YF_PRICE_SYMBOLS: dict = {
    "EUR/USD": "EURUSD=X", "GBP/USD": "GBPUSD=X", "USD/JPY": "JPY=X",
    "AUD/USD": "AUDUSD=X", "USD/CHF": "CHF=X",   "USD/CAD": "CAD=X",
    "NZD/USD": "NZDUSD=X",
    "XAU/USD": "GC=F",  "XAG/USD": "SI=F",
    "WTI/USD": "CL=F",  "BRENT/USD": "BZ=F",
}

# Mapping symbole interne → identifiant Deriv pour prix tick
DERIV_PRICE_SYMBOLS: dict = {
    "VIX10/USD": "R_10",   "VIX25/USD": "R_25",   "VIX50/USD": "R_50",
    "VIX75/USD": "R_75",   "VIX100/USD": "R_100",
    "BOOM300/USD": to_wire_symbol("BOOM300"),   "BOOM500/USD": "BOOM500",   "BOOM1000/USD": "BOOM1000",
    "CRASH300/USD": to_wire_symbol("CRASH300"), "CRASH500/USD": "CRASH500", "CRASH1000/USD": "CRASH1000",
    "JUMP10/USD": "JD10", "JUMP25/USD": "JD25", "JUMP50/USD": "JD50",
    "JUMP75/USD": "JD75", "JUMP100/USD": "JD100",
}

DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3?app_id=1089"

_price_clients:  Set[WebSocket] = set()
_signal_clients: Set[WebSocket] = set()
_pattern_clients: Set[WebSocket] = set()
_last_prices:    dict = {}
_last_signals:   list = []
_last_patterns:  list = []


async def broadcast(clients: Set[WebSocket], payload: dict):
    dead = set()
    msg  = json.dumps(payload)
    for ws in clients:
        try:
            await ws.send_text(msg)
        except Exception as exc:
            logger.debug("ws_broadcast_failed", error=str(exc))
            dead.add(ws)
    clients -= dead


def _fetch_yf_prices_sync() -> dict:
    """Snapshot prix Forex + Commodités via yfinance — 1 seul appel batch pour tous les tickers."""
    try:
        import yfinance as yf
        tickers = list(YF_PRICE_SYMBOLS.values())
        # Un seul appel HTTP pour tous les symboles (period=1d, interval=1m → dernier prix dispo)
        raw = yf.download(
            tickers,
            period="1d",
            interval="5m",
            progress=False,
            auto_adjust=True,
            threads=False,   # pas de threads supplémentaires
        )
        prices = {}
        reverse = {v: k for k, v in YF_PRICE_SYMBOLS.items()}
        if raw.empty:
            return prices
        close = raw["Close"] if "Close" in raw else raw
        if hasattr(close, 'columns'):
            # Multi-ticker : colonnes = tickers
            for yf_ticker, sym_internal in reverse.items():
                try:
                    col = close[yf_ticker].dropna()
                    if not col.empty:
                        prices[sym_internal] = float(col.iloc[-1])
                except Exception as exc:
                    logger.debug("yfinance_ticker_failed", ticker=yf_ticker, error=str(exc))
        else:
            # Un seul ticker
            col = close.dropna()
            if not col.empty:
                first_internal = next(iter(reverse.values()))
                prices[first_internal] = float(col.iloc[-1])
        return prices
    except Exception as exc:
        logger.debug("yfinance_prices_failed", error=str(exc))
        return {}


async def _fetch_deriv_prices() -> dict:
    """Snapshot prix Deriv via 1 seule connexion WS — envoie tous les ticks, lit les réponses."""
    import websockets as _ws
    prices = {}
    deriv_syms = list(DERIV_PRICE_SYMBOLS.values())
    deriv_to_internal = {v: k for k, v in DERIV_PRICE_SYMBOLS.items()}
    try:
        async with _ws.connect(DERIV_WS_URL, ping_interval=None) as ws:
            # Envoyer tous les ticks en une seule rafale
            for deriv_sym in deriv_syms:
                await ws.send(json.dumps({"ticks": deriv_sym}))
            # Lire toutes les réponses avec un seul timeout global
            deadline = asyncio.get_event_loop().time() + 5.0
            while asyncio.get_event_loop().time() < deadline:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    data = json.loads(raw)
                    tick = data.get("tick", {})
                    sym  = tick.get("symbol")
                    quote = tick.get("quote")
                    if sym and quote:
                        internal = deriv_to_internal.get(sym)
                        if internal:
                            prices[internal] = float(quote)
                    if len(prices) >= len(deriv_syms):
                        break
                except asyncio.TimeoutError:
                    break
    except Exception as e:
        logger.warning("deriv_prices_failed", error=str(e))
    return prices


async def price_broadcaster():
    """Tâche de fond : fetch prix Binance toutes les 3s, Deriv toutes les 10s, Forex/Commodités toutes les 30s."""
    _yf_counter    = 0   # toutes les 10 itérations = 30s
    _deriv_counter = 0   # toutes les  3 itérations = 10s
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                prices = {}

                # --- Binance (toutes les 3s) — skip if circuit breaker OPEN ---
                _binance_breaker = BREAKERS.get("binance_realtime")
                if not _binance_breaker or _binance_breaker.state != BreakerState.OPEN.value:
                    async def _fetch_prices():
                        resp = await client.get(
                            BINANCE_PRICE_URL,
                            params={"symbols": json.dumps(SYMBOLS_BINANCE, separators=(',', ':'))},
                        )
                        resp.raise_for_status()
                        return resp.json()

                    data = await retry_async(
                        _fetch_prices,
                        max_retries=1,
                        base_delay=0.5,
                        exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
                        on_retry=lambda attempt, exc: logger.debug(
                            "binance_price_retry",
                            attempt=attempt,
                            error_type=type(exc).__name__,
                            error=repr(exc),
                        ),
                        source="binance_realtime",
                    )
                    prices = {item["symbol"]: float(item["price"]) for item in data}

                # --- Deriv (toutes les 10s ~ 3 cycles) ---
                _deriv_counter += 1
                if _deriv_counter >= 3:
                    _deriv_counter = 0
                    try:
                        deriv_prices = await asyncio.wait_for(_fetch_deriv_prices(), timeout=8.0)
                        prices.update(deriv_prices)
                    except Exception as exc:
                        logger.debug("deriv_prices_fetch_failed", error=str(exc))

                # --- yfinance Forex/Commodités (toutes les 30s ~ 10 cycles) ---
                _yf_counter += 1
                if _yf_counter >= 10:
                    _yf_counter = 0
                    try:
                        loop = asyncio.get_event_loop()
                        yf_prices = await asyncio.wait_for(
                            loop.run_in_executor(None, _fetch_yf_prices_sync),
                            timeout=20.0
                        )
                        prices.update(yf_prices)
                    except Exception as exc:
                        logger.debug("yfinance_prices_fetch_failed", error=str(exc))

                _last_prices.update(prices)
                if _price_clients:
                    await broadcast(_price_clients, {"type": "prices", "data": _last_prices})
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("price_broadcast_failed", error_type=type(e).__name__, error=repr(e))
            await asyncio.sleep(3 + random.uniform(0, 0.5))


def set_latest_signals(signals: list):
    """Appelé par scan.py après chaque scan pour diffuser aux clients WS."""
    global _last_signals
    _last_signals = signals
    asyncio.create_task(_broadcast_signals(signals))


async def _broadcast_signals(signals: list):
    if _signal_clients:
        await broadcast(_signal_clients, {"type": "signals", "data": signals})


def broadcast_pattern(pattern: dict):
    """Appelé par scan.py quand un pattern chartiste est détecté — diffuse à tous les clients WS connectés
    et pousse une notification SSE via l'API. Safe to call from sync context (analyze_candles)."""
    global _last_patterns
    _last_patterns.append(pattern)
    if len(_last_patterns) > 100:
        _last_patterns = _last_patterns[-100:]
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_broadcast_patterns(pattern))
        loop.create_task(_notify_api_pattern(pattern))
    except RuntimeError:
        pass


async def _broadcast_patterns(pattern: dict):
    if _pattern_clients:
        await broadcast(_pattern_clients, {"type": "pattern_detected", "data": pattern})


async def _notify_api_pattern(pattern: dict):
    """Push pattern alert to API /api/notifications/internal/pattern (fire-and-forget)."""
    import os
    api_url = os.environ.get("API_URL", "http://api:3001")
    engine_key = os.environ.get("ENGINE_API_KEY", "")
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(
                f"{api_url}/api/notifications/internal/pattern",
                json=pattern,
                headers={"X-Engine-Key": engine_key},
            )
    except Exception:
        pass


@router.get("/prices/latest")
async def prices_latest(symbols: str = ""):
    """
    Retourne les derniers prix connus (mis à jour toutes les 3s par le broadcaster).
    ?symbols=BTCUSDT,ETHUSDT  — filtre optionnel. Sans paramètre : tous les symboles.
    """
    if not _last_prices:
        return {"prices": {}, "source": "cache_empty"}
    if symbols:
        want = {s.strip().upper() for s in symbols.split(",")}
        data = {k: v for k, v in _last_prices.items() if k in want}
    else:
        data = dict(_last_prices)
    return {"prices": data, "count": len(data), "source": "cache"}


@router.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    await websocket.accept()
    _price_clients.add(websocket)
    if _last_prices:
        await websocket.send_text(json.dumps({"type": "prices", "data": _last_prices}))
    try:
        while True:
            await asyncio.sleep(1)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        _price_clients.discard(websocket)


@router.websocket("/ws/signals")
async def ws_signals(websocket: WebSocket):
    await websocket.accept()
    _signal_clients.add(websocket)
    if _last_signals:
        await websocket.send_text(json.dumps({"type": "signals", "data": _last_signals}))
    try:
        while True:
            await asyncio.sleep(1)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        _signal_clients.discard(websocket)


@router.websocket("/ws/patterns")
async def ws_patterns(websocket: WebSocket):
    await websocket.accept()
    _pattern_clients.add(websocket)
    if _last_patterns:
        await websocket.send_text(json.dumps({"type": "patterns", "data": _last_patterns[-20:]}))
    try:
        while True:
            await asyncio.sleep(1)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        _pattern_clients.discard(websocket)
