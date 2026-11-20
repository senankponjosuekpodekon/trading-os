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


# ── Couplage phase macro → sizing (niveau 3) ──────────────────────────
# La phase de rotation BTC→ETH→alts→memecoins module le risque des
# ouvertures crypto. BUY sur tous les venues ; SELL modulé uniquement
# sur les venues shortables (un SELL spot = sortie de position, neutre).
PHASE_MULT = {
    "BTC":       {"BTC": 1.10, "ETH": 0.95, "alt": 0.80},
    "ETH":       {"BTC": 1.00, "ETH": 1.10, "alt": 0.90},
    "ALTCOINS":  {"BTC": 0.95, "ETH": 1.05, "alt": 1.15},
    "MEMECOINS": {"BTC": 0.95, "ETH": 0.95, "alt": 0.75},  # fin de cycle
    "RISK_OFF":  {"BTC": 0.70, "ETH": 0.60, "alt": 0.50},
    "TRANSITION": {"BTC": 1.00, "ETH": 1.00, "alt": 1.00},
}

# Shorts spéculatifs (SELL sur venue shortable) — miroir borné de la
# phase. Conservateur : le short en crypto est structurellement plus
# risqué (funding, squeezes haussiers), donc plafond 1.15 < max BUY.
SHORT_PHASE_MULT = {
    "RISK_OFF":  {"BTC": 1.00, "ETH": 1.05, "alt": 1.15},
    "BTC":       {"BTC": 0.90, "ETH": 0.95, "alt": 1.10},  # alts saignent 1ers
    "ETH":       {"BTC": 1.00, "ETH": 0.85, "alt": 1.00},
    "ALTCOINS":  {"BTC": 1.00, "ETH": 0.95, "alt": 0.60},  # shorter en altseason
    "MEMECOINS": {"BTC": 1.00, "ETH": 1.00, "alt": 0.50},  # squeeze euphorie
    "TRANSITION": {"BTC": 1.00, "ETH": 1.00, "alt": 1.00},
}


def _crypto_bucket(symbol: str) -> str:
    base = symbol.split("/")[0]
    return "BTC" if base == "BTC" else ("ETH" if base == "ETH" else "alt")


# ── Gate Hidden Gems × phase macro ────────────────────────────────────
# Les gems sont les actifs les plus sensibles à la phase : microcaps qui
# s'effondrent en premier en risk-off, vivent de l'euphorie altseason.
# RISK_OFF → blocage total des entrées (paper-first, vérifiable).
GEM_PHASE_GATE = {
    "RISK_OFF":  {"allow": False, "mult": 0.0},
    "BTC":       {"allow": True,  "mult": 0.6},   # le capital fuit vers BTC
    "ETH":       {"allow": True,  "mult": 0.9},
    "ALTCOINS":  {"allow": True,  "mult": 1.0},
    "MEMECOINS": {"allow": True,  "mult": 1.0},   # leur phase — sélection normale
    "TRANSITION": {"allow": True, "mult": 1.0},
}


def gem_phase_gate(phase: str | None) -> Dict[str, Any]:
    """Règle pure — testable. Phase inconnue → fail-open (le paper
    continue de produire de la donnée d'apprentissage)."""
    if not phase or phase == "UNKNOWN":
        return {"allow": True, "mult": 1.0, "reason": "phase_unknown"}
    g = GEM_PHASE_GATE.get(phase)
    if not g:
        return {"allow": True, "mult": 1.0, "reason": "phase_neutral"}
    effect = "bloqué" if not g["allow"] else f"×{g['mult']}"
    return {"allow": g["allow"], "mult": g["mult"],
            "reason": f"macro_phase {phase} → {effect}"}


def phase_multiplier(signal_type: str, symbol: str,
                     phase: str | None,
                     shortable: bool = False) -> Dict[str, Any]:
    """Règle pure — testable.

    BUY : modulé par PHASE_MULT sur tous les venues.
    SELL : neutre sur spot (sortie de position) ; sur venue shortable,
    un SELL est un vrai short spéculatif → modulé par SHORT_PHASE_MULT.
    """
    if not phase or phase in ("UNKNOWN", ""):
        return {"multiplier": MULT_MID, "reason": "phase_neutral"}
    if not symbol.endswith("/USDT"):
        return {"multiplier": MULT_MID, "reason": "not_crypto"}

    if signal_type == "SELL":
        if not shortable:
            return {"multiplier": MULT_MID, "reason": "sell_exit_neutral"}
        table = SHORT_PHASE_MULT.get(phase)
        if not table:
            return {"multiplier": MULT_MID, "reason": "phase_neutral"}
        mult = table[_crypto_bucket(symbol)]
        return {"multiplier": mult,
                "reason": f"short macro_phase {phase} ×{mult}"}

    if signal_type != "BUY":
        return {"multiplier": MULT_MID, "reason": "phase_neutral"}

    table = PHASE_MULT.get(phase)
    if not table:
        return {"multiplier": MULT_MID, "reason": "phase_neutral"}
    bucket = _crypto_bucket(symbol)
    mult = table[bucket]
    return {"multiplier": mult,
            "reason": f"macro_phase {phase} → {bucket} ×{mult}"}


async def risk_multiplier(symbol: str, signal_type: str,
                          metadata: Dict[str, Any] | None = None,
                          timeframe: str = "1h",
                          shortable: bool = False) -> Dict[str, Any]:
    """Multiplicateur de risque pour une ouverture, issu du track record
    ET de la phase macro. Échec de lecture → ×1.0 (jamais bloquant).
    Combiné borné dans [0.5, 1.2].
    shortable=True → les SELL sont de vrais shorts, modulés par phase."""
    try:
        from ml.market_memory import get_pattern_stats
        stats = await get_pattern_stats(symbol, timeframe, signal_type,
                                        metadata or {})
        out = multiplier_from_stats(stats)
        out.update({"win_rate": stats.get("win_rate"),
                    "sample_size": stats.get("sample_size")})
    except Exception as exc:
        logger.debug("adaptive_sizing_fallback", error=str(exc))
        out = {"multiplier": MULT_MID, "reason": "stats_unavailable"}

    phase_adj = {"multiplier": MULT_MID, "reason": "phase_unavailable"}
    try:
        from utils.cache import mem_cached
        from risk.macro_rotation import compute_macro_rotation
        macro = await mem_cached("macro:rotation",
                                 lambda: compute_macro_rotation(), ttl=600)
        phase_adj = phase_multiplier(signal_type, symbol,
                                     (macro or {}).get("phase"),
                                     shortable=shortable)
    except Exception as exc:
        logger.debug("phase_sizing_fallback", error=str(exc))

    combined = out["multiplier"] * phase_adj["multiplier"]
    combined = max(MULT_LOW, min(MULT_HIGH, combined))
    out["multiplier"] = round(combined, 3)
    out["phase_multiplier"] = phase_adj["multiplier"]
    out["phase_reason"] = phase_adj["reason"]
    out["reason"] = f"{out['reason']} | {phase_adj['reason']}"
    return out
