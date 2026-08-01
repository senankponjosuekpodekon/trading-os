"""
Jour 9 — Strategy Engine : évaluation des règles JSON d'une stratégie
Les règles JSON définissent les paramètres du scan (EMA, RSI, seuils, filtres PA).
"""
from dataclasses import dataclass, field
from typing import Optional
from utils.predictive import compute_predictive_metrics
from utils.direction import directions_aligned
from utils.metrics import inc_labeled


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
    min_dps:          float = 60.0   # Sprint 4 — DPS minimum pour persister le signal
    volume_spike_min: float = 1.3    # ratio vs moyenne 20
    use_price_action: bool  = True
    use_sr_zones:     bool  = True
    use_smc:          bool  = False
    use_patterns:     bool  = True
    atr_min_pct:      float = 0.2    # ATR% minimum pour qu'un trade soit valide
    timeframes:       list  = field(default_factory=lambda: ["1h", "4h"])

    # --- Extended DSL fields ---
    analysis_timeframe: Optional[str] = None
    entry_timeframe:    Optional[str] = None
    trigger:            Optional[str] = None
    markets:            list  = field(default_factory=list)
    profiles:           list  = field(default_factory=list)
    entry_rules:        dict  = field(default_factory=dict)
    filters:            dict  = field(default_factory=dict)
    invalidation:       dict  = field(default_factory=dict)
    exit_rules:         dict  = field(default_factory=dict)


def derive_profile_suitability(
    timeframe: Optional[str],
    risk_reward: Optional[float],
    profiles: list,
    signal: str,
    confidence: float,
) -> list:
    """
    Détermine les profils adaptés au signal.
    Prend en compte les profils déclarés par la stratégie, le timeframe, le R/R et la confiance.
    """
    PROFILE_CONFIDENCE = {
        "INVESTOR": 55,
        "SWING": 60,
        "DAY": 60,
        "SCALPER": 65,
    }
    PROFILE_TIMEFRAMES = {
        "INVESTOR": {"1d", "4h"},
        "SWING": {"4h", "1h", "30m"},
        "DAY": {"1h", "30m", "15m"},
        "SCALPER": {"15m", "5m", "1m"},
    }
    PROFILE_RR = {
        "INVESTOR": 2.0,
        "SWING": 1.5,
        "DAY": 1.2,
        "SCALPER": 1.0,
    }
    if signal == "NEUTRAL" or not confidence:
        return []
    candidates = set(profiles) if profiles else set(PROFILE_CONFIDENCE.keys())
    if timeframe:
        candidates = {p for p in candidates if timeframe in PROFILE_TIMEFRAMES.get(p, set())}
    result = []
    for p in sorted(candidates):
        if confidence >= PROFILE_CONFIDENCE[p] and (risk_reward is None or risk_reward >= PROFILE_RR[p]):
            result.append(p)
    return result


def _find_nearest_ob_fvg(signal: str, close: float, smc: Optional[dict]) -> Optional[float]:
    """Retourne le niveau OB/FVG le plus proche du prix actuel dans la direction du signal."""
    if not smc:
        return None
    fvg = smc.get("fvg") or {}
    ob = smc.get("ob") or {}
    if signal == "BUY":
        candidates = [
            fvg.get("near_bullish_fvg"),
            ob.get("near_bullish_ob"),
        ]
    else:
        candidates = [
            fvg.get("near_bearish_fvg"),
            ob.get("near_bearish_ob"),
        ]
    candidates = [c for c in candidates if c is not None and c != 0]
    if not candidates:
        return None

    def _extract_price(c):
        if isinstance(c, dict):
            return c.get("mid") or c.get("top") or c.get("bottom")
        return c

    return min(candidates, key=lambda x: abs(_extract_price(x) - close))


def _apply_trigger(
    trigger: Optional[str],
    signal: str,
    close: float,
    indicators: dict,
    pa: dict,
    smc: Optional[dict],
    regime: Optional[dict],
    rules: StrategyRules,
) -> dict:
    """Applique le mode d'entrée (trigger) et les entry_rules du DSL."""
    result = {"signal": signal, "entry_price": close, "signal_pending": False, "reason": None}
    if signal == "NEUTRAL" or not trigger:
        return result

    entry_rules = getattr(rules, "entry_rules", None) or {}

    # --- entry_rules filters ---
    if entry_rules.get("ema_fast_above_slow"):
        e20 = indicators.get("ema20")
        e50 = indicators.get("ema50")
        if signal == "BUY" and not (e20 and e50 and e20 > e50):
            return {**result, "signal": "NEUTRAL", "reason": "EMA fast not above slow"}
        if signal == "SELL" and not (e20 and e50 and e20 < e50):
            return {**result, "signal": "NEUTRAL", "reason": "EMA fast not below slow"}

    adx_min = entry_rules.get("adx_min")
    if adx_min is not None:
        adx = (regime or {}).get("adx")
        if adx is None or adx < adx_min:
            return {**result, "signal": "NEUTRAL", "reason": f"ADX {adx} < {adx_min}"}

    if entry_rules.get("bos"):
        bos = pa.get("bos")
        bos_dir = pa.get("bos_dir")
        if not (bos and directions_aligned(bos_dir, signal)):
            return {**result, "signal": "NEUTRAL", "reason": f"BOS not aligned with {signal}"}

    # --- trigger modes ---
    if trigger == "BREAKOUT":
        return result

    if trigger == "MOMENTUM_CONFIRMATION":
        vol_r = indicators.get("volume_ratio")
        macd_hist = indicators.get("macd_hist")
        if signal == "BUY" and (vol_r and vol_r >= rules.volume_spike_min and macd_hist is not None and macd_hist > 0):
            return result
        if signal == "SELL" and (vol_r and vol_r >= rules.volume_spike_min and macd_hist is not None and macd_hist < 0):
            return result
        return {**result, "signal": "NEUTRAL", "reason": "Momentum confirmation not met"}

    if trigger == "VOLATILITY_EXPANSION":
        bb_bw = indicators.get("bb_bw")
        bb_bw_min = entry_rules.get("bb_bw_min", 0.02)
        if bb_bw is not None and bb_bw < bb_bw_min:
            return {**result, "signal": "NEUTRAL", "reason": f"No volatility expansion (BB bw={bb_bw:.4f} < {bb_bw_min})"}
        return result

    if trigger in ("RETEST", "LIMIT"):
        level = _find_nearest_ob_fvg(signal, close, smc)
        if level is None:
            return {**result, "signal": "NEUTRAL", "reason": f"No OB/FVG level for {trigger}"}
        # Extract float price from dict (smc.py returns dicts with bottom/top/mid)
        if isinstance(level, dict):
            level = level.get("mid") or level.get("top") or level.get("bottom")
        if level is None:
            return {**result, "signal": "NEUTRAL", "reason": f"OB/FVG level has no price for {trigger}"}
        proximity_pct = entry_rules.get("fvg_proximity_pct", 1.0)
        distance = abs(close - level) / close * 100 if close else 0
        if trigger == "RETEST":
            pending = distance > proximity_pct
            return {
                **result,
                "entry_price": level,
                "signal_pending": pending,
                "reason": f"RETEST {'pending' if pending else 'ready'} at {level}",
            }
        # LIMIT
        return {
            **result,
            "entry_price": level,
            "signal_pending": True,
            "reason": f"LIMIT order at {level}",
        }

    return result


def parse_rules(rules_json: dict) -> StrategyRules:
    """Convertit le dict JSON de règles en objet StrategyRules."""
    r = StrategyRules()
    valid_fields = set(r.__dataclass_fields__.keys())
    for key, val in rules_json.items():
        if key in valid_fields:
            setattr(r, key, val)
        else:
            import structlog
            structlog.get_logger().warning(
                "parse_rules: unknown key in strategy rules",
                key=key,
                valid_fields=sorted(valid_fields),
            )
    return r


def evaluate_strategy(
    rules: StrategyRules,
    indicators: dict,
    pa: dict,
    sr: dict,
    patterns: dict,
    smc: Optional[dict] = None,
    regime: Optional[dict] = None,
    timeframe: Optional[str] = None,
    market: Optional[str] = None,
    onchain: Optional[dict] = None,
    entry_context: Optional[dict] = None,
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
        return {
            "score": 0,
            "signal": "NEUTRAL",
            "confidence": 0,
            "reasons": ["no data"],
            "entry_price": None,
            "stop_loss": None,
            "take_profit_1": None,
            "take_profit_2": None,
            "risk_reward": None,
            "profile_suitability": [],
            "trigger": getattr(rules, "trigger", None),
            "signal_pending": False,
            "invalidation": getattr(rules, "invalidation", None) or {},
            "dps": 0.0,
            "tps": 0.0,
            "success_probability": 0.0,
            "expected_move": {"value": None, "pct": None},
        }

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

    # ── SMC (Smart Money Concepts) ─────────────────────────────
    if rules.use_smc and smc:
        from routers.smc import smc_bonus
        temp_dir = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
        if temp_dir != "NEUTRAL":
            b, r = smc_bonus(smc.get("fvg", {}), smc.get("ob", {}), smc.get("liquidity", {}), temp_dir)
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

    # ── On-chain (crypto uniquement) : Fear&Greed contrarian + Funding squeeze ──
    if onchain:
        from routers.onchain import onchain_bonus
        temp_dir = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")
        if temp_dir != "NEUTRAL":
            b, r = onchain_bonus(onchain.get("context") or {}, temp_dir, onchain.get("fear_greed"))
            score += b
            reasons += r

    # ── Signal final ───────────────────────────────────────────
    _strat = getattr(rules, "_name", None) or "unknown"
    confidence = min(abs(score), 95)
    if score >= 40:
        signal = "BUY"
    elif score <= -40:
        signal = "SELL"
    else:
        signal = "NEUTRAL"
        confidence = 0

    inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "signal_decided", "signal": signal})

    if confidence < rules.min_confidence and signal != "NEUTRAL":
        reasons.append(f"Confiance {confidence}% < seuil {rules.min_confidence}% — filtré")
        signal = "NEUTRAL"
        confidence = 0
        inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "confidence_threshold", "result": "filtered"})

    # --- Filters (regime / market) ---
    if signal != "NEUTRAL":
        _filters = getattr(rules, "filters", None) or {}
        if regime and _filters.get("regime"):
            allowed_regimes = _filters["regime"]
            if regime.get("regime") not in allowed_regimes:
                reasons.append(f"Regime {regime.get('regime')} not in {allowed_regimes} — filtré")
                signal = "NEUTRAL"
                confidence = 0
                inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "regime_filter", "result": "filtered"})
        if market and getattr(rules, "markets", None):
            if market not in rules.markets:
                reasons.append(f"Market {market} not in {rules.markets} — filtré")
                signal = "NEUTRAL"
                confidence = 0
                inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "market_filter", "result": "filtered"})

    # --- Entry rules / trigger ---
    trigger = getattr(rules, "trigger", None)
    signal_pending = False
    close_val = indicators.get("close")
    entry_price = close_val
    if signal != "NEUTRAL":
        trigger_result = _apply_trigger(
            trigger, signal, close_val, indicators, pa, smc, regime, rules
        )
        signal = trigger_result["signal"]
        entry_price = trigger_result["entry_price"]
        signal_pending = trigger_result["signal_pending"]
        if trigger_result["reason"]:
            reasons.append(trigger_result["reason"])
        if signal == "NEUTRAL":
            confidence = 0
            score = 0
            inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "trigger_check", "result": "filtered"})

    # --- Scheduler différencié analysis_timeframe / entry_timeframe (Sprint 3) ---
    # L'analyse (biais/score) est faite sur `timeframe` (= analysis_timeframe côté DSL).
    # Si la stratégie déclare un entry_timeframe distinct, on affine le prix d'entrée avec
    # la dernière clôture de ce TF plus bas (timing d'exécution plus précis).
    entry_tf = getattr(rules, "entry_timeframe", None)
    if (
        signal != "NEUTRAL"
        and entry_tf
        and entry_tf != (getattr(rules, "analysis_timeframe", None) or timeframe)
        and entry_context
        and entry_context.get("close") is not None
    ):
        entry_price = round(entry_context["close"], 6)
        reasons.append(f"Entrée affinée sur {entry_tf} (close={entry_price})")

    # --- Price levels / exit rules ---
    atr_val = indicators.get("atr")
    entry_price = round(entry_price, 6) if entry_price is not None else None
    stop_loss = take_profit_1 = take_profit_2 = risk_reward = None

    _reg = (regime or {}).get("regime", "UNKNOWN")
    exit_rules = getattr(rules, "exit_rules", None) or {}
    if _reg == "RANGING":
        sl_mult, tp1_mult, tp2_mult = 1.2, 1.5, 2.5
    elif _reg in ("TRENDING_BULL", "TRENDING_BEAR"):
        sl_mult, tp1_mult, tp2_mult = 1.5, 2.0, 3.5
    elif _reg == "VOLATILE":
        sl_mult, tp1_mult, tp2_mult = 2.0, 2.0, 3.0
    else:
        sl_mult, tp1_mult, tp2_mult = 1.5, 2.0, 3.5
    sl_mult = exit_rules.get("sl_atr", sl_mult)
    tp1_mult = exit_rules.get("tp1_atr", tp1_mult)
    tp2_mult = exit_rules.get("tp2_atr", tp2_mult)

    if entry_price is not None and atr_val:
        if signal == "BUY":
            stop_loss = round(entry_price - atr_val * sl_mult, 6)
            take_profit_1 = round(entry_price + atr_val * tp1_mult, 6)
            take_profit_2 = round(entry_price + atr_val * tp2_mult, 6)
        elif signal == "SELL":
            stop_loss = round(entry_price + atr_val * sl_mult, 6)
            take_profit_1 = round(entry_price - atr_val * tp1_mult, 6)
            take_profit_2 = round(entry_price - atr_val * tp2_mult, 6)
        if stop_loss is not None and take_profit_1 is not None and abs(entry_price - stop_loss) > 0:
            risk_reward = round(abs(take_profit_1 - entry_price) / abs(entry_price - stop_loss), 2)

    # --- Profile suitability ---
    profile_suitability = derive_profile_suitability(
        timeframe,
        risk_reward,
        getattr(rules, "profiles", None) or [],
        signal,
        confidence,
    )

    # --- Predictive metrics (Sprint 4) ---
    _entry_rules = getattr(rules, "entry_rules", None) or {}
    predictive = compute_predictive_metrics(
        signal,
        confidence,
        entry_price,
        take_profit_1,
        stop_loss,
        risk_reward,
        indicators,
        pa,
        regime=regime,
        smc=smc,
        trigger=trigger,
        proximity_pct=_entry_rules.get("fvg_proximity_pct", 1.0),
        volume_spike_min=getattr(rules, "volume_spike_min", 1.3),
        bb_bw_min=_entry_rules.get("bb_bw_min", 0.02),
    )

    # --- DPS filter (Sprint 4) — signal directionnel peu fiable → non persisté ---
    if signal != "NEUTRAL" and predictive["dps"] < rules.min_dps:
        reasons.append(f"DPS {predictive['dps']}% < seuil {rules.min_dps}% — filtré")
        signal = "NEUTRAL"
        confidence = 0
        score = 0
        inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "dps_filter", "result": "filtered"})

    inc_labeled("strategy_funnel", {"strategy": _strat, "stage": "final", "signal": signal})

    return {
        "score":               score,
        "signal":              signal,
        "confidence":          confidence,
        "reasons":             reasons,
        "entry_price":         entry_price,
        "stop_loss":           stop_loss,
        "take_profit_1":       take_profit_1,
        "take_profit_2":       take_profit_2,
        "risk_reward":         risk_reward,
        "profile_suitability": profile_suitability,
        "trigger":             trigger,
        "signal_pending":      signal_pending,
        "invalidation":        getattr(rules, "invalidation", None) or {},
        "dps":                 predictive["dps"],
        "tps":                 predictive["tps"],
        "success_probability": predictive["success_probability"],
        "expected_move":       predictive["expected_move"],
    }
