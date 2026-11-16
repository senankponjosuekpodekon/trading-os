"""
État portefeuille consolidé — étapes 1+2 du portfolio engine.

Lecture seule : ne modifie rien, agrège positions ouvertes × fiches
instrument × dernières bougies pour produire l'état réel du compte :

- equity        = capital courant + PnL latent (mark-to-market)
- margin_locked = Σ notional / max_leverage (levier=1 pour le spot)
- risk_to_stop  = Σ |entry − stopLoss| × qty → vrai budget risque consommé
- par cluster   = exposition par source de risque (pas par symbole)
- par venue     = répartition FUTURES / MARGIN / SPOT / SYNTHETIC

Sert au gate (budget risque restant) et au diagnostic multi-marchés.
"""
from utils.logger import get_logger

logger = get_logger(__name__)

_GAP_CRYPTO = 0.30   # scénario krach crypto (Carver: pire que les modèles)
_GAP_DEFAULT = 0.16  # repère CHF 2015


async def _latest_close(conn, symbol: str) -> float | None:
    row = await conn.fetchrow(
        """SELECT close FROM candles
           WHERE symbol = $1 ORDER BY open_time DESC LIMIT 1""",
        symbol)
    return float(row["close"]) if row else None


async def portfolio_state(portfolio_id: str,
                          target_risk: float = 0.12) -> dict:
    """État consolidé d'un portfolio. target_risk = τ annuel du compte."""
    from utils.db_pool import get_shared_pool
    from utils.instrument_profile import get_instrument_profile
    from routers.portfolio_risk import get_cluster

    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        pf = await conn.fetchrow(
            """SELECT id, name, type, currency,
                      "initialCapital"::float AS initial_capital,
                      "currentCapital"::float AS current_capital
               FROM portfolios WHERE id = $1""", portfolio_id)
        if not pf:
            return {"error": "portfolio_not_found", "portfolio_id": portfolio_id}
        rows = await conn.fetch(
            """SELECT p.id, a.symbol, p.direction, p."entryPrice"::float AS entry,
                      p.quantity::float AS qty, p."stopLoss"::float AS sl,
                      p.pnl::float AS realized
               FROM positions p JOIN assets a ON a.id = p."assetId"
               WHERE p."portfolioId" = $1 AND p.status = 'OPEN'""",
            portfolio_id)
        symbols = [r["symbol"] for r in rows]
        closes = {s: await _latest_close(conn, s) for s in set(symbols)}

    positions, clusters, venues = [], {}, {}
    margin_locked = unrealized = risk_to_stop = 0.0

    for r in rows:
        p = await get_instrument_profile(r["symbol"])
        mark = closes.get(r["symbol"]) or r["entry"]
        sign = 1.0 if r["direction"] == "BUY" else -1.0
        notional = r["qty"] * mark
        upl = sign * (mark - r["entry"]) * r["qty"]
        lev = p.get("max_leverage") or 1.0
        margin = notional / lev
        risk = (abs(r["entry"] - r["sl"]) * r["qty"]
                if r["sl"] and r["sl"] > 0 else notional * 0.02)
        gap = notional * (_GAP_CRYPTO if p.get("venue") == "FUTURES"
                          else _GAP_DEFAULT)

        margin_locked += margin
        unrealized += upl
        risk_to_stop += risk

        cluster = get_cluster(r["symbol"])
        c = clusters.setdefault(cluster, {"notional": 0.0, "risk": 0.0,
                                          "n": 0, "symbols": []})
        c["notional"] += notional
        c["risk"] += risk
        c["n"] += 1
        c["symbols"].append(r["symbol"])

        v = venues.setdefault(p.get("venue") or "UNKNOWN",
                              {"notional": 0.0, "margin": 0.0, "n": 0})
        v["notional"] += notional
        v["margin"] += margin
        v["n"] += 1

        positions.append({
            "id": r["id"], "symbol": r["symbol"], "direction": r["direction"],
            "qty": r["qty"], "entry": r["entry"], "mark": round(mark, 8),
            "notional": round(notional, 2), "margin": round(margin, 2),
            "unrealized": round(upl, 2), "risk_to_stop": round(risk, 2),
            "gap_loss": round(gap, 2), "cluster": cluster,
            "venue": p.get("venue"), "leverage": lev,
            "stale_mark": closes.get(r["symbol"]) is None,
        })

    equity = pf["current_capital"] + unrealized
    cash_free = pf["current_capital"] - margin_locked
    risk_budget = equity * target_risk
    gap_total = sum(p["gap_loss"] for p in positions)

    return {
        "portfolio_id": portfolio_id, "name": pf["name"],
        "type": pf["type"], "currency": pf["currency"],
        "equity": round(equity, 2),
        "cash": round(pf["current_capital"], 2),
        "cash_free": round(cash_free, 2),
        "margin_locked": round(margin_locked, 2),
        "margin_ratio": round(margin_locked / equity, 4) if equity else None,
        "unrealized_pnl": round(unrealized, 2),
        "n_positions": len(positions),
        "risk_to_stop_total": round(risk_to_stop, 2),
        "risk_budget": round(risk_budget, 2),
        "risk_used_frac": (round(risk_to_stop / risk_budget, 4)
                           if risk_budget > 0 else None),
        "gap_loss_total": round(gap_total, 2),
        "gap_loss_frac_equity": (round(gap_total / equity, 4)
                                 if equity > 0 else None),
        "clusters": clusters, "venues": venues,
        "positions": positions,
    }
