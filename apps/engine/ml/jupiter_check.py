"""Vérification des cotations pour les gems Solana (équivalent indicatif
au carnet DEX — les AMM n'ont pas de carnet, seulement des pools).

Jupiter quote = cotation indicative, sans wallet ni transaction :
  - achat de 0.7 SOL → token : cotation et impact en pourcentage
  - retour du token → SOL : recherche d'une cotation inverse. Un token
    affiché liquide sur DexScreener peut ne pas avoir de route inverse
    pour le montant testé, sans que cela prouve un honeypot.

Résultat : {sellable, buy_impact_pct, round_trip_loss_pct, route, status}
Seuils conservés : perte aller-retour >30% → coût élevé ; >15% →
sortie coûteuse ; absence de route inverse explicitement distinguée.
"""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from time import monotonic
from typing import Any, Dict

from utils.jupiter_quote import JupiterQuoteError, JupiterQuoteReader

logger = logging.getLogger(__name__)

# API Swap V2 : lecture seule, sans wallet, signature ni soumission.
_reader: JupiterQuoteReader | None = None
_reader_loop = None
_SOL_MINT = "So11111111111111111111111111111111111111112"
# Montant natif : 0.7 SOL, sans conversion implicite en dollars.
# Les pertes comparées restent des écarts de cotations, pas des fills.
_BUY_LAMPORTS = 700_000_000  # 0.7 SOL
_BATCH_MAX_TOKENS = 2
_BATCH_BUDGET_SECONDS = 8.0


def _get_reader() -> JupiterQuoteReader:
    global _reader, _reader_loop
    loop = asyncio.get_running_loop()
    if _reader is None or _reader_loop is not loop:
        _reader, _reader_loop = JupiterQuoteReader(), loop
    return _reader


def _empty(status: str, reason: str) -> Dict[str, Any]:
    return {"sellable": None, "buy_impact_pct": None, "round_trip_loss_pct": None,
            "checked": False, "status": status, "reason": reason,
            "source": "JUPITER_SWAP_V2", "quote_only": True, "execution_enabled": False,
            "probe_mint": _SOL_MINT, "probe_amount_raw": str(_BUY_LAMPORTS),
            "checked_at": None if status == "DEFERRED" else datetime.now(timezone.utc).isoformat(), "expires_at": None, "route": []}


async def check_exit_liquidity(token_mint: str, *, reader: JupiterQuoteReader | None = None) -> Dict[str, Any]:
    """Compare les cotations aller-retour SOL → token → SOL pour 0.7 SOL.

    Une lecture échouée reste inconnue ; sellable décrit uniquement les
    cotations obtenues, jamais une exécution ou une absence de honeypot."""
    client = reader if reader is not None else _get_reader()
    phase = "buy"
    try:
        # Aller : SOL → token
        buy = await client.get_quote(_SOL_MINT, token_mint, _BUY_LAMPORTS)
        buy.require_fresh()
        # Impact achat : priceImpact V2 est en points de pourcentage.
        impact = abs(buy.price_impact_pct) if buy.price_impact_pct is not None else None
        # Retour : token → SOL (montant exact coté à l'aller)
        phase = "sell"
        sell = await client.get_quote(token_mint, _SOL_MINT, buy.output_amount)
        buy.require_fresh()
        sell.require_fresh()
        loss_pct = float((Decimal(buy.input_amount) - Decimal(sell.output_amount)) * 100 / Decimal(buy.input_amount))
        return {**_empty("QUOTED", "ROUND_TRIP_QUOTED"), "checked": True, "sellable": loss_pct < 90,
                "buy_impact_pct": impact, "round_trip_loss_pct": loss_pct,
                "route": [buy.router, sell.router], "expires_at": min(buy.expires_at, sell.expires_at).isoformat()}
    except JupiterQuoteError as error:
        if error.code == "NO_ROUTE":
            if phase == "sell":
                try:
                    buy.require_fresh()
                except JupiterQuoteError:
                    return _empty("STALE", "EXPIRED_QUOTE")
            result = _empty("NO_ENTRY_ROUTE" if phase == "buy" else "NO_EXIT_ROUTE", "NO_ROUTE")
            if phase == "sell":
                result.update(checked=True, sellable=False)
            return result
        if error.code == "EXPIRED_QUOTE":
            return _empty("STALE", "EXPIRED_QUOTE")
        if error.code in {"FEE_LIMIT_EXCEEDED", "SLIPPAGE_LIMIT_EXCEEDED", "INVALID_RESPONSE", "UNEXPECTED_TRANSACTION_OR_WALLET"}:
            return _empty("REJECTED", error.code)
        reason = "RATE_LIMITED" if error.http_status == 429 else "READ_UNAVAILABLE"
        return _empty("UNAVAILABLE", reason)
    except ValueError:
        return _empty("INVALID_INPUT", "INVALID_MINT_OR_AMOUNT")


async def check_exit_liquidity_batch(token_mints: list[str], *, reader: JupiterQuoteReader | None = None) -> list[Dict[str, Any]]:
    client = reader if reader is not None else _get_reader()
    results = [_empty("DEFERRED", "CHECK_BUDGET") for _ in token_mints]
    deadline = monotonic() + _BATCH_BUDGET_SECONDS
    for index, mint in enumerate(token_mints[:_BATCH_MAX_TOKENS]):
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        try:
            async with asyncio.timeout(remaining):
                result = await check_exit_liquidity(mint, reader=client)
        except TimeoutError:
            results[index] = _empty("UNAVAILABLE", "BATCH_TIMEOUT")
            break
        results[index] = result
        if result.get("status") == "UNAVAILABLE":
            break
    return results
