"""
Jour 9 — Strategy Engine : évaluation des règles JSON d'une stratégie
Les règles JSON définissent les paramètres du scan (EMA, RSI, seuils, filtres PA).
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class StrategyRules:
    ema_fast:         int   = 20
    ema_slow:         int   = 50
    ema_trend:        int   = 200
    rsi_period:       int   = 14
    rsi_oversold:     float = 30.0
    rsi_overbought:   float = 70.0
    rsi_bullish_zone: float = 45.0   # RSI > cette valeur → bullish zone
    rsi_bearish_zone: float = 55.0   # RSI < cette valeur → bearish zone
    min_confidence:   float = 55.0
    volume_spike_min: float = 1.3    # ratio vs moyenne 20
    use_price_action: bool  = True
    use_sr_zones:     bool  = True
    use_patterns:     bool  = True
    atr_min_pct:      float = 0.2    # ATR% minimum pour qu'un trade soit valide
    timeframes:       list  = field(default_factory=lambda: ["1h", "4h"])


def parse_rules(rules_json: dict) -> StrategyRules:
    """Convertit le dict JSON de règles en objet StrategyRules."""
    r = StrategyRules()
    for key, val in rules_json.items():
        if hasattr(r, key):
            setattr(r, key, val)
    return r


def evaluate_strategy(
    rules: StrategyRules,
    indicators: dict,
    pa: dict,
    sr: dict,
    patterns: dict,
) -> dict:
    """
    Évalue si les conditions de la stratégie sont remplies.
    Retourne score, signal, reasons.
    """
    score   = 0
    reasons = []

    e20  = indicators.get("ema20")
    e50  = indicators.get("ema50")
    e200 = indicators.get("ema200")
    rsi  = indicators.get("rsi")
    atr  = indicators.get("atr")
    close = indicators.get("close")
    vol_r = indicators.get("volume_ratio")

    if not close or close == 0:
        return {"score": 0, "signal": "NEUTRAL", "reasons": ["no data"]}

    # ── EMA alignment ──────────────────────────────────────────
    if e20 and e50 and e200:
        if e20 > e50 > e200 and close > e200:
            score += 40
            reasons.append(f"EMA {rules.ema_fast}/{rules.ema_slow}/{rules.ema_trend} bullish + above trend")
        elif e20 < e50 < e200 and close < e200:
            score -= 40
            reasons.append(f"EMA {rules.ema_fast}/{rules.ema_slow}/{rules.ema_trend} bearish + below trend")
        elif e20 > e50:
            score += 20
            reasons.append(f"EMA{rules.ema_fast} > EMA{rules.ema_slow} bullish")
        elif e20 < e50:
            score -= 20
            reasons.append(f"EMA{rules.ema_fast} < EMA{rules.ema_slow} bearish")
    elif e20 and e50:
        if e20 > e50:
            score += 15
            reasons.append(f"EMA{rules.ema_fast} > EMA{rules.ema_slow}")
        else:
            score -= 15
            reasons.append(f"EMA{rules.ema_fast} < EMA{rules.ema_slow}")

    # ── RSI ────────────────────────────────────────────────────
    if rsi is not None:
        if rsi <= rules.rsi_oversold:
            score += 20
            reasons.append(f"RSI oversold ({rsi:.1f} ≤ {rules.rsi_oversold})")
        elif rsi >= rules.rsi_overbought:
            score -= 20
            reasons.append(f"RSI overbought ({rsi:.1f} ≥ {rules.rsi_overbought})")
        elif rsi >= rules.rsi_bullish_zone:
            score += 10
            reasons.append(f"RSI bullish zone ({rsi:.1f})")
        elif rsi <= rules.rsi_bearish_zone:
            score -= 10
            reasons.append(f"RSI bearish zone ({rsi:.1f})")

    # ── Volume ─────────────────────────────────────────────────
    if vol_r and vol_r >= rules.volume_spike_min:
        score += 10 if score > 0 else -10
        reasons.append(f"Volume spike x{vol_r:.1f}")

    # ── ATR filter ─────────────────────────────────────────────
    if atr and close > 0:
        atr_pct = (atr / close) * 100
        if atr_pct >= rules.atr_min_pct:
            reasons.append(f"ATR OK ({atr_pct:.2f}%)")
        else:
            score = int(score * 0.7)
            reasons.append(f"ATR faible ({atr_pct:.2f}%) — signal réduit")

    # ── Price Action ───────────────────────────────────────────
    if rules.use_price_action:
        from routers.price_action import price_action_bonus
        temp_dir = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
        if temp_dir != "NEUTRAL":
            b, r = price_action_bonus(pa, temp_dir)
            score += b
            reasons += r

    # ── S&R Zones ──────────────────────────────────────────────
    if rules.use_sr_zones:
        from routers.sr_zones import sr_bonus
        temp_dir = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
        if temp_dir != "NEUTRAL":
            b, r = sr_bonus(sr, temp_dir)
            score += b
            reasons += r

    # ── Patterns ───────────────────────────────────────────────
    if rules.use_patterns:
        from routers.patterns import patterns_bonus
        temp_dir = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
        if temp_dir != "NEUTRAL":
            b, r = patterns_bonus(patterns, temp_dir)
            score += b
            reasons += r

    # ── Signal final ───────────────────────────────────────────
    confidence = min(abs(score), 95)
    if score >= 40:
        signal = "BUY"
    elif score <= -40:
        signal = "SELL"
    else:
        signal = "NEUTRAL"
        confidence = 0

    if confidence < rules.min_confidence and signal != "NEUTRAL":
        reasons.append(f"Confiance {confidence}% < seuil {rules.min_confidence}% — filtré")
        signal = "NEUTRAL"
        confidence = 0

    return {
        "score":      score,
        "signal":     signal,
        "confidence": confidence,
        "reasons":    reasons,
    }
