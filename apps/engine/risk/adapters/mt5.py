"""Adapter MT5 — venue MARGIN via le bridge local (tools/mt5-bridge).

Env : MT5_BRIDGE_URL (défaut http://127.0.0.1:5555) + MT5_BRIDGE_TOKEN.
Le bridge tourne sous Wine sur le même VPS → latence ~5-20ms, aucun
exposition réseau. Venue 'MARGIN' enregistrée si le token est présent.

qty du gate = unités de l'actif de base (ex. 10 000 EUR pour EURUSD).
MT5 attend des LOTS → conversion via trade_contract_size du broker
(endpoint /contract du bridge), arrondie au volume_step inférieur.
"""
from __future__ import annotations

import math
import os
from typing import Optional

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)

# Magic partagé avec tools/mt5-bridge/server.py — permet de filtrer les
# positions ouvertes par l'engine lors de la clôture (/close?magic).
ENGINE_MAGIC = 20261118


class MT5Adapter(VenueAdapter):
    venue = "MARGIN"

    def __init__(self, url: str, token: str):
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._contracts: dict[str, dict] = {}  # symbol → spec broker

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

    async def _get(self, path: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self._url}{path}", headers=self._headers)
            r.raise_for_status()
            return r.json()

    async def health(self) -> dict:
        return await self._get("/health")

    async def _contract(self, mt5_symbol: str) -> dict:
        """Spécifications broker du symbole (contract_size, volume_step…).
        Fallback conservateur : 1 lot = 100k unités (standard forex)."""
        if mt5_symbol not in self._contracts:
            try:
                spec = await self._get(f"/contract/{mt5_symbol}")
            except Exception:
                spec = {}
            self._contracts[mt5_symbol] = {
                "contract_size": float(spec.get("contract_size") or 100000.0),
                "volume_min": float(spec.get("volume_min") or 0.01),
                "volume_step": float(spec.get("volume_step") or 0.01),
                "volume_max": float(spec.get("volume_max") or 100.0),
            }
        return self._contracts[mt5_symbol]

    async def _units_to_lots(self, mt5_symbol: str, qty: float) -> float:
        """qty (unités base) → volume MT5 en lots, arrondi au step inf."""
        spec = await self._contract(mt5_symbol)
        lots = qty / spec["contract_size"]
        step = spec["volume_step"]
        lots = math.floor(lots / step) * step
        lots = round(lots, 8)
        if lots < spec["volume_min"]:
            raise RuntimeError(
                f"qty {qty} units → {lots} lots < volume_min "
                f"{spec['volume_min']} pour {mt5_symbol}")
        if lots > spec["volume_max"]:
            raise RuntimeError(
                f"qty {qty} units → {lots} lots > volume_max "
                f"{spec['volume_max']} pour {mt5_symbol}")
        return lots

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        # Symbol MT5 brut : EUR/USD → EURUSD (le bridge gère symbol_select)
        mt5_symbol = symbol.replace("/", "")
        volume = await self._units_to_lots(mt5_symbol, abs(qty))
        body = {"symbol": mt5_symbol, "side": direction, "volume": volume}
        if stop_loss:
            body["sl"] = stop_loss
        if take_profit:
            body["tp"] = take_profit
        res = await self._post("/order", body)
        return {"price": res.get("price"), "order_id": res.get("order"),
                "deal": res.get("deal"), "volume_lots": volume}

    async def close_position(self, symbol: str) -> dict:
        # magic : ne ferme que les positions ouvertes par l'engine,
        # pas les positions manuelles sur le même compte.
        return await self._post("/close", {
            "symbol": symbol.replace("/", ""), "magic": ENGINE_MAGIC})
