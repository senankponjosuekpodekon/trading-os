"""
Deriv WebSocket client — connexion unique partagée vers l'API Deriv.

Conforme aux best-practices Deriv :
- 1 seule connexion WS persistante, requêtes multiplexées via req_id
- reconnexion avec backoff exponentiel + jitter (1s → 30s max)
- keepalive ping
- rate limiter token-bucket (180 req/min par défaut, sous la limite Deriv de 220)
- subscriptions de ticks : push → callbacks, resubscribe auto après reconnect

Usage :
    from utils.deriv_client import deriv_client

    resp = await deriv_client.request({"ticks_history": "R_75", ...})
    deriv_client.subscribe_ticks("R_75", my_callback)
"""
import asyncio
import itertools
import json
import os
import random
import time
from typing import Any, Callable, Optional

import websockets

from utils.logger import get_logger

logger = get_logger(__name__)

DERIV_WS_URL = os.getenv(
    "DERIV_WS_URL",
    "wss://api.derivws.com/trading/v1/options/ws/public",
)

# Budget de requêtes/minute côté client — marge sous la limite Deriv (~220/min).
DERIV_MAX_RPM = int(os.getenv("DERIV_MAX_RPM", "180"))

_PING_INTERVAL = 25.0      # secondes entre les pings keepalive
_CONNECT_TIMEOUT = 10.0
_BACKOFF_MAX = 30.0


class DerivClient:
    """Singleton client WebSocket Deriv (voir module docstring)."""

    def __init__(self) -> None:
        self._ws: Optional[Any] = None
        self._connected = asyncio.Event()
        self._supervisor: Optional[asyncio.Task] = None
        self._closed = False

        self._req_ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._send_lock = asyncio.Lock()

        # symbol -> callbacks(tick_dict)
        self._tick_callbacks: dict[str, list[Callable[[dict], None]]] = {}
        # symbol (wire) -> dernier tick reçu (alimenté par toutes les pushes)
        self.last_ticks: dict[str, dict] = {}

        # token bucket
        self._tokens = float(DERIV_MAX_RPM)
        self._token_ts = time.monotonic()
        self._token_lock = asyncio.Lock()

    # ── lifecycle ────────────────────────────────────────────────

    async def start(self) -> None:
        """Démarre le superviseur de connexion (idempotent)."""
        if self._closed or (self._supervisor and not self._supervisor.done()):
            return
        self._supervisor = asyncio.create_task(self._run(), name="deriv_ws_supervisor")

    async def close(self) -> None:
        self._closed = True
        if self._supervisor:
            self._supervisor.cancel()
            try:
                await asyncio.wait_for(self._supervisor, timeout=3.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        self._fail_all_pending("Deriv client closed")

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    # ── superviseur connexion + backoff ──────────────────────────

    async def _run(self) -> None:
        backoff = 1.0
        while not self._closed:
            try:
                async with websockets.connect(
                    DERIV_WS_URL,
                    ping_interval=None,   # pings applicatifs gérés par _pinger
                    open_timeout=_CONNECT_TIMEOUT,
                    max_queue=2048,
                ) as ws:
                    self._ws = ws
                    self._connected.set()
                    backoff = 1.0
                    logger.info("deriv_ws_connected", url=DERIV_WS_URL)
                    await self._resubscribe_all(ws)

                    reader = asyncio.create_task(self._reader(ws))
                    pinger = asyncio.create_task(self._pinger(ws))
                    done, pending = await asyncio.wait(
                        {reader, pinger}, return_when=asyncio.FIRST_COMPLETED
                    )
                    for t in pending:
                        t.cancel()
                    for t in done:
                        exc = t.exception()
                        if exc and not isinstance(exc, asyncio.CancelledError):
                            raise exc
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("deriv_ws_error", error=str(exc))
            finally:
                self._connected.clear()
                self._ws = None
                self._fail_all_pending("Deriv WS disconnected")

            if self._closed:
                break
            delay = min(backoff, _BACKOFF_MAX) + random.uniform(0, backoff * 0.3)
            logger.info("deriv_ws_reconnecting", delay=round(delay, 1))
            await asyncio.sleep(delay)
            backoff = min(backoff * 2, _BACKOFF_MAX)

    async def _reader(self, ws: Any) -> None:
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            req_id = data.get("req_id")
            if req_id is not None:
                fut = self._pending.pop(req_id, None)
                if fut and not fut.done():
                    fut.set_result(data)

            tick = data.get("tick")
            if isinstance(tick, dict):
                sym = tick.get("symbol")
                if sym:
                    self.last_ticks[sym] = tick
                for cb in list(self._tick_callbacks.get(sym, [])):
                    try:
                        cb(tick)
                    except Exception as exc:
                        logger.debug("deriv_tick_cb_error", symbol=sym, error=str(exc))

    async def _pinger(self, ws: Any) -> None:
        while True:
            await asyncio.sleep(_PING_INTERVAL)
            await ws.send(json.dumps({"ping": 1}))

    def _fail_all_pending(self, msg: str) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_result({"error": {"message": msg}})
        self._pending.clear()

    # ── rate limiter (token bucket) ──────────────────────────────

    async def _throttle(self) -> None:
        async with self._token_lock:
            now = time.monotonic()
            self._tokens = min(
                float(DERIV_MAX_RPM),
                self._tokens + (now - self._token_ts) * DERIV_MAX_RPM / 60.0,
            )
            self._token_ts = now
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return
            wait = (1.0 - self._tokens) * 60.0 / DERIV_MAX_RPM
        await asyncio.sleep(wait)

    # ── API publique ─────────────────────────────────────────────

    async def request(self, payload: dict, timeout: float = 10.0) -> dict:
        """Envoie une requête et attend la réponse (multiplexée via req_id)."""
        await self.start()
        req_id = next(self._req_ids)
        fut = asyncio.get_running_loop().create_future()
        self._pending[req_id] = fut
        try:
            await self._throttle()
            ws = await self._wait_connected(timeout)
            if ws is None:
                return {"error": {"message": "Deriv WS non connecté"}}
            async with self._send_lock:
                await ws.send(json.dumps({**payload, "req_id": req_id}))
            remaining = timeout
            return await asyncio.wait_for(fut, timeout=remaining)
        except asyncio.TimeoutError:
            return {"error": {"message": "Timeout API Deriv"}}
        except Exception as exc:
            return {"error": {"message": str(exc)}}
        finally:
            self._pending.pop(req_id, None)

    def subscribe_ticks(self, symbol: str, callback: Callable[[dict], None]) -> None:
        """S'abonne au flux de ticks d'un symbole (resubscribe auto au reconnect)."""
        cbs = self._tick_callbacks.setdefault(symbol, [])
        if callback not in cbs:
            cbs.append(callback)
        if len(cbs) == 1 and self._connected.is_set() and self._ws:
            asyncio.create_task(self._send_tick_subscribe(self._ws, symbol))

    async def _resubscribe_all(self, ws: Any) -> None:
        for symbol in self._tick_callbacks:
            await self._send_tick_subscribe(ws, symbol)

    async def _send_tick_subscribe(self, ws: Any, symbol: str) -> None:
        try:
            await self._throttle()
            async with self._send_lock:
                await ws.send(json.dumps({
                    "ticks": symbol,
                    "subscribe": 1,
                    "req_id": next(self._req_ids),
                }))
            logger.info("deriv_tick_subscribed", symbol=symbol)
        except Exception as exc:
            logger.warning("deriv_tick_subscribe_failed", symbol=symbol, error=str(exc))

    async def _wait_connected(self, timeout: float) -> Optional[Any]:
        if self._connected.is_set():
            return self._ws
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=timeout)
            return self._ws
        except asyncio.TimeoutError:
            return None


# ── Singleton ────────────────────────────────────────────────────
deriv_client = DerivClient()
