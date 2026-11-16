"""Paper trading automatique sur les hidden gems.

Règles calibrées sur le backtest réel (63 tokens, nov. 2026) :
- Entrée : top gems score ≥60, pas de flag manipulation bloquant.
- TP1 +50%  → vendre 40% (sécurise le capital)
- TP2 +100% → vendre 35% (les ×2-×5 mesurés)
- TP3 +200% → vendre 15% (les ×3+ réels : +341% à +6569% mesurés)
- TP4 +500% → vendre 5% — reste une "moon bag" de 5%
- Runner    → trailing -30% depuis le pic dès TP1 : la moitié des tokens
  ayant peaké ≥300% a rendu presque tous les gains (+1189% → -1%)
- Stop loss → -25% depuis l'entrée (la moitié des losers ne revient pas)
- Time stop → 72h sans TP1 → sortie (pas de pump en 3j = probablement jamais)

Positions virtuelles dans Redis (pas d'argent réel) — mesure la stratégie
en conditions live avant toute exécution on-chain.
"""
from __future__ import annotations

import asyncio
import os
import json
import time
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

POSITIONS_SET = "gem_paper_positions"          # set "chain:addr"
POSITION_PREFIX = "gem_paper:"                 # hash json par position
CLOSED_LIST = "gem_paper_closed"               # lpush json, cap 500
VIRTUAL_SIZE_USD = 100.0

TP1_PCT, TP1_SELL = 50.0, 40
TP2_PCT, TP2_SELL = 100.0, 35
TP3_PCT, TP3_SELL = 200.0, 15
TP4_PCT, TP4_SELL = 500.0, 5   # moon bag de 5% après
TRAIL_DD_PCT = 30.0        # depuis le pic
STOP_LOSS_PCT = -25.0      # depuis l'entrée
TIME_STOP_H = 72.0         # sans TP1


def _key(chain: str, addr: str) -> str:
    return f"{(chain or '').lower()}:{addr}"


async def _client():
    from utils.cache import cache
    return await cache.client()


_GEMS_PORTFOLIO_ID: Optional[str] = None
GEM_MAX_TOTAL_USD = float(os.getenv("GEM_MAX_TOTAL_USD", "500"))


async def _gems_portfolio() -> Optional[str]:
    """Portfolio PAPER dédié aux gems — créé une fois, réutilisé."""
    global _GEMS_PORTFOLIO_ID
    if _GEMS_PORTFOLIO_ID:
        return _GEMS_PORTFOLIO_ID
    try:
        import os as _os
        env_id = _os.getenv("GEMS_PORTFOLIO_ID")
        if env_id:
            _GEMS_PORTFOLIO_ID = env_id
            return env_id
        from utils.db_pool import get_shared_pool as get_pool
        pool = await get_pool()
        async with pool.acquire() as con:
            row = await con.fetchrow(
                "SELECT id FROM portfolios WHERE name='HiddenGems' LIMIT 1")
            if row:
                _GEMS_PORTFOLIO_ID = row["id"]
                return row["id"]
            uid = await con.fetchval(
                "SELECT id FROM users ORDER BY \"createdAt\" LIMIT 1")
            if not uid:
                return None
            pid = await con.fetchval("""
                INSERT INTO portfolios (id,name,type,currency,"initialCapital",
                                        "currentCapital","userId","createdAt","updatedAt")
                VALUES (gen_random_uuid()::text,'HiddenGems','PAPER','USD',
                        10000,10000,$1,now(),now()) RETURNING id""", uid)
            _GEMS_PORTFOLIO_ID = pid
            logger.info("gems_portfolio_created", id=pid)
            return pid
    except Exception as e:
        logger.warning("gems_portfolio_failed", error=str(e))
        return None


async def maybe_open_position(gem: Dict[str, Any]) -> None:
    """Ouvre une position papier si le token remplit le profil d'entrée
    et n'est pas déjà tracké. Appelé depuis discover_hidden_gems.
    Passe par le portfolio_gate : budget risque, marge, concentration.
    Rejet gate → position non ouverte, raison persistée."""
    addr = gem.get("token_address")
    if not addr or not gem.get("price"):
        return
    try:
        r = await _client()
        pid = _key(gem.get("chain", ""), addr)
        if await r.sismember(POSITIONS_SET, pid):
            return

        # Cap dédié gems : exposition totale ≤ GEM_MAX_TOTAL_USD
        keys = [f"{POSITION_PREFIX}{k}"
                for k in await r.smembers(POSITIONS_SET)]
        vals = await r.mget(keys) if keys else []
        open_pos = [json.loads(v) for v in vals if v]
        exposure = sum(p.get("size_usd", 0) * p.get("remaining_pct", 0) / 100
                       for p in open_pos)
        if exposure + VIRTUAL_SIZE_USD > GEM_MAX_TOTAL_USD:
            logger.info("gem_skip_exposure_cap", symbol=gem.get("symbol"),
                        exposure=round(exposure))
            return

        # Gate portefeuille — SL −25% (règle du paper trader)
        pfid = await _gems_portfolio()
        gate: Dict[str, Any] = {"allow": True}
        if pfid:
            try:
                from risk.portfolio_gate import can_open_position
                gate = await can_open_position(
                    pfid, gem.get("symbol", ""), "BUY",
                    float(gem["price"]), float(gem["price"]) * 0.75)
            except Exception as e:
                logger.debug("gem_gate_error", error=str(e))
            if not gate.get("allow"):
                logger.info("gem_gate_rejected", symbol=gem.get("symbol"),
                            layers=[x["layer"] for x in gate.get("rejections", [])])
                return
        pos = {
            "id": pid,
            "chain": gem.get("chain", ""),
            "address": addr,
            "symbol": gem.get("symbol", ""),
            "name": gem.get("name", ""),
            "entry_price": float(gem["price"]),
            "entry_ts": int(time.time()),
            "entry_score": gem.get("gem_score"),
            "entry_liq": gem.get("liquidity"),
            "entry_vol": gem.get("volume_24h"),
            "size_usd": (gate.get("notional") or VIRTUAL_SIZE_USD),
            "remaining_pct": 100.0,
            "gate": gate.get("state_summary"),
            "max_price": float(gem["price"]),
            "status": "OPEN",
            "tp1_hit": False,
            "tp2_hit": False,
            "tp3_hit": False,
            "tp4_hit": False,
            "realized_pct": 0.0,
        }
        await r.set(f"{POSITION_PREFIX}{pid}", json.dumps(pos), ex=30 * 24 * 3600)
        await r.sadd(POSITIONS_SET, pid)
    except Exception as exc:
        logger.debug("gem_paper_open_failed", error=str(exc))


async def _fetch_prices(addrs: List[str]) -> Dict[str, float]:
    """Prix courant par token_address via DexScreener (batch ≤30)."""
    import httpx
    prices: Dict[str, float] = {}
    for i in range(0, len(addrs), 30):
        chunk = addrs[i : i + 30]
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                r = await client.get(
                    f"https://api.dexscreener.com/latest/dex/tokens/{','.join(chunk)}"
                )
                r.raise_for_status()
            best: Dict[str, float] = {}
            for p in (r.json() or {}).get("pairs") or []:
                liq = float((p.get("liquidity") or {}).get("usd") or 0)
                for side in ("baseToken", "quoteToken"):
                    tok = p.get(side) or {}
                    a = tok.get("address")
                    if a and liq >= best.get(a, (0, 0))[0]:
                        best[a] = (liq, float(p.get("priceUsd") or 0))
            prices.update({a: px for a, (_, px) in best.items() if px})
        except Exception as exc:
            logger.debug("gem_paper_price_fetch_failed", error=str(exc))
    return prices


async def _close(r, pid: str, pos: Dict[str, Any], price: float, reason: str) -> None:
    perf = (price - pos["entry_price"]) / pos["entry_price"] * 100
    # Perf totale = parties vendues (realized) + restant au prix courant
    total = pos["realized_pct"] + perf * pos["remaining_pct"] / 100
    pos.update({
        "status": reason,
        "exit_price": price,
        "exit_ts": int(time.time()),
        "total_perf_pct": round(total, 2),
    })
    await r.delete(f"{POSITION_PREFIX}{pid}")
    await r.srem(POSITIONS_SET, pid)
    await r.lpush(CLOSED_LIST, json.dumps(pos))
    await r.ltrim(CLOSED_LIST, 0, 499)
    await _persist_closed_trade(pos)


_DB_READY = False


async def _persist_closed_trade(pos: Dict[str, Any]) -> None:
    """Historise le trade clos en Postgres — les listes Redis sont bornées
    (500 entrées) et volatiles : sans ça le win rate paper n'est mesurable
    que sur une fenêtre glissante et disparaît au flush."""
    global _DB_READY
    try:
        from utils.db_pool import get_shared_pool as get_pool
        pool = await get_pool()
        async with pool.acquire() as con:
            if not _DB_READY:
                await con.execute("""
                    CREATE TABLE IF NOT EXISTS gem_paper_trades (
                        id BIGSERIAL PRIMARY KEY,
                        chain TEXT NOT NULL,
                        token_address TEXT NOT NULL,
                        symbol TEXT,
                        entry_price DOUBLE PRECISION,
                        exit_price DOUBLE PRECISION,
                        entry_ts TIMESTAMPTZ,
                        exit_ts TIMESTAMPTZ,
                        status TEXT,
                        total_perf_pct DOUBLE PRECISION,
                        realized_pct DOUBLE PRECISION,
                        gem_score INT,
                        payload JSONB,
                        created_at TIMESTAMPTZ DEFAULT now()
                    )""")
                await con.execute("""
                    CREATE INDEX IF NOT EXISTS gem_paper_trades_ts_idx
                    ON gem_paper_trades (exit_ts DESC)""")
                _DB_READY = True
            await con.execute("""
                INSERT INTO gem_paper_trades
                    (chain, token_address, symbol, entry_price, exit_price,
                     entry_ts, exit_ts, status, total_perf_pct, realized_pct,
                     gem_score, payload)
                VALUES ($1,$2,$3,$4,$5,to_timestamp($6),to_timestamp($7),$8,$9,$10,$11,$12::jsonb)""",
                pos.get("chain", ""), pos.get("address", ""), pos.get("symbol"),
                pos.get("entry_price"), pos.get("exit_price"),
                pos.get("entry_ts") or 0, pos.get("exit_ts") or 0,
                pos.get("status"), pos.get("total_perf_pct"),
                pos.get("realized_pct"), pos.get("entry_score"),
                json.dumps(pos))
    except Exception as exc:
        logger.warning("gem_paper_db_persist_failed", error=str(exc))


async def _notify(pid: str, pos: Dict[str, Any], price: float, level: str, sell_pct: int = 0) -> None:
    perf = (price - pos["entry_price"]) / pos["entry_price"] * 100
    messages = {
        "TP1": "🎯 TP1 +50% — vendre 40%",
        "TP2": "🎯 TP2 +100% — vendre 35% supplémentaires",
        "TP3": "🚀 TP3 +200% — vendre 15%, runner activé",
        "TP4": "🌙 TP4 +500% — vendre 5%, moon bag conservée",
        "TRAIL": "📉 Trailing stop -30% depuis le pic — sortir",
        "SL": "🛑 Stop loss -25% — sortir",
        "TIME": "⏰ Time stop 72h sans mouvement — sortir",
    }
    from utils.push_notify import broadcast_once
    await broadcast_once(
        f"gem_paper:{pid}:{level}",
        f"{messages[level].split(' — ')[0]} {pos['symbol']}",
        f"{pos['name']} ({pos['chain']}): {messages[level].split(' — ')[1]} "
        f"— perf actuelle {perf:+.1f}% (entrée score {pos.get('entry_score')})",
        {"type": "gem_paper", "level": level, "symbol": pos["symbol"],
         "chain": pos["chain"], "price": price, "entry_price": pos["entry_price"],
         "perf_pct": round(perf, 1), "token_address": pos["address"]},
        cooldown_seconds=7 * 24 * 3600,  # un seul push par position+niveau
    )


async def check_positions() -> Dict[str, int]:
    """Boucle principale : évalue toutes les positions ouvertes contre
    les règles TP/SL/time-stop, notifie et clôture."""
    stats = {"checked": 0, "closed": 0, "tp": 0}
    try:
        r = await _client()
        pids = [p.decode() if isinstance(p, bytes) else p
                for p in await r.smembers(POSITIONS_SET)]
        if not pids:
            return stats

        raws = await asyncio.gather(
            *(r.get(f"{POSITION_PREFIX}{p}") for p in pids), return_exceptions=True
        )
        positions: List[Dict[str, Any]] = []
        for raw in raws:
            if isinstance(raw, (bytes, str)):
                positions.append(json.loads(raw))
        if not positions:
            return stats

        prices = await _fetch_prices([p["address"] for p in positions])
        now = int(time.time())

        for pos in positions:
            price = prices.get(pos["address"])
            if not price:
                continue
            stats["checked"] += 1
            pid = pos["id"]
            entry, max_px = pos["entry_price"], pos["max_price"]
            perf = (price - entry) / entry * 100
            if price > max_px:
                pos["max_price"] = price
                max_px = price
            dd_from_peak = (price - max_px) / max_px * 100
            age_h = (now - pos["entry_ts"]) / 3600

            # Sorties
            if dd_from_peak <= -TRAIL_DD_PCT and pos["tp1_hit"]:
                await _notify(pid, pos, price, "TRAIL")
                await _close(r, pid, pos, price, "CLOSED_TRAIL")
                stats["closed"] += 1
                continue
            if perf <= STOP_LOSS_PCT:
                await _notify(pid, pos, price, "SL")
                await _close(r, pid, pos, price, "CLOSED_SL")
                stats["closed"] += 1
                continue
            if age_h >= TIME_STOP_H and not pos["tp1_hit"]:
                await _notify(pid, pos, price, "TIME")
                await _close(r, pid, pos, price, "CLOSED_TIME")
                stats["closed"] += 1
                continue

            # Prises de profit
            if not pos["tp1_hit"] and perf >= TP1_PCT:
                pos["tp1_hit"] = True
                pos["remaining_pct"] -= TP1_SELL
                pos["realized_pct"] += TP1_PCT * TP1_SELL / 100
                await _notify(pid, pos, price, "TP1")
                stats["tp"] += 1
            if pos["tp1_hit"] and not pos["tp2_hit"] and perf >= TP2_PCT:
                pos["tp2_hit"] = True
                pos["remaining_pct"] -= TP2_SELL
                pos["realized_pct"] += TP2_PCT * TP2_SELL / 100
                await _notify(pid, pos, price, "TP2")
                stats["tp"] += 1
            if pos["tp2_hit"] and not pos["tp3_hit"] and perf >= TP3_PCT:
                pos["tp3_hit"] = True
                pos["remaining_pct"] -= TP3_SELL
                pos["realized_pct"] += TP3_PCT * TP3_SELL / 100
                await _notify(pid, pos, price, "TP3")
                stats["tp"] += 1
            if pos["tp3_hit"] and not pos["tp4_hit"] and perf >= TP4_PCT:
                pos["tp4_hit"] = True
                pos["remaining_pct"] -= TP4_SELL
                pos["realized_pct"] += TP4_PCT * TP4_SELL / 100
                await _notify(pid, pos, price, "TP4")
                stats["tp"] += 1

            await r.set(f"{POSITION_PREFIX}{pid}", json.dumps(pos))
    except Exception as exc:
        logger.warning("gem_paper_check_failed", error=str(exc))
    return stats


async def paper_stats() -> Dict[str, Any]:
    """GET /ml/gem-paper/stats — positions ouvertes + historique des closes."""
    try:
        r = await _client()
        pids = [p.decode() if isinstance(p, bytes) else p
                for p in await r.smembers(POSITIONS_SET)]
        raws = await asyncio.gather(
            *(r.get(f"{POSITION_PREFIX}{p}") for p in pids), return_exceptions=True
        )
        open_pos = [json.loads(x) for x in raws if isinstance(x, (bytes, str))]
        closed_raw = await r.lrange(CLOSED_LIST, 0, 99)
        closed = [json.loads(x) for x in closed_raw]
    except Exception:
        return {"status": "unavailable", "open": [], "closed": []}

    perfs = [c.get("total_perf_pct", 0) for c in closed]
    wins = [p for p in perfs if p > 0]
    return {
        "status": "ok" if closed else "collecting",
        "open_count": len(open_pos),
        "closed_count": len(closed),
        "win_rate_pct": round(len(wins) / len(perfs) * 100, 1) if perfs else None,
        "avg_perf_pct": round(sum(perfs) / len(perfs), 1) if perfs else None,
        "best": round(max(perfs), 1) if perfs else None,
        "worst": round(min(perfs), 1) if perfs else None,
        "open": sorted(open_pos, key=lambda p: p["entry_ts"], reverse=True)[:50],
        "closed": sorted(closed, key=lambda p: p.get("exit_ts", 0), reverse=True)[:50],
    }
