"""Adapter Binance USDⓈ-M Futures (testnet par défaut).

Env :
  BINANCE_API_KEY / BINANCE_API_SECRET — requis pour s'enregistrer
  BINANCE_TESTNET=1 (défaut) → testnet-futures ; 0 → prod RÉELLE

L'adapter place des ordres LIMIT au prix demandé (pas de market order
aveugle — le slippage se mesure via requested vs fill).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Optional
from urllib.parse import urlencode

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)

_BASE_PROD = "https://fapi.binance.com"
_BASE_TEST = "https://testnet.binancefuture.com"


class BinanceAdapter(VenueAdapter):
    venue = "FUTURES"

    def __init__(self, key: str, secret: str, base: str):
        self._key, self._secret, self._base = key, secret, base

    @classmethod
    def from_env(cls) -> Optional["BinanceAdapter"]:
        key = os.getenv("BINANCE_API_KEY")
        secret = os.getenv("BINANCE_API_SECRET")
        if not key or not secret:
            return None
        testnet = os.getenv("BINANCE_TESTNET", "1") != "0"
        if not testnet:
            logger.warning("binance_adapter_LIVE_MODE")
        return cls(key, secret, _BASE_TEST if testnet else _BASE_PROD)

    def _sign(self, params: dict) -> str:
        q = urlencode(params)
        return hmac.new(self._secret.encode(), q.encode(),
                        hashlib.sha256).hexdigest()

    async def _post(self, path: str, params: dict) -> dict:
        params = {**params, "timestamp": int(time.time() * 1000),
                  "recvWindow": 5000}
        params["signature"] = self._sign(params)
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.post(path, params=params,
                             headers={"X-MBX-APIKEY": self._key})
            r.raise_for_status()
            return r.json()

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        # TODO live : attacher un STOP_MARKET closePosition côté Binance
        # (algo /fapi/v1/order type=STOP_MARKET) pour la protection broker.
        _ = (stop_loss, take_profit)
        sym = symbol.replace("/", "")
        params = {
            "symbol": sym, "side": "BUY" if direction == "BUY" else "SELL",
            "type": "LIMIT", "timeInForce": "GTC",
            "quantity": f"{qty:.6f}".rstrip("0").rstrip("."),
            "price": f"{price}",
        }
        res = await self._post("/fapi/v1/order", params)
        return {"price": float(res.get("avgPrice") or price or 0),
                "order_id": res.get("orderId"), "raw_status": res.get("status")}

    async def _get(self, path: str, params: dict) -> dict | list:
        params = {**params, "timestamp": int(time.time() * 1000),
                  "recvWindow": 5000}
        params["signature"] = self._sign(params)
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.get(path, params=params,
                            headers={"X-MBX-APIKEY": self._key})
            r.raise_for_status()
            return r.json()

    async def close_position(self, symbol: str) -> dict:
        """Lit la position réelle (positionRisk) puis envoie un ordre
        MARKET reduceOnly de la quantité exacte."""
        sym = symbol.replace("/", "")
        rows = await self._get("/fapi/v2/positionRisk", {"symbol": sym})
        pos = next((r for r in rows
                    if float(r.get("positionAmt", 0)) != 0), None)
        if not pos:
            return {"closed": False, "reason": "no open position"}
        amt = float(pos["positionAmt"])
        res = await self._post("/fapi/v1/order", {
            "symbol": sym,
            "side": "SELL" if amt > 0 else "BUY",
            "type": "MARKET", "reduceOnly": "true",
            "quantity": f"{abs(amt):.6f}".rstrip("0").rstrip("."),
        })
        return {"closed": True, "qty": abs(amt),
                "price": float(res.get("avgPrice") or 0),
                "order_id": res.get("orderId")}
