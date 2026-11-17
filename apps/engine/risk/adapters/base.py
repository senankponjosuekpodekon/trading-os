"""Interface des adapters d'exécution live.

Chaque adapter renvoie place_order → {"price": fill, "order_id": ...}
ou lève une exception → ordre FAILED. Les adapters ne s'enregistrent
que si leurs credentials sont présents (from_env() → None sinon).
"""
from __future__ import annotations

from typing import Optional


class VenueAdapter:
    venue: str = ""

    @classmethod
    def from_env(cls) -> Optional["VenueAdapter"]:
        return None

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        """qty est en unités de l'actif de base (décision du gate).
        Chaque adapter convertit vers sa convention venue (lots MT5,
        units Oanda, qty Binance…). stop_loss/take_profit sont transmis
        au broker quand la venue le permet — protection côté broker."""
        raise NotImplementedError

    async def close_position(self, symbol: str) -> dict:
        raise NotImplementedError
