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
                          qty: float, price: float | None) -> dict:
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

    async def close_position(self, symbol: str) -> dict:
        # reduceOnly market — à raffiner avec la qty réelle de la position
        raise NotImplementedError("close via adapter à implémenter avec "
                                  "la réconciliation de position")
