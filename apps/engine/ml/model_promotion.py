"""
Auto-Promotion du scorer XGBoost — A
====================================
Le shadow mode compare les probabilités des deux modèles ; ce module mesure
leur **justesse sur outcomes réels** (win/loss résolus par feedback_loop) et
promet le meilleur — ou le rétrograde — selon un delta significatif.

Flow : shadow_predict(features, signal_id) enregistre les deux probas
→ feedback_loop résout l'outcome → record_outcome() compte qui avait raison
→ evaluate_promotion() au retrain : swap si delta ≥ seuil sur N outcomes.

Promotion = fichier flag (data/model_promotion.json), jamais de hot-swap
en mémoire : un crash repart sur le flag persisté, pas sur du volatil.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

FLAG_PATH = os.getenv("MODEL_PROMOTION_PATH", "data/model_promotion.json")
MIN_OUTCOMES = int(os.getenv("MODEL_PROMOTE_MIN", "100"))
MIN_DELTA = float(os.getenv("MODEL_PROMOTE_DELTA", "0.05"))  # 5 points

# signal_id → {"log_prob": p, "xgb_prob": p} — en attente de résolution
_pending: Dict[str, Dict[str, float]] = {}
_MAX_PENDING = 500

_outcome_stats: Dict[str, int] = {"n": 0, "xgb_correct": 0, "log_correct": 0}


def register_prediction(signal_id: Optional[str], logistic_prob: float,
                        xgb_prob: float) -> None:
    """Mémorise les deux probas pour un signal — appelé par shadow_predict."""
    if not signal_id:
        return
    if len(_pending) >= _MAX_PENDING:
        _pending.pop(next(iter(_pending)))  # FIFO
    _pending[signal_id] = {"log_prob": float(logistic_prob),
                           "xgb_prob": float(xgb_prob)}


def record_outcome(signal_id: str, outcome: str) -> bool:
    """Outcome résolu → compte quel modèle avait raison (prob ≥0.5 ↔ win).
    Retourne True si la prédiction était connue."""
    pred = _pending.pop(signal_id, None)
    if pred is None:
        return False
    win = outcome == "win"
    _outcome_stats["n"] += 1
    if (pred["xgb_prob"] >= 0.5) == win:
        _outcome_stats["xgb_correct"] += 1
    if (pred["log_prob"] >= 0.5) == win:
        _outcome_stats["log_correct"] += 1
    return True


def _accuracies() -> Dict[str, float]:
    n = max(_outcome_stats["n"], 1)
    return {"xgb": _outcome_stats["xgb_correct"] / n,
            "log": _outcome_stats["log_correct"] / n}


def active_model() -> str:
    """Modèle en production : 'logistic' par défaut, 'xgboost' si promu."""
    try:
        with open(FLAG_PATH) as f:
            return json.load(f).get("active", "logistic")
    except (OSError, ValueError):
        return "logistic"


def _write_flag(active: str, reason: str) -> None:
    os.makedirs(os.path.dirname(FLAG_PATH) or ".", exist_ok=True)
    payload = {"active": active,
               "since": datetime.now(timezone.utc).isoformat(),
               "reason": reason,
               "outcome_stats": dict(_outcome_stats)}
    tmp = FLAG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, FLAG_PATH)  # atomique : jamais de flag tronqué


def evaluate_promotion() -> Optional[Dict[str, Any]]:
    """Appelé au retrain : promet XGBoost s'il bat la logistique de ≥5pp sur
    ≥MIN_OUTCOMES outcomes réels ; rétrograde symétriquement (hystérésis
    évitant le ping-pong). Retourne la décision ou None."""
    n = _outcome_stats["n"]
    if n < MIN_OUTCOMES:
        return None
    acc = _accuracies()
    delta = acc["xgb"] - acc["log"]
    current = active_model()
    if current == "logistic" and delta >= MIN_DELTA:
        _write_flag("xgboost", f"xgb +{delta:.1%} sur {n} outcomes")
        logger.warning("model_promoted", model="xgboost", delta=round(delta, 4), n=n)
        return {"promoted": "xgboost", "delta": round(delta, 4), "n": n}
    if current == "xgboost" and delta <= -MIN_DELTA:
        _write_flag("logistic", f"logistic +{-delta:.1%} sur {n} outcomes")
        logger.warning("model_reverted", model="logistic", delta=round(delta, 4), n=n)
        return {"reverted": "logistic", "delta": round(delta, 4), "n": n}
    return None


def promotion_status() -> Dict[str, Any]:
    acc = _accuracies()
    return {"active": active_model(),
            "outcomes_scored": _outcome_stats["n"],
            "pending_predictions": len(_pending),
            "xgb_accuracy": round(acc["xgb"], 4),
            "log_accuracy": round(acc["log"], 4),
            "min_outcomes": MIN_OUTCOMES,
            "min_delta": MIN_DELTA}
