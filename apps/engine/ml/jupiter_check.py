"""Vérification d'exécutabilité réelle pour les gems Solana (équivalent
"carnet d'ordres" DEX — les AMM n'ont pas de carnet, seulement un pool).

Jupiter quote = prix réellement exécutable maintenant, gratuit, sans clé :
  - achat $100 de SOL → token : le quote réussit et donne le prix d'impact
  - revente du token → SOL : LE test critique. Un token peut être
    "liquide" en affichage DexScreener mais impossible à revendre
    (honeypot déguisé, LP retirable, taxe de sortie).

Résultat : {sellable, buy_impact_pct, round_trip_loss_pct, route}
Seuils (empirique) : perte aller-retour >30% → probable piège ; >15% →
sortie coûteuse ; quote revente absent → rejet direct.
"""

import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

# API v6 (quote-api.jup.ag) retirée — endpoint lite officiel, gratuit sans clé.
_JUPITER_QUOTE = "https://lite-api.jup.ag/swap/v1/quote"
_SOL_MINT = "So11111111111111111111111111111111111111112"
# ~$100 en SOL à ~$140 — l'ordre de grandeur suffit : on mesure un % de
# perte, pas une valeur absolue.
_BUY_LAMPORTS = 700_000_000  # 0.7 SOL


async def _quote(client: httpx.AsyncClient, input_mint: str,
                 output_mint: str, amount: int) -> Optional[Dict[str, Any]]:
    try:
        r = await client.get(_JUPITER_QUOTE, params={
            "inputMint": input_mint,
            "outputMint": output_mint,
            "amount": str(amount),
            "slippageBps": "300",
        })
        if r.status_code == 200:
            return r.json()
    except (httpx.HTTPError, ValueError):
        pass
    return None


async def check_exit_liquidity(token_mint: str) -> Dict[str, Any]:
    """Teste l'aller-retour réel SOL → token → SOL pour ~$100.

    Retourne toujours un dict ; sellable=False si la revente est impossible
    ou si l'aller-retour perd >90% (taxe de sortie quasi-totale)."""
    result: Dict[str, Any] = {
        "sellable": None,
        "buy_impact_pct": None,
        "round_trip_loss_pct": None,
        "checked": False,
    }
    if not token_mint:
        return result

    async with httpx.AsyncClient(timeout=6.0) as client:
        # Aller : SOL → token
        buy = await _quote(client, _SOL_MINT, token_mint, _BUY_LAMPORTS)
        if not buy:
            result["sellable"] = False
            result["checked"] = True
            return result
        out_amount = int(buy.get("outAmount") or 0)
        in_amount = int(buy.get("inAmount") or _BUY_LAMPORTS)
        if out_amount <= 0:
            result["sellable"] = False
            result["checked"] = True
            return result
        # Impact achat : priceImpactPct fourni par Jupiter (fraction)
        impact = buy.get("priceImpactPct")
        if impact is not None:
            try:
                result["buy_impact_pct"] = round(abs(float(impact)) * 100.0
                                                 if abs(float(impact)) < 1 else abs(float(impact)), 2)
            except (TypeError, ValueError):
                pass

        # Retour : token → SOL (montant exact reçu à l'aller)
        sell = await _quote(client, token_mint, _SOL_MINT, out_amount)
        result["checked"] = True
        if not sell:
            result["sellable"] = False
            return result
        back_amount = int(sell.get("outAmount") or 0)
        if in_amount <= 0:
            return result
        loss_pct = (1.0 - back_amount / in_amount) * 100.0
        result["round_trip_loss_pct"] = round(loss_pct, 2)
        result["sellable"] = loss_pct < 90.0
        return result
