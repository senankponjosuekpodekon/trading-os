"""Adapter Jupiter — swaps on-chain Solana (venue 'GEM', hidden gems).

Env : SOLANA_PRIVATE_KEY (base58) + SOLANA_RPC_URL — requis.
Place un swap USDC→token via Jupiter Aggregator v6 (quote + swap tx
signée). Slippage borné par slippageBps.

⚠️ Honnêtement : l'exécution on-chain est la venue la plus risquée
(illiquidité, MEV, rug). L'adapter est cablé mais ne doit passer en
live qu'après preuve du pipeline complet sur venues CEX.
"""
from __future__ import annotations

import base64
import os
from typing import Optional

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)

_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
_QUOTE = "https://quote-api.jup.ag/v6"


class JupiterAdapter(VenueAdapter):
    venue = "GEM"

    def __init__(self, keypair_b58: str, rpc: str):
        self._key_b58, self._rpc = keypair_b58, rpc
        try:
            from solders.keypair import Keypair  # noqa
            self._keypair = Keypair.from_base58_string(keypair_b58)
        except Exception as e:
            raise RuntimeError(f"solders/solana requis: {e}") from e

    @classmethod
    def from_env(cls) -> Optional["JupiterAdapter"]:
        key = os.getenv("SOLANA_PRIVATE_KEY")
        rpc = os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
        if not key:
            return None
        return cls(key, rpc)

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        _ = (stop_loss, take_profit)  # swap AMM : pas d'ordre conditionnel

        # Gardes — la venue la plus risquée reste doublement verrouillée.
        if os.getenv("GEM_TRADING_DISABLED") == "1":
            raise RuntimeError("GEM trading disabled (kill switch)")
        max_trade = float(os.getenv("GEM_MAX_TRADE_USD", "25"))
        if qty > max_trade:
            raise ValueError(f"qty {qty} USD > GEM_MAX_TRADE_USD {max_trade}")

        # symbol = mint address pour les gems
        mint = symbol if len(symbol) > 20 else symbol

        # Re-check sellability JUSTE avant de signer : une route aller-retour
        # cotée il y a 30 min ne garantit rien. Un honeypot révélé entre le
        # scan et l'ordre bloque le swap.
        try:
            from ml.jupiter_check import check_exit_liquidity
            chk = await check_exit_liquidity(mint)
        except Exception as e:
            raise RuntimeError(f"pre-swap sellability check failed: {e}") from e
        if not (chk.get("checked") is True and chk.get("sellable") is True):
            raise RuntimeError(
                f"pre-swap sellability refused: {chk.get('status')}")

        slippage = min(int(os.getenv("GEM_MAX_SLIPPAGE_BPS", "300")), 500)
        lamports = int(qty * 1_000_000)  # qty en USD → USDC 6 décimales
        async with httpx.AsyncClient(timeout=15) as c:
            q = (await c.get(f"{_QUOTE}/quote", params={
                "inputMint": _USDC, "outputMint": mint,
                "amount": lamports, "slippageBps": slippage})).json()
            if "outAmount" not in q:
                raise RuntimeError(f"jupiter quote failed: {q}")
            s = (await c.post(f"{_QUOTE}/swap", json={
                "quoteResponse": q,
                "userPublicKey": str(self._keypair.pubkey()),
                "wrapAndUnwrapSol": True})).json()
            tx_b64 = s.get("swapTransaction")
            if not tx_b64:
                raise RuntimeError(f"jupiter swap build failed: {s}")
            from solders.transaction import VersionedTransaction
            tx = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
            signed = VersionedTransaction(tx.message, [self._keypair])
            res = (await c.post(self._rpc, json={
                "jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                "params": [base64.b64encode(bytes(signed)).decode(),
                           {"encoding": "base64"}]})).json()
            sig = res.get("result")
            if not sig:
                raise RuntimeError(f"rpc send failed: {res}")
            return {"price": price or 0.0, "order_id": sig,
                    "out_amount": q["outAmount"],
                    "price_impact_pct": q.get("priceImpactPct")}

    async def close_position(self, symbol: str, token_amount: float | None = None,
                             token_decimals: int = 6) -> dict:
        """Swap inverse token→USDC. token_amount en unités natives ; si
        absent → refuse (il faut le solde on-chain, à réconcilier)."""
        if not token_amount:
            raise NotImplementedError(
                "close nécessite le solde on-chain exact — à réconcilier")
        amount = int(token_amount * 10 ** token_decimals)
        async with httpx.AsyncClient(timeout=15) as c:
            q = (await c.get(f"{_QUOTE}/quote", params={
                "inputMint": symbol, "outputMint": _USDC,
                "amount": amount,
                "slippageBps": min(int(os.getenv("GEM_MAX_SLIPPAGE_BPS", "300")), 500)})).json()
            if "outAmount" not in q:
                raise RuntimeError(f"jupiter quote failed: {q}")
            s = (await c.post(f"{_QUOTE}/swap", json={
                "quoteResponse": q,
                "userPublicKey": str(self._keypair.pubkey()),
                "wrapAndUnwrapSol": True})).json()
            tx_b64 = s.get("swapTransaction")
            if not tx_b64:
                raise RuntimeError(f"jupiter swap build failed: {s}")
            from solders.transaction import VersionedTransaction
            tx = VersionedTransaction.from_bytes(base64.b64decode(tx_b64))
            signed = VersionedTransaction(tx.message, [self._keypair])
            res = (await c.post(self._rpc, json={
                "jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                "params": [base64.b64encode(bytes(signed)).decode(),
                           {"encoding": "base64"}]})).json()
            sig = res.get("result")
            if not sig:
                raise RuntimeError(f"rpc send failed: {res}")
            return {"closed": True, "order_id": sig,
                    "usdc_out": float(q["outAmount"]) / 1e6}
