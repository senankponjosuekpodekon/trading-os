"""Timeframe hierarchy and bias constants used by the scanner."""

# Hiérarchie 3-TF : pour chaque LTF (timeframe d'exécution), définit quel TF intermédiaire
# et quel TF supérieur sont utilisés pour la confluence.
# Format : LTF -> (MTF, HTF)
_TF_HIERARCHY: dict[str, tuple[str, str]] = {
    "5m":  ("1h",  "4h"),
    "15m": ("1h",  "4h"),
    "1h":  ("4h",  "1d"),
    "4h":  ("1d",  "1w"),   # HTF = Weekly pour le 4h
    "1d":  ("1w",  "1w"),   # Pour le daily, MTF=Weekly, HTF=Weekly (fallback)
}

# Bias TF : toujours calculer la tendance générale D1 + Weekly, quel que soit le TF d'exécution.
# Ces regimes sont utilisés comme couche de bias (bonus/malus léger) et non comme filtre bloquant.
_BIAS_TF: tuple[str, str] = ("1d", "1w")
