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

# Activation live PAR VENUE : EXECUTION_LIVE_VENUES="FUTURES,MARGIN".
# Un venue absent de la liste → shadow même si EXECUTION_MODE=live.
_LIVE_VENUES = {v.strip().upper() for v in
                os.getenv("EXECUTION_LIVE_VENUES", "").split(",") if v.strip()}

_LIVE_ADAPTERS: dict[str, object] = {}  # venue → adapter, phase C

# ── Config pilotable UI : table execution_config, relue toutes les 30s.
# Priorité : la ligne DB ne s'applique que si updated_by est posé (modifiée
# via l'API) — sinon les env font foi (comportement inchangé).
_cfg_cache: dict | None = None
_cfg_ts: float = 0.0


async def _exec_config() -> dict:
    global _cfg_cache, _cfg_ts
    import time
    if _cfg_cache and (time.time() - _cfg_ts) < 30:
        return _cfg_cache
    cfg = {"mode": EXECUTION_MODE, "live_venues": set(_LIVE_VENUES),
           "gate_fail_closed": os.getenv("GATE_FAIL_CLOSED") == "1",
           "source": "env"}
    try:
        from utils.db_pool import get_shared_pool
        pool = await get_shared_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT mode, live_venues, gate_fail_closed, updated_by "
                "FROM execution_config WHERE id='default'")
            if row and row["updated_by"]:
                venues = row["live_venues"] or []
                if isinstance(venues, str):
                    import json as _json
                    try:
                        venues = _json.loads(venues)
                    except ValueError:
                        venues = [v for v in venues.split(",") if v]
                cfg = {"mode": row["mode"],
                       "live_venues": set(venues),
                       "gate_fail_closed": row["gate_fail_closed"],
                       "source": "db"}
    except Exception:
        pass
    _cfg_cache = cfg
    _cfg_ts = time.time()
    return cfg


def adapters_status() -> dict:
    return {v: type(a).__name__ for v, a in _LIVE_ADAPTERS.items()}


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
    cfg = await _exec_config()

    if cfg["mode"] == "shadow":
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, None, "SHADOW", "shadow", decision)
        return {"status": "SHADOW", "qty": qty,
                "would_have_executed": decision["notional"]}

    if cfg["mode"] == "paper":
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, entry, "PAPER_FILLED", "paper",
                            decision)
        # La position PAPER elle-même est créée par l'API
        # (positions.service) — l'ordre sert de journal d'exécution.
        return {"status": "PAPER_FILLED", "qty": qty, "fill": entry}

    # live — conditions cumulatives, toutes requises :
    # 1. venue explicitement activée (EXECUTION_LIVE_VENUES / UI)
    if venue not in cfg["live_venues"]:
        return {"status": "FAILED",
                "reason": f"venue {venue} non activé pour le live"}
    # 2. garde-fou global
    if not cfg["gate_fail_closed"]:
        return {"status": "FAILED",
                "reason": "gate_fail_closed requis pour le live "
                          "(un gate silencieux ne doit jamais exécuter)"}

    if venue == "SPOT":
        # BRVM : pas d'API — instruction opérateur, confirmation manuelle
        # via POST /portfolio/orders/{id}/confirm (settlement T+3).
        oid = await _insert_order(portfolio_id, signal_id, symbol, direction,
                                  qty, entry, None, "PENDING_MANUAL", "live",
                                  decision)
        return {"status": "PENDING_MANUAL", "order_id": oid, "qty": qty,
                "reason": "venue sans API — instruction opérateur"}

    adapter = _LIVE_ADAPTERS.get(venue or "")
    if adapter is None:
        return {"status": "FAILED",
                "reason": f"no live adapter for venue {venue} — phase C"}
    try:
        fill = await adapter.place_order(symbol, direction, qty, entry,  # type: ignore
                                         stop_loss=stop_loss,
                                         take_profit=None)
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, fill.get("price"), "FILLED", "live",
                            decision)
        return {"status": "FILLED", "qty": qty, "fill": fill}
    except Exception as e:
        await _insert_order(portfolio_id, signal_id, symbol, direction,
                            qty, entry, None, "FAILED", "live", decision)
        return {"status": "FAILED", "reason": str(e)}


# Venues dont la clôture passe par le bridge MT5 d'exécution (le bridge est
# la passerelle unique MT5 — l'API l'utilise pour ouvrir, l'engine pour
# fermer; même endpoint /close filtré par magic dans les deux cas).
_MT5_VENUES = {"MARGIN", "SYNTHETIC"}
_MT5_MAGIC = 20261118


def _mt5_symbol(symbol: str) -> str:
    """'EUR/USD' → 'EURUSD' ; 'V75'/'EURUSD' inchangés."""
    return symbol.replace("/", "").upper()


async def _close_via_mt5_bridge(symbol: str) -> dict:
    """POST /close {symbol, magic} sur le bridge d'exécution — ferme
    uniquement les positions portant notre magic (jamais les manuelles)."""
    import httpx
    base = os.getenv("MT5_BRIDGE_URL", "").rstrip("/")
    token = os.getenv("MT5_BRIDGE_TOKEN", "")
    if not base or not token:
        return {"closed": False, "reason": "MT5 bridge non configuré"}
    r = await httpx.AsyncClient(timeout=10).post(
        f"{base}/close",
        json={"symbol": _mt5_symbol(symbol), "magic": _MT5_MAGIC},
        headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        return {"closed": False, "reason": f"bridge_http_{r.status_code}"}
    data = r.json()
    if data.get("error"):
        return {"closed": False, "reason": str(data["error"])}
    closed = data.get("closed") or []
    return {"closed": bool(closed), "venue": "MT5", "result": data}


async def close_venue_position(portfolio_id: str, symbol: str) -> dict:
    """Clôture côté broker d'une position live : résout le venue du symbole
    puis appelle adapter.close_position() — ou le bridge MT5 d'exécution
    pour MARGIN/SYNTHETIC (chemin unique : le bridge). Jamais d'exception
    vers le caller — retourne {"closed": bool, "reason"?: str}."""
    try:
        from utils.instrument_profile import get_instrument_profile
        profile = await get_instrument_profile(symbol)
        venue = profile.get("venue")
        if venue in _MT5_VENUES:
            return await _close_via_mt5_bridge(symbol)
        adapter = _LIVE_ADAPTERS.get(venue or "")
        if adapter is None:
            return {"closed": False,
                    "reason": f"no live adapter for venue {venue}"}
        res = await adapter.close_position(symbol)  # type: ignore
        return {"closed": True, "venue": venue, "result": res}
    except Exception as e:
        logger.error("close_venue_error", symbol=symbol, error=str(e))
        return {"closed": False, "reason": str(e)}


async def confirm_manual_order(order_id: str, fill_price: float,
                               operator: str = "manual") -> dict:
    """Confirme un ordre PENDING_MANUAL (BRVM T+3) : fill réel saisi par
    l'opérateur → statut FILLED + journal pour mesurer le slippage vs
    requested_price."""
    from utils.db_pool import get_shared_pool
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        r = await conn.execute(
            """UPDATE execution_orders
               SET status='FILLED', fill_price=$2,
                   metadata = COALESCE(metadata,'{}'::jsonb)
                              || $3::jsonb
               WHERE id=$1 AND status='PENDING_MANUAL'""",
            order_id, fill_price,
            f'{{"confirmed_by": "{operator}"}}')
    return {"ok": r == "UPDATE 1", "order_id": order_id}


def _register_adapters():
    """Enregistre les adapters live si les clés sont présentes — sinon le
    venue reste sans adapter et l'exécution live refuse explicitement."""
    try:
        from risk.adapters.binance import BinanceAdapter
        a = BinanceAdapter.from_env()
        if a:
            _LIVE_ADAPTERS["FUTURES"] = a
            _LIVE_ADAPTERS["SPOT_CRYPTO"] = a
    except Exception as e:
        logger.info("adapter_binance_unavailable", error=str(e))
    # Pas d'adapter SYNTHETIC : l'ancien DerivAdapter achetait des contrats
    # digitaux CALL/PUT (sémantique ≠ position directionnelle, close_position
    # non implémenté). Le CFD/synthétique passe par la voie MT5 — venue sans
    # adapter = exécution live explicitement refusée.
    try:
        from risk.adapters.oanda import OandaAdapter
        o = OandaAdapter.from_env()
        if o:
            _LIVE_ADAPTERS["MARGIN"] = o
    except Exception as e:
        logger.info("adapter_oanda_unavailable", error=str(e))
    # Pas d'adapter MT5 engine : la soumission MT5 est unique côté API
    # (Mt5Connector — sizing contrat réel, stops_level, marge, réconciliation
    # des fills ambigus). MARGIN sans adapter Oanda = fail closed.
    # L'adapter GEM (swaps on-chain signés) n'est enregistré que si la venue
    # est explicitement whiteliste : la keypair n'est pas chargée sinon.
    if "GEM" in _LIVE_VENUES:
        try:
            from risk.adapters.jupiter import JupiterAdapter
            j = JupiterAdapter.from_env()
            if j:
                _LIVE_ADAPTERS["GEM"] = j
        except Exception as e:
            logger.info("adapter_jupiter_unavailable", error=str(e))


_register_adapters()


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
        row = await conn.fetchrow(
            "SELECT id FROM execution_orders WHERE \"signalId\"=$1 AND mode=$2",
            signal_id, mode)
        return row["id"] if row else None
