"""Adapter Oanda — forex/métaux/CFD venue MARGIN.

Env : OANDA_API_TOKEN + OANDA_ACCOUNT_ID (+ OANDA_PRACTICE=0 pour live).
Practice API gratuite → permet de tester le wiring complet sans argent.

Conventions Oanda : instrument EUR_USD, units signés (+buy / −sell),
ordre LIMIT.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)


class OandaAdapter(VenueAdapter):
    venue = "MARGIN"

    def __init__(self, token: str, account: str, base: str):
        self._token, self._account, self._base = token, account, base

    @classmethod
    def from_env(cls) -> Optional["OandaAdapter"]:
        token = os.getenv("OANDA_API_TOKEN")
        account = os.getenv("OANDA_ACCOUNT_ID")
        if not token or not account:
            return None
        practice = os.getenv("OANDA_PRACTICE", "1") != "0"
        base = ("https://api-fxpractice.oanda.com" if practice
                else "https://api-fxtrade.oanda.com")
        if not practice:
            logger.warning("oanda_adapter_LIVE_MODE")
        return cls(token, account, base)

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        inst = symbol.replace("/", "_")
        units = int(round(qty)) * (1 if direction == "BUY" else -1)
        body = {"order": {
            "instrument": inst, "units": str(units),
            "type": "LIMIT" if price else "MARKET",
            "timeInForce": "GTC" if price else "FOK",
            **({"price": f"{price:.5f}"} if price else {}),
            # Protection côté broker : SL/TP attachés au fill.
            **({"stopLossOnFill": {"price": f"{stop_loss:.5f}"}}
               if stop_loss else {}),
            **({"takeProfitOnFill": {"price": f"{take_profit:.5f}"}}
               if take_profit else {}),
        }}
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.post(
                f"/v3/accounts/{self._account}/orders", json=body,
                headers={"Authorization": f"Bearer {self._token}"})
            r.raise_for_status()
            res = r.json()
        fill = res.get("orderFillTransaction", {})
        return {"price": float(fill.get("price") or price or 0),
                "order_id": res.get("orderCreateTransaction", {}).get("id")}

    async def close_position(self, symbol: str) -> dict:
        inst = symbol.replace("/", "_")
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.put(
                f"/v3/accounts/{self._account}/positions/{inst}/close",
                json={"longUnits": "ALL", "shortUnits": "ALL"},
                headers={"Authorization": f"Bearer {self._token}"})
            r.raise_for_status()
            return r.json()
