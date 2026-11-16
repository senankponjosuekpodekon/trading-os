"""
Exécuteur multi-venue — phase contrôlée.

Modes (env EXECUTION_MODE, défaut 'shadow') :
- shadow : ordre loggé dans execution_orders, RIEN d'exécuté — mesure
  ce qui aurait été exécuté (prix, taille, rejets gate)
- paper  : ordre enregistré PAPER_FILLED au mark — la position PAPER
  reste créée côté API (positions.service), l'ordre sert de journal
  d'exécution pour mesurer le slippage plus tard
- live   : refuse sauf adapter venue implémenté + clés présentes —
  aucun adapter réel n'est encore écrit (phase C)

Unique(signalId, mode) → idempotent : rejouer le même signal ne
duplique pas l'ordre.
"""
import os

from utils.logger import get_logger

logger = get_logger(__name__)

EXECUTION_MODE = os.getenv("EXECUTION_MODE", "shadow").lower()

_LIVE_ADAPTERS: dict[str, object] = {}  # venue → adapter, phase C


async def execute_signal(portfolio_id: str, signal_id: str | None,
                         symbol: str, direction: str, entry: float,
                         stop_loss: float | None,
                         qty: float | None = None,
                         target_risk: float = 0.12) -> dict:
    """Pipeline : gate → size → order. Jamais d'exception vers le caller."""
    try:
        from risk.portfolio_gate import can_open_position
        decision = await can_open_position(
            portfolio_id, symbol, direction, entry, stop_loss,
            qty=qty, target_risk=target_risk)
    except Exception as e:
        logger.error("executor_gate_error", error=str(e))
        return {"status": "FAILED", "reason": f"gate_error: {e}"}

    if not decision["allow"]:
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty or 0.0, entry, None, "REJECTED",
                            "gate", decision)
        return {"status": "REJECTED",
                "rejections": decision["rejections"]}

    qty = decision["qty"]
    venue = decision.get("venue")

    if EXECUTION_MODE == "shadow":
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, None, "SHADOW", "shadow", decision)
        return {"status": "SHADOW", "qty": qty,
                "would_have_executed": decision["notional"]}

    if EXECUTION_MODE == "paper":
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, entry, "PAPER_FILLED", "paper",
                            decision)
        # La position PAPER elle-même est créée par l'API
        # (positions.service) — l'ordre sert de journal d'exécution.
        return {"status": "PAPER_FILLED", "qty": qty, "fill": entry}

    # live
    adapter = _LIVE_ADAPTERS.get(venue or "")
    if adapter is None:
        return {"status": "FAILED",
                "reason": f"no live adapter for venue {venue} — phase C"}
    return {"status": "FAILED", "reason": "live adapters not implemented"}


async def _insert_order(portfolio_id, signal_id, symbol, direction, qty,
                        req_price, fill_price, status, mode, extra):
    from utils.db_pool import get_shared_pool
    import json
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO execution_orders
               ("portfolioId","signalId",symbol,direction,qty,
                requested_price,fill_price,status,mode,venue,metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
               ON CONFLICT ("signalId", mode) DO NOTHING""",
            portfolio_id, signal_id, symbol, direction, qty,
            req_price, fill_price, status, mode,
            extra.get("venue"), json.dumps(extra.get("state_summary") or {}))
