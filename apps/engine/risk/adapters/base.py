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
                          qty: float, price: float | None) -> dict:
        raise NotImplementedError

    async def close_position(self, symbol: str) -> dict:
        raise NotImplementedError
