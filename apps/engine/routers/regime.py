"""
Jour 10 — Détection de régime de marché
Régimes : TRENDING_BULL | TRENDING_BEAR | RANGING | VOLATILE | UNKNOWN
Utilise ADX, EMA200, ATR pour classifier le marché.
"""
import pandas as pd
import numpy as np


def compute_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average Directional Index."""
    up_move   = high.diff()
    down_move = -low.diff()

    plus_dm  = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=close.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=close.index)

    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)

    atr_smooth     = atr_raw.ewm(alpha=1 / period, adjust=False).mean()
    plus_dm_smooth  = plus_dm.ewm(alpha=1 / period, adjust=False).mean()
    minus_dm_smooth = minus_dm.ewm(alpha=1 / period, adjust=False).mean()

    plus_di  = 100 * plus_dm_smooth  / atr_smooth.replace(0, np.nan)
    minus_di = 100 * minus_dm_smooth / atr_smooth.replace(0, np.nan)

    dx  = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = dx.ewm(alpha=1 / period, adjust=False).mean()

    return adx, plus_di, minus_di


def detect_regime(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    adx_trend_threshold: float = 25.0,
    atr_volatile_threshold_pct: float = 2.5,
) -> dict:
    """
    Classifie le régime de marché.
    Retourne un dict avec regime, adx, trend_strength, description.
    """
    if len(close) < 50:
        return {"regime": "UNKNOWN", "adx": None, "description": "Pas assez de données"}

    adx, plus_di, minus_di = compute_adx(high, low, close)
    adx_val     = float(adx.iloc[-1])   if not pd.isna(adx.iloc[-1])     else 0.0
    plus_di_val = float(plus_di.iloc[-1]) if not pd.isna(plus_di.iloc[-1]) else 0.0
    minus_di_val= float(minus_di.iloc[-1])if not pd.isna(minus_di.iloc[-1])else 0.0

    close_val = float(close.iloc[-1])
    ema200_val = float(close.ewm(span=200, adjust=False).mean().iloc[-1])

    atr_raw = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr_val = float(atr_raw.ewm(span=14, adjust=False).mean().iloc[-1])
    atr_pct = (atr_val / close_val * 100) if close_val > 0 else 0

    # Percentile ATR relatif à l'historique de l'actif (top 10% = VOLATILE pour CET actif)
    # Évite que Forex (ATR% ~0.1%) ne soit jamais VOLATILE avec un seuil absolu global
    atr_pct_series = (atr_raw / close * 100).dropna()
    atr_percentile = float(atr_pct_series.rank(pct=True).iloc[-1]) if len(atr_pct_series) >= 20 else 0.5
    is_volatile = atr_pct >= atr_volatile_threshold_pct or atr_percentile >= 0.90

    above_ema200 = close_val > ema200_val

    if is_volatile:
        regime = "VOLATILE"
        desc   = f"Marché volatile (ATR {atr_pct:.2f}%, percentile {atr_percentile:.0%}) — tailles réduites recommandées"
    elif adx_val >= adx_trend_threshold:
        if plus_di_val > minus_di_val and above_ema200:
            regime = "TRENDING_BULL"
            desc   = f"Tendance haussière confirmée (ADX {adx_val:.1f}, +DI > -DI, above EMA200)"
        elif minus_di_val > plus_di_val and not above_ema200:
            regime = "TRENDING_BEAR"
            desc   = f"Tendance baissière confirmée (ADX {adx_val:.1f}, -DI > +DI, below EMA200)"
        else:
            regime = "RANGING"
            desc   = f"ADX fort ({adx_val:.1f}) mais direction mixte"
    else:
        regime = "RANGING"
        desc   = f"Marché en range (ADX {adx_val:.1f} < {adx_trend_threshold})"

    return {
        "regime":         regime,
        "adx":            round(adx_val, 2),
        "plus_di":        round(plus_di_val, 2),
        "minus_di":       round(minus_di_val, 2),
        "atr_pct":        round(atr_pct, 2),
        "atr_percentile": round(atr_percentile, 2),
        "ema200":         round(ema200_val, 4),
        "above_ema200":   above_ema200,
        "description":    desc,
        "trend_strength": "STRONG" if adx_val >= 40 else ("MODERATE" if adx_val >= 25 else "WEAK"),
    }


def regime_filter(regime: dict, signal: str) -> tuple[bool, str]:
    """
    Filtre un signal selon le régime.
    Retourne (allowed, reason).
    """
    r = regime.get("regime", "UNKNOWN")

    if r == "VOLATILE":
        return False, "Régime VOLATILE — signal bloqué (risque élevé)"

    if r == "TRENDING_BULL" and signal == "SELL":
        return False, "Régime TRENDING_BULL — signal SELL filtré"

    if r == "TRENDING_BEAR" and signal == "BUY":
        return False, "Régime TRENDING_BEAR — signal BUY filtré"

    if r == "RANGING":
        return True, "Régime RANGING — signaux filtrés (confiance réduite)"

    return True, f"Régime {r} — signal {signal} autorisé"


def regime_bonus(regime: dict, signal: str) -> tuple[int, list[str]]:
    """
    Bonus/malus sur le score selon le régime.
    """
    r = regime.get("regime", "UNKNOWN")
    bonus   = 0
    reasons = []

    if r == "TRENDING_BULL" and signal == "BUY":
        bonus += 15
        reasons.append(f"Régime TRENDING_BULL (ADX {regime.get('adx')})")
    elif r == "TRENDING_BEAR" and signal == "SELL":
        bonus += 15
        reasons.append(f"Régime TRENDING_BEAR (ADX {regime.get('adx')})")
    elif r == "RANGING":
        bonus -= 10
        reasons.append("Régime RANGING — bonus réduit")
    elif r == "VOLATILE":
        bonus -= 20
        reasons.append("Régime VOLATILE — signal risqué")

    return bonus, reasons
