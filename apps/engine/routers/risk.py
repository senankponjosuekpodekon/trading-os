"""
Jour 11 — Risk Engine
- Calcul taille de position (% risque sur capital)
- R/R dynamique selon régime
- Ajustement SL/TP selon ATR
- Vérification calendrier news (stub - extensible)
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


# ─── Modèles ──────────────────────────────────────────────────────────────────

class RiskCalcRequest(BaseModel):
    capital:        float          # Capital disponible ($)
    entry_price:    float          # Prix d'entrée
    stop_loss:      float          # Stop loss
    direction:      str            # BUY | SELL
    risk_pct:       float = 1.0    # % du capital à risquer (défaut 1%)
    atr:            Optional[float] = None
    regime:         Optional[str]  = None  # TRENDING_BULL | TRENDING_BEAR | RANGING | VOLATILE
    confidence:     Optional[float] = None

class RiskCalcResponse(BaseModel):
    position_size:   float   # Quantité à acheter
    cost:            float   # Coût total de la position
    risk_amount:     float   # $ à risquer
    risk_pct_actual: float   # % réel sur capital
    take_profit_1:   float
    take_profit_2:   float
    risk_reward:     float
    regime_adj:      str     # Explication ajustement régime
    warnings:        list[str]


# ─── Logique ──────────────────────────────────────────────────────────────────

def calc_position_size(
    capital: float,
    entry: float,
    stop: float,
    risk_pct: float = 1.0,
) -> tuple[float, float, float]:
    """
    Retourne (position_size, risk_amount, cost).
    risk_amount = capital * risk_pct / 100
    position_size = risk_amount / |entry - stop|
    """
    risk_amount   = capital * risk_pct / 100
    sl_distance   = abs(entry - stop)
    if sl_distance == 0:
        return 0.0, 0.0, 0.0
    position_size = risk_amount / sl_distance
    cost          = position_size * entry
    return round(position_size, 6), round(risk_amount, 2), round(cost, 2)


def calc_targets(
    entry: float,
    stop: float,
    direction: str,
    rr1: float = 2.0,
    rr2: float = 3.0,
    atr: Optional[float] = None,
) -> tuple[float, float]:
    """
    Calcule TP1 et TP2 selon R/R ou ATR.
    """
    sl_dist = abs(entry - stop)

    if atr:
        tp1_dist = atr * 2.0
        tp2_dist = atr * 3.5
    else:
        tp1_dist = sl_dist * rr1
        tp2_dist = sl_dist * rr2

    if direction == "BUY":
        tp1 = entry + tp1_dist
        tp2 = entry + tp2_dist
    else:
        tp1 = entry - tp1_dist
        tp2 = entry - tp2_dist

    return round(tp1, 6), round(tp2, 6)


def regime_risk_adjustment(
    regime: Optional[str],
    base_risk_pct: float,
    confidence: Optional[float],
) -> tuple[float, float, float, str]:
    """
    Adapte le % de risque selon régime et confiance.
    Retourne (risk_pct, rr1, rr2, explanation).
    """
    risk_pct = base_risk_pct
    rr1, rr2 = 2.0, 3.0
    notes    = []

    if regime == "VOLATILE":
        risk_pct *= 0.5
        notes.append("Régime VOLATILE : risque divisé par 2")
    elif regime == "RANGING":
        risk_pct *= 0.75
        rr1, rr2 = 1.5, 2.5
        notes.append("Régime RANGING : risque -25%, R/R réduit")
    elif regime in ("TRENDING_BULL", "TRENDING_BEAR"):
        rr1, rr2 = 2.5, 4.0
        notes.append(f"Régime {regime} : R/R étendu (2.5x / 4x)")

    if confidence is not None:
        if confidence >= 80:
            risk_pct = min(risk_pct * 1.25, base_risk_pct * 1.5)
            notes.append(f"Confiance élevée ({confidence}%) : risque +25%")
        elif confidence < 55:
            risk_pct *= 0.5
            notes.append(f"Confiance faible ({confidence}%) : risque -50%")

    return round(risk_pct, 3), rr1, rr2, " | ".join(notes) or "Paramètres standards"


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/risk/calculate", response_model=RiskCalcResponse)
def calculate_risk(req: RiskCalcRequest):
    warnings = []

    # Ajustement régime
    adj_risk, rr1, rr2, adj_note = regime_risk_adjustment(
        req.regime, req.risk_pct, req.confidence
    )

    # Protection capital minimal
    if adj_risk < 0.1:
        adj_risk = 0.1
        warnings.append("Risque ajusté au minimum 0.1%")

    if adj_risk > 3.0:
        adj_risk = 3.0
        warnings.append("Risque plafonné à 3% par trade")

    # Taille position
    pos_size, risk_amt, cost = calc_position_size(
        req.capital, req.entry_price, req.stop_loss, adj_risk
    )

    if pos_size == 0:
        warnings.append("SL == entry : position impossible")

    # Vérification coût vs capital
    if cost > req.capital:
        max_size  = req.capital / req.entry_price
        pos_size  = round(max_size, 6)
        cost      = round(req.capital, 2)
        warnings.append("Position réduite : coût plafonné au capital disponible")

    # Targets
    tp1, tp2 = calc_targets(
        req.entry_price, req.stop_loss, req.direction, rr1, rr2, req.atr
    )

    sl_dist = abs(req.entry_price - req.stop_loss)
    if req.direction == "BUY":
        tp1_dist = tp1 - req.entry_price
    else:
        tp1_dist = req.entry_price - tp1
    rr_actual = round(tp1_dist / sl_dist, 2) if sl_dist > 0 else 0

    return RiskCalcResponse(
        position_size   = pos_size,
        cost            = cost,
        risk_amount     = risk_amt,
        risk_pct_actual = adj_risk,
        take_profit_1   = tp1,
        take_profit_2   = tp2,
        risk_reward     = rr_actual,
        regime_adj      = adj_note,
        warnings        = warnings,
    )
