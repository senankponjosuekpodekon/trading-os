"""
Moteur de sizing par le risque — spécification Carver (audit §1-2) adaptée
crypto/CFD. Indépendant de tout signal : il convertit un budget de risque
en taille de position, et sert le quality gate comme référence de risque.

Règles non négociables :
- jamais de sizing en lots fixes ou % de capital fixe (fixed capital = bug)
- la taille se recalcule avec la volatilité COURANTE (pas la vol d'hier)
- un seul moteur appelé par toutes les stratégies
"""
import math
from typing import Optional


# ── Volatilité robuste ────────────────────────────────────────────────

def ewma_vol(returns: list[float], span: int = 36,
             long_run_vol: Optional[float] = None,
             mix: float = 0.7) -> float:
    """Volatilité = mix × EWMA(span) + (1−mix) × vol long terme.

    Le plancher long terme évite de sur-dimensionner en régime calme
    (les périodes calmes précèdent souvent les explosions — Volmageddon).
    mix=0.7 / span=36 : repères Carver ; en crypto, la fenêtre longue est
    raccourcie faute d'historique → passer long_run_vol explicitement.
    """
    if not returns:
        return long_run_vol or 0.0
    alpha = 2.0 / (span + 1)
    var = returns[0] ** 2
    for r in returns[1:]:
        var = alpha * r * r + (1 - alpha) * var
    ewma = math.sqrt(var)
    if long_run_vol is None or long_run_vol <= 0:
        return ewma
    return mix * ewma + (1 - mix) * long_run_vol


def annualize_vol(period_vol: float, periods_per_year: float) -> float:
    return period_vol * math.sqrt(periods_per_year)


# ── Sizing par le risque ──────────────────────────────────────────────

def position_size(capital: float,
                  target_risk: float,
                  price: float,
                  sigma_annual: float,
                  multiplier: float = 1.0,
                  forecast: float = 10.0,
                  max_leverage: Optional[float] = None,
                  lot_min: float = 0.0,
                  notional_min: float = 0.0) -> dict:
    """N = (capital × τ × forecast/10) / (multiplier × prix × σ_annual).

    - target_risk τ : risque annuel cible du compte (ex. 0.12 = 12%) —
      paramètre par compte, borné par les 4 filtres Carver (plafond
      exchange, survie krach, confort, optimum historique).
    - forecast ∈ [−20,+20] : taille ∝ conviction ; 10 = pleine taille.
      Sans forecast (signaux binaires actuels) → passer 10 ou −10.
    - Retourne contrats N (arrondi au lot_min près), notionnel, risque $,
      et les raisons d'éventuels plafonds.
    """
    if capital <= 0 or price <= 0 or sigma_annual <= 0 or multiplier <= 0:
        return {"n": 0.0, "notional": 0.0, "risk_usd": 0.0,
                "reasons": ["invalid_input"]}

    f = max(-20.0, min(20.0, forecast))
    n_raw = (capital * target_risk * (f / 10.0)) / (multiplier * price * sigma_annual)

    reasons = []
    n = n_raw

    # Plafond levier : notionnel ≤ capital × max_leverage
    if max_leverage:
        cap_n = capital * max_leverage / (multiplier * price)
        if abs(n) > cap_n:
            n = math.copysign(cap_n, n)
            reasons.append("capped_by_leverage")

    # Lot minimum : arrondi vers le bas (jamais vers le haut = sur-risque)
    if lot_min > 0:
        n = math.floor(abs(n) / lot_min) * lot_min * (1 if n >= 0 else -1)
        if n == 0:
            reasons.append("below_lot_min")

    notional = abs(n) * multiplier * price
    if notional_min > 0 and 0 < notional < notional_min:
        n = 0.0
        notional = 0.0
        reasons.append("below_notional_min")

    risk_usd = abs(n) * multiplier * price * sigma_annual
    return {"n": round(n, 8), "notional": round(notional, 2),
            "risk_usd": round(risk_usd, 2), "reasons": reasons}


# ── Pont instrument_profile ───────────────────────────────────────────

async def size_for_symbol(symbol: str, capital: float, target_risk: float,
                          price: float, sigma_annual: float,
                          forecast: float = 10.0) -> dict:
    """Sizing qui lit multiplier/lot_min/notional_min/max_leverage/tradable
    depuis la fiche instrument (défauts venue si absente)."""
    from utils.instrument_profile import get_instrument_profile
    p = await get_instrument_profile(symbol)
    if not p.get("tradable", True):
        return {"n": 0.0, "notional": 0.0, "risk_usd": 0.0,
                "reasons": ["not_tradable"], "symbol": symbol,
                "venue": p.get("venue")}
    r = position_size(capital, target_risk, price, sigma_annual,
                      multiplier=p.get("multiplier") or 1.0,
                      forecast=forecast,
                      max_leverage=p.get("max_leverage"),
                      lot_min=p.get("lot_min") or 0.0,
                      notional_min=p.get("notional_min") or 0.0)
    r.update({"symbol": symbol, "venue": p.get("venue"),
              "carry_source": p.get("carry_source")})
    return r


# ── Compounding ───────────────────────────────────────────────────────

def sizing_capital(equity: float, mode: str = "full",
                   capital_ref: Optional[float] = None) -> float:
    """Capital de sizing selon le mode de compounding.

    - 'full'  : equity courante (croissance max, réduit auto après perte)
    - 'half'  : min(equity, capital_ref) — au-delà du plus haut, les
      profits deviennent retirables (revenu régulier)
    - 'fixed' : INTERDIT — le risque relatif monte quand le compte baisse
    """
    if mode == "fixed":
        raise ValueError("fixed capital interdit : le risque relatif croît "
                         "quand le compte se réduit (règle Carver n°1)")
    if mode == "half" and capital_ref is not None:
        return min(equity, capital_ref)
    return equity


# ── Gap / krach ───────────────────────────────────────────────────────

def gap_test(position_notional: float, gap_pct: float) -> float:
    """Perte si le prix gappe instantanément de gap_pct (ex. −0.16 CHF 2015,
    −0.30 scénario crypto). Retourne la perte en $."""
    return abs(position_notional) * gap_pct
