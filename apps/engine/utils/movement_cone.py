"""Cône de mouvement — objectifs probabilistes ±σ par horizon.

À partir de la volatilité réalisée des bougies, projette les bornes où le
prix a statistiquement 68% / 95% de chances de se trouver à 1, 4 et 24
périodes — la référence honnête pour juger si un TP est plausible et si un
SL vit ou meurt dans le bruit.

    σ(horizon N bougies) = σ(1 bougie) × √N   (marche aléatoire)

Ne prédit PAS la direction — le cône est symétrique. Il mesure l'amplitude.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Horizons en nombre de bougies (relatif au timeframe analysé)
_HORIZONS = {"1x": 1, "4x": 4, "24x": 24}
_Z = {"p68": 1.0, "p95": 2.0}
MIN_CANDLES = 30


def movement_cone(df: pd.DataFrame) -> dict | None:
    """Bornes ±1σ/2σ en % pour 1/4/24 bougies + position actuelle en z-score.

    Retourne None si données insuffisantes. Sortie :
      { "sigma_pct": 0.42, "price_z": 1.8,
        "1x": {"p68": 0.42, "p95": 0.84}, "4x": {...}, "24x": {...} }
    """
    if df is None or len(df) < MIN_CANDLES:
        return None
    close = df["close"].astype(float)
    rets = np.log(close / close.shift(1)).dropna()
    if len(rets) < MIN_CANDLES - 1:
        return None

    sigma = float(rets.std())
    if not np.isfinite(sigma) or sigma <= 0:
        return None

    # Position actuelle du prix en unités σ sur la fenêtre (contexte :
    # "on est déjà à +1.8σ" → signal en bout de course)
    mu = float(rets.mean())
    last_ret = float(rets.iloc[-1])
    price_z = round((last_ret - mu) / sigma, 2)

    out = {
        "sigma_pct": round(sigma * 100, 3),
        "mean_ret_pct": round(mu * 100, 4),
        "price_z": price_z,
        "drift_bias": "up" if mu > sigma * 0.1 else ("down" if mu < -sigma * 0.1 else "flat"),
    }
    for label, n in _HORIZONS.items():
        s = sigma * np.sqrt(n) * 100
        out[label] = {"p68": round(s, 3), "p95": round(2 * s, 3), "n_candles": n}
    return out


def tp_feasibility(tp_pct: float | None, cone: dict | None, horizon: str = "4x") -> str | None:
    """Juge si un objectif en % est atteignable dans le cône à l'horizon donné.
    → "HIGH" (dans le cône 68), "MEDIUM" (68-95), "LOW" (au-delà de 95%)."""
    if tp_pct is None or cone is None:
        return None
    band = cone.get(horizon)
    if not band:
        return None
    a = abs(tp_pct)
    if a <= band["p68"]:
        return "HIGH"
    if a <= band["p95"]:
        return "MEDIUM"
    return "LOW"
