"""
Sprint 4 — Moteur prédictif v1
Heuristiques légères pour estimer la probabilité de succès d'un signal.
"""
from typing import Optional


def _direction_multiplier(signal: str) -> float:
    return 1.0 if signal == "BUY" else (-1.0 if signal == "SELL" else 0.0)


def compute_dps(
    signal: str,
    confidence: float,
    regime: Optional[dict] = None,
    mtf_aligned: Optional[bool] = None,
    volume_ratio: Optional[float] = None,
    volume_spike_min: float = 1.3,
) -> float:
    """
    Direction Probability Score — probabilité que la direction du signal soit correcte.
    Base = confidence, puis bonus MTF, regime, volume.
    """
    if signal == "NEUTRAL" or confidence <= 0:
        return 0.0
    dps = float(confidence)
    if mtf_aligned:
        dps = min(100.0, dps + 10.0)
    if regime:
        if regime.get("trend_strength") == "STRONG":
            dps = min(100.0, dps + 5.0)
        if regime.get("regime") in ("TRENDING_BULL", "TRENDING_BEAR"):
            dps = min(100.0, dps + 5.0)
    if volume_ratio and volume_ratio >= volume_spike_min:
        dps = min(100.0, dps + 5.0)
    return round(dps, 2)


def compute_tps(
    signal: str,
    trigger: Optional[str],
    close: float,
    entry_price: Optional[float],
    indicators: dict,
    pa: dict,
    smc: Optional[dict] = None,
    proximity_pct: float = 1.0,
) -> float:
    """
    Trigger Probability Score — probabilité que le déclencheur d'entrée soit atteint.
    """
    if signal == "NEUTRAL":
        return 0.0
    if not trigger:
        return 100.0

    if trigger == "BREAKOUT":
        return 100.0 if pa.get("bos") else 0.0

    if trigger == "MOMENTUM_CONFIRMATION":
        vol_r = indicators.get("volume_ratio")
        macd_hist = indicators.get("macd_hist")
        if vol_r and vol_r >= 1.3 and macd_hist is not None:
            if signal == "BUY" and macd_hist > 0:
                return 100.0
            if signal == "SELL" and macd_hist < 0:
                return 100.0
        return 0.0

    if trigger == "VOLATILITY_EXPANSION":
        bb_bw = indicators.get("bb_bw")
        return 0.0 if bb_bw is not None and bb_bw < 0.02 else 100.0

    if trigger in ("RETEST", "LIMIT"):
        if close is None or entry_price is None or close == 0:
            return 0.0
        distance = abs(close - entry_price) / close * 100
        return max(0.0, round(100.0 - (distance / proximity_pct) * 100.0, 2))

    return 100.0


def compute_success_probability(
    dps: float,
    tps: float,
    risk_reward: Optional[float],
    max: float = 100.0,
) -> float:
    """
    Estimation combinée de la probabilité de succès du trade.
    """
    rr_factor = 0.5
    if risk_reward:
        if risk_reward >= 2.0:
            rr_factor = 1.0
        elif risk_reward >= 1.5:
            rr_factor = 0.9
        elif risk_reward >= 1.0:
            rr_factor = 0.75
    prob = dps * (tps / 100.0) * rr_factor
    return round(min(max, prob), 2)


def compute_expected_move(
    signal: str,
    entry_price: Optional[float],
    take_profit_1: Optional[float],
    atr: Optional[float] = None,
    atr_mult: Optional[float] = None,
) -> dict:
    """
    Expected move en valeur absolue et en %.
    """
    if signal == "NEUTRAL" or entry_price is None or entry_price == 0:
        return {"value": None, "pct": None}
    if take_profit_1 is not None:
        value = take_profit_1 - entry_price
    elif atr is not None and atr_mult is not None:
        value = atr * atr_mult * _direction_multiplier(signal)
    else:
        return {"value": None, "pct": None}
    pct = (value / entry_price) * 100.0
    return {"value": round(value, 6), "pct": round(pct, 2)}


def compute_predictive_metrics(
    signal: str,
    confidence: float,
    entry_price: Optional[float],
    take_profit_1: Optional[float],
    stop_loss: Optional[float],
    risk_reward: Optional[float],
    indicators: dict,
    pa: dict,
    regime: Optional[dict] = None,
    smc: Optional[dict] = None,
    mtf_aligned: Optional[bool] = None,
    trigger: Optional[str] = None,
    proximity_pct: float = 1.0,
) -> dict:
    """
    Calcule DPS, TPS, expected move et success probability pour un signal.
    """
    dps = compute_dps(
        signal,
        confidence,
        regime=regime,
        mtf_aligned=mtf_aligned,
        volume_ratio=indicators.get("volume_ratio"),
    )
    tps = compute_tps(
        signal,
        trigger,
        indicators.get("close"),
        entry_price,
        indicators,
        pa,
        smc=smc,
        proximity_pct=proximity_pct,
    )
    success_probability = compute_success_probability(dps, tps, risk_reward)
    expected_move = compute_expected_move(signal, entry_price, take_profit_1)

    return {
        "dps": dps,
        "tps": tps,
        "success_probability": success_probability,
        "expected_move": expected_move,
    }
