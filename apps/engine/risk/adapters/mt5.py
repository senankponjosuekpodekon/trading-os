"""Adapter MT5 — venue MARGIN via le bridge local (tools/mt5-bridge).

Env : MT5_BRIDGE_URL (défaut http://127.0.0.1:5555) + MT5_BRIDGE_TOKEN.
Le bridge tourne sous Wine sur le même VPS → latence ~5-20ms, aucun
exposition réseau. Venue 'MARGIN' enregistrée seulement si le token est
présent ET le bridge répond /health.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)


class MT5Adapter(VenueAdapter):
    venue = "MARGIN"

    def __init__(self, url: str, token: str):
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    @classmethod
    def from_env(cls) -> Optional["MT5Adapter"]:
        token = os.getenv("MT5_BRIDGE_TOKEN")
        url = os.getenv("MT5_BRIDGE_URL", "http://127.0.0.1:5555")
        if not token:
            return None
        return cls(url, token)

    async def _post(self, path: str, body: dict) -> dict:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{self._url}{path}", json=body,
                             headers=self._headers)
            r.raise_for_status()
            data = r.json()
            if data.get("error"):
                raise RuntimeError(data["error"])
            return data

    async def health(self) -> dict:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self._url}/health", headers=self._headers)
            return r.json()

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None) -> dict:
        # Symbol MT5 brut : EUR/USD → EURUSD (le bridge gère symbol_select)
        mt5_symbol = symbol.replace("/", "")
        # qty engine = unités de base ; volume MT5 = lots (1 lot = 100k forex).
        # La conversion lots↔unités est faite côté caller via lot_min/multiplier ;
        # ici on transmet qty arrondie à 0.01 lot près (min broker).
        res = await self._post("/order", {
            "symbol": mt5_symbol, "side": direction,
            "volume": round(qty, 2)})
        return {"price": res.get("price"), "order_id": res.get("order"),
                "deal": res.get("deal")}

    async def close_position(self, symbol: str) -> dict:
        return await self._post("/close", {"symbol": symbol.replace("/", "")})
