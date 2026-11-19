"""
Accès CoinGecko mutualisé — pacing global par hôte.
Tous les consommateurs (onchain, macro, hidden-gems, majors, tokenomics,
pre-listing) partagent UNE file : max 1 requête concurrente, ≥1.5s entre
deux départs — c'est l'empilement de 6+ sites distincts qui déclenchait
le circuit breaker. Échec → CircuitOpenError propagé comme avant.
"""
from __future__ import annotations

from typing import Any, Optional

import httpx

from utils.rate_limiter import host_rate_limit

_BASE = "https://api.coingecko.com/api/v3"
_TIMEOUT = 8.0


@host_rate_limit("api.coingecko.com", max_concurrent=1, min_delay=1.5)
async def cg_get(path: str, params: Optional[dict] = None) -> Any:
    """GET pacé sur api.coingecko.com — path sans le préfixe /api/v3."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.get(f"{_BASE}{path}", params=params)
        r.raise_for_status()
        return r.json()
