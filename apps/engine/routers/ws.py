"""
WebSocket /ws/prices — prix live depuis Binance (via poll 3s)
/ws/signals — dernier scan diffusé aux clients connectés
"""
import asyncio
import json
import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Set

from utils.http import retry_async
from utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

BINANCE_PRICE_URL = "https://api.binance.com/api/v3/ticker/price"
SYMBOLS_BINANCE   = [
    # Crypto majeurs
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
    "AVAXUSDT", "ADAUSDT", "DOTUSDT", "LINKUSDT",
    "MATICUSDT", "ATOMUSDT", "LTCUSDT", "XRPUSDT",
    # Forex & Commodités (paires disponibles sur Binance)
    "EURUSDT", "GBPUSDT",
    # Or via PAXG
    "PAXGUSDT",
]

_price_clients:  Set[WebSocket] = set()
_signal_clients: Set[WebSocket] = set()
_last_prices:    dict = {}
_last_signals:   list = []


async def broadcast(clients: Set[WebSocket], payload: dict):
    dead = set()
    msg  = json.dumps(payload)
    for ws in clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    clients -= dead


async def price_broadcaster():
    """Tâche de fond : fetch prix Binance toutes les 3s et broadcast."""
    async with httpx.AsyncClient(timeout=5) as client:
        while True:
            try:
                async def _fetch_prices():
                    resp = await client.get(
                        BINANCE_PRICE_URL,
                        params={"symbols": json.dumps(SYMBOLS_BINANCE, separators=(',', ':'))},
                    )
                    resp.raise_for_status()
                    return resp.json()

                data = await retry_async(
                    _fetch_prices,
                    max_retries=3,
                    base_delay=0.5,
                    exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
                    on_retry=lambda attempt, exc: logger.warning(
                        "binance_price_retry", attempt=attempt, error=str(exc)
                    ),
                )
                prices = {item["symbol"]: float(item["price"]) for item in data}
                _last_prices.update(prices)
                if _price_clients:
                    await broadcast(_price_clients, {"type": "prices", "data": prices})
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("binance_price_failed", error=str(e))
            await asyncio.sleep(3)


def set_latest_signals(signals: list):
    """Appelé par scan.py après chaque scan pour diffuser aux clients WS."""
    global _last_signals
    _last_signals = signals
    asyncio.create_task(_broadcast_signals(signals))


async def _broadcast_signals(signals: list):
    if _signal_clients:
        await broadcast(_signal_clients, {"type": "signals", "data": signals})


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
