"""
Jour 11 — Risk Engine
- Calcul taille de position (% risque sur capital)
- R/R dynamique selon régime
- Ajustement SL/TP selon ATR
- Vérification calendrier news (stub - extensible)
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional, List

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
    profile:        Optional[str]  = None  # conservative | moderate | aggressive

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


class StagedStopRequest(BaseModel):
    direction: str                # BUY | SELL
    entry_price: float
    initial_stop: float
    break_even_trigger: Optional[float] = None  # default = entry_price
    structure_stop: Optional[float] = None      # e.g. last swing high/low
    trailing_stop: Optional[float] = None       # e.g. ATR-based trailing level
    reached_tps: List[int] = Field(default_factory=list)  # [1] after TP1, [1,2] after TP2, ...


class StagedStopResponse(BaseModel):
    active_stop: float
    stage: str
    reason: str


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


def profile_risk_adjustment(
    profile: Optional[str],
    base_risk_pct: float,
    rr1: float,
    rr2: float,
) -> tuple[float, float, float, str]:
    """
    Adapte le risque et les R/R selon le profil utilisateur.

    - conservative : risque réduit, R/R conservateurs, hard cap bas
    - moderate     : paramètres standards (défaut)
    - aggressive   : risque augmenté, R/R étendus, hard cap élevé
    """
    profile = (profile or "").lower()
    notes: list[str] = []

    if profile == "conservative":
        risk_pct = min(base_risk_pct * 0.5, 1.0)
        rr1, rr2 = max(rr1 * 0.75, 1.25), max(rr2 * 0.8, 2.0)
        notes.append("Profil conservateur : risque /2, R/R réduits")
    elif profile == "aggressive":
        risk_pct = min(base_risk_pct * 1.5, 5.0)
        rr1, rr2 = rr1 * 1.25, rr2 * 1.25
        notes.append("Profil agressif : risque +50%, R/R étendus")
    else:
        risk_pct = min(base_risk_pct, 3.0)
        notes.append("Profil modéré : paramètres standards")

    return round(risk_pct, 3), rr1, rr2, " | ".join(notes)


def sl_liquidity_aware(
    entry: float,
    stop: float,
    direction: str,
    equal_highs: list[dict] = None,
    equal_lows: list[dict] = None,
    buffer_atr: Optional[float] = None,
    buffer_pct: float = 0.002,
) -> float:
    """
    Décale le SL si le niveau initial tombe sur une zone de liquidité EQH/EQL.
    BUY : SL sous le plus proche EQL.
    SELL : SL au-dessus du plus proche EQH.
    """
    equal_highs = equal_highs or []
    equal_lows = equal_lows or []
    buffer = buffer_atr or (entry * buffer_pct)

    if direction == "BUY":
        # Cherche EQL juste sous le SL initial
        lower = [z for z in equal_lows if z.get("price", float("inf")) < stop]
        if lower:
            nearest = max(lower, key=lambda z: z["price"])
            return round(nearest["price"] - buffer, 6)
        return stop
    else:
        higher = [z for z in equal_highs if z.get("price", 0.0) > stop]
        if higher:
            nearest = min(higher, key=lambda z: z["price"])
            return round(nearest["price"] + buffer, 6)
        return stop


def tp_linked_to_liquidity(
    entry: float,
    stop: float,
    direction: str,
    equal_highs: list[dict] = None,
    equal_lows: list[dict] = None,
    default_rr: float = 2.0,
) -> float:
    """
    Aligne TP1 sur le prochain EQH (BUY) ou EQL (SELL) détecté au-delà du prix d'entrée.
    Si aucune liquidité proche, retourne le TP par défaut basé sur R/R.
    """
    equal_highs = equal_highs or []
    equal_lows = equal_lows or []
    sl_dist = abs(entry - stop)

    if direction == "BUY":
        candidates = [z for z in equal_highs if z.get("price", 0.0) > entry]
        if candidates:
            target = min(candidates, key=lambda z: z["price"])
            return round(target["price"], 6)
        return round(entry + default_rr * sl_dist, 6)
    else:
        candidates = [z for z in equal_lows if z.get("price", float("inf")) < entry]
        if candidates:
            target = max(candidates, key=lambda z: z["price"])
            return round(target["price"], 6)
        return round(entry - default_rr * sl_dist, 6)


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
    adj_risk, rr1, rr2, regime_note = regime_risk_adjustment(
        req.regime, req.risk_pct, req.confidence
    )

    # Ajustement profil utilisateur
    adj_risk, rr1, rr2, profile_note = profile_risk_adjustment(
        req.profile, adj_risk, rr1, rr2
    )
    adj_note = f"{regime_note} | {profile_note}"

    # Protection capital minimal
    if adj_risk < 0.1:
        adj_risk = 0.1
        warnings.append("Risque ajusté au minimum 0.1%")

    max_risk = 5.0 if (req.profile or "").lower() == "aggressive" else 3.0
    if adj_risk > max_risk:
        adj_risk = max_risk
        warnings.append(f"Risque plafonné à {max_risk}% par trade")

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


# ─── Staged Stop Engine ───────────────────────────────────────────────────────

def compute_staged_stop(
    direction: str,
    entry_price: float,
    initial_stop: float,
    break_even_trigger: Optional[float] = None,
    structure_stop: Optional[float] = None,
    trailing_stop: Optional[float] = None,
    reached_tps: Optional[list[int]] = None,
) -> tuple[float, str, str]:
    """
    Détermine le stop actif selon l'évolution du trade.

    Ordre des étapes :
      - Avant TP1        -> SL initial
      - TP1 atteint      -> break-even (ou trigger explicite)
      - TP2 atteint      -> stop structurel (dernier HL/LH)
      - TP3+ atteint     -> trailing stop (si fourni et favorable)
    """
    reached = set(reached_tps or [])
    direction = (direction or "BUY").upper()
    is_buy = direction == "BUY"

    active = initial_stop
    stage = "initial"
    reason = "SL initial avant TP1"

    # Helpers: ensure a new level is "better" than the current active stop
    def _better(level: float) -> bool:
        if is_buy:
            return level > active
        return level < active

    if 1 in reached:
        be = break_even_trigger if break_even_trigger is not None else entry_price
        if is_buy:
            active = max(active, be, entry_price)
        else:
            active = min(active, be, entry_price)
        stage = "break_even"
        reason = "TP1 atteint -> break-even"

    if 2 in reached:
        if structure_stop is not None:
            if is_buy:
                active = max(active, structure_stop)
            else:
                active = min(active, structure_stop)
            stage = "structure"
            reason = "TP2 atteint -> stop structurel"

    if 3 in reached:
        if trailing_stop is not None and _better(trailing_stop):
            active = trailing_stop
            stage = "trailing"
            reason = "TP3+ atteint -> trailing dynamique"

    # Safety: active stop must never be worse than the initial stop in the loss direction
    if is_buy and active < initial_stop:
        active = initial_stop
        reason += " (protection SL initial)"
    elif not is_buy and active > initial_stop:
        active = initial_stop
        reason += " (protection SL initial)"

    return round(active, 6), stage, reason


@router.post("/risk/staged-stop", response_model=StagedStopResponse)
def staged_stop(req: StagedStopRequest):
    active, stage, reason = compute_staged_stop(
        direction=req.direction,
        entry_price=req.entry_price,
        initial_stop=req.initial_stop,
        break_even_trigger=req.break_even_trigger,
        structure_stop=req.structure_stop,
        trailing_stop=req.trailing_stop,
        reached_tps=req.reached_tps,
    )
    return StagedStopResponse(active_stop=active, stage=stage, reason=reason)
