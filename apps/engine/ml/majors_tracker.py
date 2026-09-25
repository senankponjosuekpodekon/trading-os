"""
Majors Tracker — tracking longitudinal des crypto majors (top 30 CoinGecko).

Même mécanisme que hidden_gems : snapshots périodiques dans Redis (14j),
trajectoire calculée sur la série. Pour les majors, la valeur ajoutée est
la VÉLOCITÉ : le prix/variation CoinGecko ne dit pas si le volume accélère
ou s'épuise — la série de snapshots, si.

Appelé par cron_majors_tracker (30 min) et à la demande par l'endpoint —
chaque appel nourrit la série.
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

_MAJOR_SNAPSHOT_TTL = 14 * 86400
_MAJOR_SNAPSHOT_MAX = 300
_MAJOR_TRACKED_SET = "major_tracked"


def _major_key(gecko_id: str) -> str:
    return f"major_snapshots:{gecko_id}"


async def snapshot_majors(top_n: int = 30) -> int:
    """Snapshot price/mcap/volume des top coins CoinGecko → Redis."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={
                    "vs_currency": "usd",
                    "order": "market_cap_desc",
                    "per_page": top_n,
                    "price_change_percentage": "7d",
                },
            )
            r.raise_for_status()
            coins = r.json()
    except Exception as exc:
        logger.debug("majors_snapshot_fetch_failed", error=str(exc))
        return 0

    try:
        from utils.cache import cache
        r = await cache.client()
    except Exception:
        return 0

    now = int(time.time())
    count = 0
    for c in coins:
        gid = c.get("id")
        if not gid:
            continue
        snap = {
            "ts": now,
            "price": c.get("current_price"),
            "mcap": c.get("market_cap"),
            "volume": c.get("total_volume"),
            "change_7d": c.get("price_change_percentage_7d_in_currency"),
        }
        try:
            await r.lpush(_major_key(gid), json.dumps(snap))
            await r.ltrim(_major_key(gid), 0, _MAJOR_SNAPSHOT_MAX - 1)
            await r.expire(_major_key(gid), _MAJOR_SNAPSHOT_TTL)
            await r.sadd(
                _MAJOR_TRACKED_SET,
                json.dumps({"id": gid, "symbol": (c.get("symbol") or "").upper(),
                            "name": c.get("name")}),
            )
            count += 1
        except Exception:
            continue
    return count


async def _load_major_history(gecko_id: str) -> List[Dict[str, Any]]:
    try:
        from utils.cache import cache
        r = await cache.client()
        raw = await r.lrange(_major_key(gecko_id), 0, _MAJOR_SNAPSHOT_MAX - 1)
        return [json.loads(x) for x in raw]
    except Exception:
        return []


def _major_trajectory(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Trajectoire mesurée depuis les snapshots — croissance prix/volume/mcap."""
    if len(history) < 2:
        return {"snapshots": len(history), "tracked_hours": 0.0}

    newest, oldest = history[0], history[-1]
    span_h = max((newest["ts"] - oldest["ts"]) / 3600, 0.01)

    def _pct(field: str) -> Optional[float]:
        old, new = oldest.get(field) or 0, newest.get(field) or 0
        return round((new - old) / old * 100, 2) if old else None

    # Tendance volume : moyenne des 12 snapshots récents vs 12 précédents
    vols = [s.get("volume") or 0 for s in history if s.get("volume")]
    vol_trend = None
    if len(vols) >= 24:
        recent, prior = sum(vols[:12]) / 12, sum(vols[12:24]) / 12
        vol_trend = round((recent - prior) / prior * 100, 1) if prior else None

    return {
        "snapshots": len(history),
        "tracked_hours": round(span_h, 1),
        "price_change_pct": _pct("price"),
        "mcap_change_pct": _pct("mcap"),
        "volume_trend_pct": vol_trend,
        "change_7d_coingecko": newest.get("change_7d"),
    }


def _major_comment(name: str, traj: Dict[str, Any]) -> str:
    """Commentaire déterministe — ce que la trajectoire signifie."""
    pc, vt = traj.get("price_change_pct"), traj.get("volume_trend_pct")
    parts = []
    if pc is not None:
        if pc > 15:
            parts.append(f"{name} : +{pc:.0f}% depuis le début du suivi")
        elif pc < -15:
            parts.append(f"{name} : {pc:.0f}% depuis le début du suivi")
        else:
            parts.append(f"{name} : prix stable ({pc:+.0f}%)")
    if vt is not None:
        if vt > 30 and (pc is None or abs(pc) < 10):
            parts.append("volume en forte hausse + prix stable — accumulation possible")
        elif vt > 30:
            parts.append("activité qui accélère — momentum confirmé par le volume")
        elif vt < -30 and pc and pc > 5:
            parts.append("prix en hausse sur volume déclinant — mouvement fragile")
        elif vt < -30:
            parts.append("intérêt en baisse — volume qui se tarit")
    tracked = traj.get("tracked_hours") or 0
    if tracked < 24:
        parts.append("historique encore court — trajectoire peu significative")
    return " · ".join(parts) if parts else "données insuffisantes"


async def majors_trajectory(limit: int = 15, refresh: bool = False) -> Dict[str, Any]:
    """
    Trajectoires des majors trackés. Chaque appel snapshot d'abord (la série
    s'auto-alimente comme les gems) puis calcule la trajectoire par actif.
    """
    if refresh:
        await snapshot_majors()

    try:
        from utils.cache import cache
        r = await cache.client()
        tracked = [json.loads(x) for x in await r.smembers(_MAJOR_TRACKED_SET)]
    except Exception:
        tracked = []

    if not tracked:
        # Premier démarrage : snapshot initial puis sortie "collecting"
        n = await snapshot_majors()
        return {
            "majors": [],
            "status": "collecting",
            "note": f"Premier snapshot enregistré ({n} actifs) — les trajectoires "
                    "apparaîtront à partir du prochain cycle (~30 min).",
            "fetched_at": _now_iso(),
        }

    import asyncio as _a
    histories = await _a.gather(*(_load_major_history(t["id"]) for t in tracked))

    rows = []
    for t, h in zip(tracked, histories):
        traj = _major_trajectory(h)
        rows.append({
            "id": t["id"], "symbol": t["symbol"], "name": t["name"],
            "price": (h[0].get("price") if h else None),
            "mcap": (h[0].get("mcap") if h else None),
            "change_7d_pct": traj.get("change_7d_coingecko"),
            "trajectory": traj,
            "comment": _major_comment(t["name"], traj),
        })

    # Plus significatifs d'abord : volume trend ou prix qui bouge
    def _sig(x):
        t = x["trajectory"]
        return abs(t.get("volume_trend_pct") or 0) + abs(t.get("price_change_pct") or 0)
    rows.sort(key=_sig, reverse=True)

    return {
        "majors": rows[:limit],
        "status": "ok",
        "tracked_count": len(tracked),
        "fetched_at": _now_iso(),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
