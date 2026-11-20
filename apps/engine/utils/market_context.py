"""
Sprint 7 — Contexte marché pour enrichir chaque signal.
Agrège macro + on-chain sans appels redondants grâce au cache interne des routes.
"""
import asyncio
from typing import Optional

import httpx

from routers.macro import fear_greed, vix, dxy
from routers.onchain import onchain_context, btc_dominance
from routers.symbol_mappings import SYMBOL_TO_BINANCE
from utils.cache import cache

CRYPTO_SUFFIX = "/USDT"
FOREX_TOKENS = {"EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD"}
COMMODITY_TOKENS = {"XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD"}
INDEX_TOKENS = {"VIX75/USD", "VIX25/USD", "VIX10/USD", "BOOM1000/USD", "CRASH1000/USD"}


async def _funding_for(symbol: str) -> Optional[dict]:
    """Funding rate courant du perp (Binance premiumIndex) — le funding
    extrême est un signal de surcharge de levier, pas juste un coût."""
    key = f"funding:{symbol}"
    cached = await cache.get(key)
    if cached:
        return cached
    binance_sym = SYMBOL_TO_BINANCE.get(symbol)
    if not binance_sym:
        return None
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(
                "https://fapi.binance.com/fapi/v1/premiumIndex",
                params={"symbol": binance_sym})
            r.raise_for_status()
            d = r.json()
            out = {
                "funding_rate": float(d.get("lastFundingRate") or 0),
                "mark_price": float(d.get("markPrice") or 0),
            }
            await cache.set(key, out, ttl=300)
            return out
    except Exception:
        return None


async def get_signal_context(symbol: str) -> Optional[dict]:
    """Retourne le contexte macro + on-chain pour un symbole donné."""
    try:
        if symbol.endswith(CRYPTO_SUFFIX):
            fg, onchain, btc, fund = await asyncio.gather(
                fear_greed(),
                onchain_context(symbol),
                btc_dominance(),
                _funding_for(symbol),
                return_exceptions=True,
            )
            return {
                "market": "crypto",
                "fear_greed": fg if not isinstance(fg, Exception) else None,
                "onchain": onchain if not isinstance(onchain, Exception) else None,
                "btc_dominance": btc if not isinstance(btc, Exception) else None,
                "funding": fund if not isinstance(fund, Exception) else None,
            }

        if symbol in FOREX_TOKENS:
            fg, dxy_val = await asyncio.gather(
                fear_greed(),
                dxy(),
                return_exceptions=True,
            )
            return {
                "market": "forex",
                "fear_greed": fg if not isinstance(fg, Exception) else None,
                "dxy": dxy_val if not isinstance(dxy_val, Exception) else None,
            }

        if symbol in INDEX_TOKENS:
            fg, vix_val = await asyncio.gather(
                fear_greed(),
                vix(),
                return_exceptions=True,
            )
            return {
                "market": "indices",
                "fear_greed": fg if not isinstance(fg, Exception) else None,
                "vix": vix_val if not isinstance(vix_val, Exception) else None,
            }

        if symbol in COMMODITY_TOKENS:
            fg, dxy_val = await asyncio.gather(
                fear_greed(),
                dxy(),
                return_exceptions=True,
            )
            return {
                "market": "commodities",
                "fear_greed": fg if not isinstance(fg, Exception) else None,
                "dxy": dxy_val if not isinstance(dxy_val, Exception) else None,
            }

        return {"market": "unknown", "fear_greed": None}
    except Exception:
        return None
