"""
Sizing adaptatif — B
====================
Module le budget de risque alloué à une ouverture selon le track record
réel des patterns similaires (market_memory : outcomes résolus TP/SL).

  win_rate ≥ 60% → ×1.2   (le setup gagne — on monte, borné)
  45–60%         → ×1.0   (neutre)
  < 40%          → ×0.5   (le setup perd — on coupe de moitié)
  < 20 samples   → ×1.0   (jamais d'ajustement sur du bruit)

Borné strictement dans [0.5, 1.2] — l'apprentissage module le risque,
il ne peut ni le supprimer ni le doubler.
"""
from __future__ import annotations

from typing import Any, Dict

from utils.logger import get_logger

logger = get_logger(__name__)

MIN_SAMPLES = 20
MULT_HIGH, MULT_MID, MULT_LOW = 1.2, 1.0, 0.5


def multiplier_from_stats(stats: Dict[str, Any]) -> Dict[str, Any]:
    """Règle pure — testable sans DB."""
    wr = stats.get("win_rate")
    n = stats.get("sample_size") or 0
    if wr is None or n < MIN_SAMPLES:
        return {"multiplier": MULT_MID, "reason": f"insufficient_samples({n})"}
    if wr >= 60:
        return {"multiplier": MULT_HIGH, "reason": f"win_rate {wr}%"}
    if wr < 40:
        return {"multiplier": MULT_LOW, "reason": f"win_rate {wr}%"}
    return {"multiplier": MULT_MID, "reason": f"win_rate {wr}%"}


async def risk_multiplier(symbol: str, signal_type: str,
                          metadata: Dict[str, Any] | None = None,
                          timeframe: str = "1h") -> Dict[str, Any]:
    """Multiplicateur de risque pour une ouverture, issu du track record.
    Échec de lecture → ×1.0 (neutre, jamais bloquant)."""
    try:
        from ml.market_memory import get_pattern_stats
        stats = await get_pattern_stats(symbol, timeframe, signal_type,
                                        metadata or {})
        out = multiplier_from_stats(stats)
        out.update({"win_rate": stats.get("win_rate"),
                    "sample_size": stats.get("sample_size")})
        return out
    except Exception as exc:
        logger.debug("adaptive_sizing_fallback", error=str(exc))
        return {"multiplier": MULT_MID, "reason": "stats_unavailable"}
