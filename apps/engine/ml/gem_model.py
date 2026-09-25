"""Modèle de détection auto-amélioré — régression logistique (numpy only).

Boucle d'apprentissage :
- Les snapshots 30min enregistrent les features + le prix.
- train_gem_model() labellise chaque snapshot : win = prix +20% dans ~24h.
- Le modèle est stocké en Redis (poids + normalisation) et se réentraîne
  chaque nuit → la probabilité affichée s'améliore au fil des données.
- ml_win_prob = proba que le token gagne ≥20% dans les ~24h suivantes.
"""
import json
import math
import time
from typing import Any, Dict, List

import numpy as np

from utils.logger import get_logger

logger = get_logger(__name__)

_MODEL_KEY = "gem:model:v1"
_MODEL_TTL = 30 * 86_400  # 30j
_model_mem: Dict[str, Any] = {"ts": 0.0, "model": None}

_HORIZON_S = 24 * 3600          # label horizon : +24h
_WIN_THRESHOLD = 1.20           # win = +20%
_MIN_SAMPLES = 200              # en dessous → status "collecting"


def _snap_features(snap: Dict[str, Any]) -> List[float]:
    """Vecteur de features extrait d'un snapshot."""
    liq = float(snap.get("liquidity") or 0)
    vol = float(snap.get("volume_24h") or 0)
    buys = float(snap.get("buys") or 0)
    sells = float(snap.get("sells") or 0)
    holders = float(snap.get("holders") or 0)
    total_tx = buys + sells
    return [
        math.log10(max(liq, 1)),
        vol / max(liq, 1),
        buys / total_tx if total_tx > 0 else 0.5,
        math.log10(max(holders, 1)),
        float(snap.get("top10_pct") or 0) / 100.0,
        float(snap.get("buzz") or 0),
        float(snap.get("narr_mom") or 0) / 100.0 if snap.get("narr_mom") is not None else 0.0,
        float(snap.get("score") or 0) / 100.0,
        float(snap.get("analyst") or 50) / 100.0,   # conviction LLM (0.5 neutre)
    ]


def _build_dataset(histories: List[List[Dict[str, Any]]]) -> tuple:
    """X, y depuis les séries (desc). Label = prix +20% à +24h."""
    X: List[List[float]] = []
    y: List[int] = []
    for hist in histories:
        if not isinstance(hist, list) or len(hist) < 3:
            continue
        for i, snap in enumerate(hist):
            p0 = float(snap.get("price") or 0)
            if not p0:
                continue
            target_ts = snap["ts"] + _HORIZON_S
            # hist est descendant : hist[:i] = snapshots plus récents que snap.
            # Premier en ordre descendant avec ts <= target = le plus proche de +24h.
            fut = next((h for h in hist[:i] if h["ts"] <= target_ts), None)
            if fut is None or fut["ts"] - snap["ts"] < _HORIZON_S * 0.75:
                continue
            p1 = float(fut.get("price") or 0)
            if not p1:
                continue
            X.append(_snap_features(snap))
            y.append(1 if p1 >= p0 * _WIN_THRESHOLD else 0)
    return X, y


async def train_gem_model(min_samples: int = _MIN_SAMPLES) -> Dict[str, Any]:
    """Entraîne le modèle sur tous les snapshots accumulés. Retourne le status."""
    try:
        from utils.cache import cache
        from ml.hidden_gems import _GEM_TRACKED_SET, _load_gem_history
        r = await cache.client()
        tracked = await r.smembers(_GEM_TRACKED_SET)
    except Exception as exc:
        return {"status": "unavailable", "error": str(exc)[:200]}

    histories = []
    for key in tracked:
        chain, addr = key.split(":", 1)
        histories.append(await _load_gem_history(chain, addr))

    X, y = _build_dataset(histories)
    if len(X) < min_samples:
        return {"status": "collecting", "samples": len(X), "needed": min_samples}

    Xa = np.array(X, dtype=np.float64)
    ya = np.array(y, dtype=np.float64)
    mean, std = Xa.mean(axis=0), Xa.std(axis=0)
    std[std == 0] = 1.0
    Xs = (Xa - mean) / std
    Xb = np.hstack([np.ones((len(Xs), 1)), Xs])

    # Régression logistique — descente de gradient simple, L2 léger
    w = np.zeros(Xb.shape[1])
    lr, epochs, l2 = 0.1, 600, 1e-3
    for _ in range(epochs):
        z = np.clip(Xb @ w, -30, 30)
        p = 1 / (1 + np.exp(-z))
        grad = Xb.T @ (p - ya) / len(ya) + l2 * w
        grad[0] -= l2 * w[0]  # pas de régul sur le biais
        w -= lr * grad

    # AUC in-sample (tri par score prédit)
    z = np.clip(Xb @ w, -30, 30)
    p = 1 / (1 + np.exp(-z))
    order = np.argsort(p)
    ranks = np.empty(len(order)); ranks[order] = np.arange(len(order))
    pos = ya == 1
    n_pos, n_neg = pos.sum(), (~pos).sum()
    auc = float((ranks[pos].sum() - n_pos * (n_pos - 1) / 2) / max(n_pos * n_neg, 1)) if n_pos and n_neg else None

    model = {
        "w": w.tolist(), "mean": mean.tolist(), "std": std.tolist(),
        "trained_at": int(time.time()), "samples": len(X),
        "win_rate": float(ya.mean()), "auc": round(auc, 3) if auc else None,
        "horizon_h": 24, "win_threshold": "+20%",
    }
    try:
        from utils.cache import cache
        r = await cache.client()
        await r.set(_MODEL_KEY, json.dumps(model), ex=_MODEL_TTL)
    except Exception as exc:
        logger.warning("gem_model_persist_failed", error=str(exc))
    _model_mem.update(ts=time.time(), model=model)
    logger.info("gem_model_trained", samples=len(X), auc=model["auc"], win_rate=model["win_rate"])
    return {"status": "trained", **{k: model[k] for k in ("samples", "win_rate", "auc", "trained_at")}}


async def load_gem_model() -> Dict[str, Any] | None:
    """Modèle courant (mémoire 1h → Redis)."""
    if _model_mem["model"] and time.time() - _model_mem["ts"] < 3600:
        return _model_mem["model"]
    try:
        from utils.cache import cache
        r = await cache.client()
        raw = await r.get(_MODEL_KEY)
        model = json.loads(raw) if raw else None
    except Exception:
        model = _model_mem["model"]
    if model:
        _model_mem.update(ts=time.time(), model=model)
    return model


def predict_win_prob(features: List[float], model: Dict[str, Any]) -> float | None:
    """Probabilité de win ≥+20%/24h — None si modèle absent."""
    if not model:
        return None
    try:
        w = np.array(model["w"]); mean = np.array(model["mean"]); std = np.array(model["std"])
        x = np.concatenate([[1.0], (np.array(features, dtype=np.float64) - mean) / std])
        z = float(np.clip(x @ w, -30, 30))
        return round(1 / (1 + math.exp(-z)), 3)
    except Exception:
        return None
