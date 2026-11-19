"""
Profils de gestion découverts — C
=================================
Trois modes de gestion des positions paper gems. Le système choisit
automatiquement le profil qui a le meilleur track record réel sur les
trades clos (gem_paper_trades), exigeant ≥10 trades par profil avant
de s'écarter du défaut — sinon tout reste sur 'balanced'.

  conservative : sécurise vite (TP1 tôt, grosse sortie, SL/trail serrés)
  balanced     : règles historiques du paper trader
  runner       : laisse courir (TP1 tard, petite sortie, stops lâches)

Appliqué au paper uniquement — un profil n'a de valeur que mesurée.
"""
from __future__ import annotations

from typing import Any, Dict

from utils.logger import get_logger

logger = get_logger(__name__)

DEFAULT_PROFILE = "balanced"
MIN_TRADES_TO_SWITCH = 10

PROFILES: Dict[str, Dict[str, Any]] = {
    "conservative": {"tp1_pct": 30.0, "tp1_sell": 60, "sl_pct": -20.0,
                     "trail_dd_pct": 20.0, "time_stop_h": 48.0},
    "balanced":     {"tp1_pct": 50.0, "tp1_sell": 40, "sl_pct": -25.0,
                     "trail_dd_pct": 30.0, "time_stop_h": 72.0},
    "runner":       {"tp1_pct": 80.0, "tp1_sell": 25, "sl_pct": -30.0,
                     "trail_dd_pct": 40.0, "time_stop_h": 96.0},
}


def profile_params(name: str | None) -> Dict[str, Any]:
    return PROFILES.get(name or DEFAULT_PROFILE, PROFILES[DEFAULT_PROFILE])


def best_profile(stats: Dict[str, Dict[str, float]]) -> str:
    """Règle pure : meilleur avg_pnl parmi les profils à ≥MIN_TRADES_TO_SWITCH
    trades, sinon défaut. Testable sans DB."""
    best, best_pnl = DEFAULT_PROFILE, None
    for name, s in stats.items():
        if name not in PROFILES or (s.get("n") or 0) < MIN_TRADES_TO_SWITCH:
            continue
        pnl = s.get("avg_pnl")
        if pnl is not None and (best_pnl is None or pnl > best_pnl):
            best, best_pnl = name, pnl
    return best


async def select_profile() -> str:
    """Profil pour la prochaine entrée paper : celui qui performe le mieux
    sur les trades clos, avec un minimum d'échantillon. Échec → défaut."""
    try:
        from utils.db_pool import get_shared_pool
        pool = await get_shared_pool()
        async with pool.acquire() as con:
            rows = await con.fetch("""
                SELECT COALESCE(payload->>'profile','balanced') AS profile,
                       COUNT(*)::int AS n,
                       AVG(total_perf_pct) AS avg_pnl
                FROM gem_paper_trades
                WHERE status LIKE 'CLOSED%%'
                GROUP BY 1""")
        stats = {r["profile"]: {"n": r["n"], "avg_pnl": r["avg_pnl"]}
                 for r in rows}
        chosen = best_profile(stats)
        if chosen != DEFAULT_PROFILE:
            logger.info("management_profile_selected", profile=chosen,
                        stats=stats)
        return chosen
    except Exception as exc:
        logger.debug("select_profile_fallback", error=str(exc))
        return DEFAULT_PROFILE
