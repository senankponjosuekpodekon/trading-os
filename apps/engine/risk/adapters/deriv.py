"""Adapter Deriv — indices synthétiques (V75, BOOM, CRASH…).

Env : DERIV_API_TOKEN + DERIV_APP_ID — requis pour s'enregistrer.
API websocket publique : wss://ws.derivws.com/websockets/v3?app_id=…

Le trading CFD sur Deriv passe par MT5 ; l'API ws expose les contrats
digitaux (CALL/PUT). On place un contrat 1-tick… non — position
directionnelle honnête : pas mappable proprement. L'adapter existe pour
le wiring ; la sémantique exacte (contrat vs position) reste à valider
avec un compte démo avant tout usage réel.
"""
from __future__ import annotations

import json
import os
from typing import Optional

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)

_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id={app_id}"


class DerivAdapter(VenueAdapter):
    venue = "SYNTHETIC"

    def __init__(self, token: str, app_id: str):
        self._token, self._app_id = token, app_id

    @classmethod
    def from_env(cls) -> Optional["DerivAdapter"]:
        token = os.getenv("DERIV_API_TOKEN")
        app_id = os.getenv("DERIV_APP_ID")
        if not token or not app_id:
            return None
        return cls(token, app_id)

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None) -> dict:
        import websockets  # dependency engine existante
        req = {
            "authorize": self._token,
        }
        async with websockets.connect(
                _WS_URL.format(app_id=self._app_id)) as ws:
            await ws.send(json.dumps(req))
            auth = json.loads(await ws.recv())
            if auth.get("error"):
                raise RuntimeError(auth["error"]["message"])
            await ws.send(json.dumps({
                "buy": 1, "price": qty, "parameters": {
                    "amount": qty, "basis": "stake",
                    "contract_type": "CALL" if direction == "BUY" else "PUT",
                    "currency": "USD", "duration": 1, "duration_unit": "d",
                    "symbol": symbol,
                }}))
            res = json.loads(await ws.recv())
            if res.get("error"):
                raise RuntimeError(res["error"]["message"])
            buy = res.get("buy", {})
            return {"price": float(buy.get("price") or 0),
                    "order_id": buy.get("contract_id")}

    async def close_position(self, symbol: str) -> dict:
        raise NotImplementedError
