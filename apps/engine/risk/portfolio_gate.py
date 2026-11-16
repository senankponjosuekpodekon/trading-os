"""
Gate portefeuille — décision d'ouverture AVANT exécution.

Vérifie, dans l'ordre :
1. tradable (fiche instrument, couverture bougies)
2. marge libre suffisante (notional/levier ≤ cash_free)
3. budget risque portefeuille (risk_to_stop + nouveau ≤ τ×equity)
4. concentration cluster (pas un 5e pari sur la même source de risque)
5. perte scénario gap tolérable (gap_loss_total ≤ fraction d'equity)

Rejet → ligne dans gate_rejections (layer='portfolio_gate'), comme les
autres couches du pipeline. Fail-safe : en cas d'erreur DB → refuse.
"""
from utils.logger import get_logger

logger = get_logger(__name__)

_MAX_CLUSTER_POSITIONS = 3
_MAX_GAP_FRAC = 0.25  # perte gap totale ≤ 25% de l'equity


async def can_open_position(portfolio_id: str, symbol: str,
                            direction: str, entry: float,
                            stop_loss: float | None,
                            qty: float | None = None,
                            target_risk: float = 0.12) -> dict:
    """Décision d'ouverture. qty=None → taille via size_for_symbol."""
    from risk.portfolio_state import portfolio_state
    from risk.sizing import size_for_symbol
    from utils.instrument_profile import get_instrument_profile
    from routers.portfolio_risk import get_cluster

    rejections = []

    profile = await get_instrument_profile(symbol)
    if not profile.get("tradable", True):
        rejections.append({"layer": "tradable",
                           "reason": "no_candle_coverage"})

    state = await portfolio_state(portfolio_id, target_risk=target_risk)
    if state.get("error"):
        return {"allow": False, "rejections": [
            {"layer": "state", "reason": state["error"]}]}

    if qty is None:
        # σ absente des signaux actuels → proxy : distance au stop.
        # Taille = budget_risque_restant / |entry − SL|
        remaining = max(0.0, state["risk_budget"] - state["risk_to_stop_total"])
        if stop_loss and entry and abs(entry - stop_loss) > 0:
            qty = remaining / abs(entry - stop_loss)
        else:
            qty = 0.0

    notional = abs(qty) * entry if entry else 0.0
    margin_needed = notional / (profile.get("max_leverage") or 1.0)
    new_risk = (abs(entry - stop_loss) * abs(qty)
                if stop_loss else notional * 0.02)
    gap_add = notional * (0.30 if profile.get("venue") == "FUTURES" else 0.16)

    if margin_needed > state["cash_free"]:
        rejections.append({"layer": "margin",
                           "reason": f"need {margin_needed:.2f} > free {state['cash_free']:.2f}"})

    if state["risk_to_stop_total"] + new_risk > state["risk_budget"]:
        rejections.append({"layer": "risk_budget",
                           "reason": "risk_to_stop exceeded τ×equity"})

    cluster = get_cluster(symbol)
    c = state["clusters"].get(cluster)
    if c and c["n"] >= _MAX_CLUSTER_POSITIONS:
        rejections.append({"layer": "cluster",
                           "reason": f"{cluster}: {c['n']} positions ouvertes"})

    if (state["gap_loss_total"] + gap_add >
            _MAX_GAP_FRAC * state["equity"]):
        rejections.append({"layer": "gap",
                           "reason": "gap scenario > 25% equity"})

    if rejections:
        await _record_rejections(portfolio_id, symbol, direction,
                                 rejections, entry)
        return {"allow": False, "rejections": rejections,
                "qty": 0.0, "state_summary": _summary(state)}

    return {"allow": True, "rejections": [],
            "qty": round(qty, 8), "notional": round(notional, 2),
            "margin_needed": round(margin_needed, 2),
            "new_risk": round(new_risk, 2),
            "cluster": cluster, "venue": profile.get("venue"),
            "state_summary": _summary(state)}


def _summary(state: dict) -> dict:
    return {"equity": state["equity"], "cash_free": state["cash_free"],
            "risk_used_frac": state["risk_used_frac"],
            "gap_loss_frac": state["gap_loss_frac_equity"]}


async def _record_rejections(portfolio_id: str, symbol: str,
                             direction: str, rejections: list[dict],
                             entry_price: float | None):
    try:
        from utils.db_pool import get_shared_pool
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            for r in rejections:
                await conn.execute(
                    """INSERT INTO gate_rejections
                       (symbol, direction, layer, reason, entry_price, metadata)
                       VALUES ($1,$2,$3,$4,$5,$6::jsonb)""",
                    symbol, direction, "portfolio_gate", r["layer"], entry_price,
                    f'{{"detail": "{r["reason"]}", "portfolio": "{portfolio_id}"}}')
    except Exception as e:
        logger.warning("gate_rejection_persist_failed", error=str(e))
