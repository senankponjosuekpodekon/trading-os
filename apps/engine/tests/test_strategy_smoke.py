"""
Smoke-test — Strategy Engine
Vérifie que chaque stratégie produit un signal directionnel avec un contexte favorable.
Une stratégie en FAIL ici indique un blocage structurel (config incohérente ou bug moteur).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.strategy_eval import parse_rules, evaluate_strategy

STRATEGIES = {
    "EMA Trend + RSI": dict(
        rules=dict(
            ema_fast=20, ema_slow=50, ema_trend=200, rsi_period=14,
            rsi_oversold=30, rsi_overbought=70, rsi_bullish_zone=45, rsi_bearish_zone=55,
            min_confidence=55, min_dps=60, volume_spike_min=1.3,
            use_price_action=True, use_sr_zones=True, use_patterns=True, atr_min_pct=0.2,
            timeframes=["1h", "4h"], trigger="BREAKOUT",
            profiles=["SWING", "DAY"], markets=["CRYPTO", "FOREX", "INDICES"],
        ),
        analysis_tf="4h", entry_tf="1h", market="CRYPTO",
    ),
    "MACD Momentum": dict(
        rules=dict(
            ema_fast=12, ema_slow=26, ema_trend=200, rsi_period=14,
            rsi_oversold=35, rsi_overbought=65, rsi_bullish_zone=50, rsi_bearish_zone=50,
            min_confidence=60, min_dps=55, volume_spike_min=1.5,
            use_price_action=True, use_sr_zones=False, use_patterns=False, atr_min_pct=0.3,
            timeframes=["15m", "1h"], trigger="MOMENTUM_CONFIRMATION",
            profiles=["DAY", "SCALPER"], markets=["CRYPTO", "FOREX"],
            entry_rules={"ema_fast_above_slow": True},
            filters={"regime": ["TRENDING_BULL", "TRENDING_BEAR"]},
        ),
        analysis_tf="1h", entry_tf="15m", market="CRYPTO",
    ),
    "Bollinger Squeeze Breakout": dict(
        rules=dict(
            ema_fast=20, ema_slow=50, ema_trend=200, rsi_period=14,
            rsi_oversold=25, rsi_overbought=75, rsi_bullish_zone=50, rsi_bearish_zone=50,
            min_confidence=55, min_dps=50, volume_spike_min=1.8,
            use_price_action=True, use_sr_zones=True, use_patterns=False, atr_min_pct=0.4,
            timeframes=["1h", "4h"], trigger="VOLATILITY_EXPANSION",
            profiles=["SWING", "DAY"], markets=["CRYPTO", "INDICES", "COMMODITIES"],
            filters={"regime": ["VOLATILE", "TRENDING_BULL", "TRENDING_BEAR"]},
        ),
        analysis_tf="4h", entry_tf="1h", market="CRYPTO",
    ),
    "SMC Retest OB/FVG": dict(
        rules=dict(
            ema_fast=20, ema_slow=50, ema_trend=200, rsi_period=14,
            rsi_oversold=30, rsi_overbought=70, rsi_bullish_zone=45, rsi_bearish_zone=55,
            min_confidence=60, min_dps=60, volume_spike_min=1.2,
            use_price_action=True, use_sr_zones=True, use_patterns=True, atr_min_pct=0.25,
            timeframes=["1h", "4h"], trigger="RETEST",
            profiles=["SWING", "INVESTOR"], markets=["CRYPTO", "FOREX", "INDICES"],
            entry_rules={"fvg_proximity_pct": 1.5, "bos": True},
            filters={"regime": ["TRENDING_BULL", "TRENDING_BEAR"]},
            exit_rules={"sl_atr": 1.2, "tp1_atr": 2.5, "tp2_atr": 4.0},
        ),
        analysis_tf="4h", entry_tf="1h", market="CRYPTO",
    ),
    "Scalper RSI Reversal": dict(
        rules=dict(
            ema_fast=9, ema_slow=21, ema_trend=50, rsi_period=7,
            rsi_oversold=20, rsi_overbought=80, rsi_bullish_zone=50, rsi_bearish_zone=50,
            min_confidence=65, min_dps=65, volume_spike_min=2.0,
            use_price_action=True, use_sr_zones=True, use_patterns=True, atr_min_pct=0.15,
            timeframes=["5m", "15m"], trigger="MOMENTUM_CONFIRMATION",
            profiles=["SCALPER"], markets=["FOREX", "SYNTHETIC"],
            filters={"regime": ["RANGING"]},
            exit_rules={"sl_atr": 1.0, "tp1_atr": 1.0, "tp2_atr": 1.5},
        ),
        analysis_tf="15m", entry_tf="5m", market="FOREX",
    ),
    "Swing Trend Follow": dict(
        rules=dict(
            ema_fast=50, ema_slow=100, ema_trend=200, rsi_period=14,
            rsi_oversold=40, rsi_overbought=60, rsi_bullish_zone=50, rsi_bearish_zone=50,
            min_confidence=55, min_dps=55, volume_spike_min=1.0,
            use_price_action=True, use_sr_zones=True, use_patterns=True, atr_min_pct=0.3,
            timeframes=["4h", "1d"], trigger="BREAKOUT",
            profiles=["INVESTOR", "SWING"], markets=["CRYPTO", "FOREX", "INDICES", "COMMODITIES"],
            entry_rules={"adx_min": 25},
            filters={"regime": ["TRENDING_BULL", "TRENDING_BEAR"]},
            exit_rules={"sl_atr": 2.0, "tp1_atr": 3.0, "tp2_atr": 6.0},
        ),
        analysis_tf="1d", entry_tf="4h", market="CRYPTO",
    ),
    "BRVM Value Swing": dict(
        rules=dict(
            ema_fast=20, ema_slow=50, ema_trend=100, rsi_period=14,
            rsi_oversold=30, rsi_overbought=70, rsi_bullish_zone=45, rsi_bearish_zone=55,
            min_confidence=55, min_dps=50, volume_spike_min=1.1,
            use_price_action=True, use_sr_zones=True, use_patterns=True, atr_min_pct=0.1,
            timeframes=["1d"], trigger="BREAKOUT",
            profiles=["INVESTOR", "SWING"], markets=["STOCKS"],
            filters={"regime": ["TRENDING_BULL", "TRENDING_BEAR", "RANGING"]},
            exit_rules={"sl_atr": 2.0, "tp1_atr": 2.5, "tp2_atr": 4.0},
        ),
        analysis_tf="1d", entry_tf="1d", market="STOCKS",
        note="N'atteint jamais evaluate_strategy en prod (analyze_brvm_symbols bypass) — testé ici en isolation DSL uniquement.",
    ),
    # ATTENTION : objet approximatif — le rules exact post-refactor Synthetic ne m'a jamais
    # été montré verbatim. A remplacer par le vrai contenu de seed.ts avant de faire confiance
    # à ce cas de test.
    "Synthetic Mean Reversion (best-guess rules)": dict(
        rules=dict(
            ema_fast=20, ema_slow=50, ema_trend=200, rsi_period=14,
            rsi_oversold=25, rsi_overbought=75, rsi_bullish_zone=50, rsi_bearish_zone=50,
            min_confidence=55, min_dps=50, volume_spike_min=1.5,
            use_price_action=True, use_sr_zones=True, use_patterns=False, atr_min_pct=0.2,
            timeframes=["5m", "15m"], trigger="MOMENTUM_CONFIRMATION",
            profiles=["SCALPER", "DAY"], markets=["SYNTHETIC"],
            filters={"regime": ["RANGING", "TRENDING_BULL", "TRENDING_BEAR"]},
        ),
        analysis_tf="15m", entry_tf="5m", market="SYNTHETIC",
        note="rules approximatif, non confirmé — à remplacer par le seed.ts réel.",
    ),
}


def build_favorable_context(rules):
    """
    Construit un scénario BUY réaliste et favorable — pas un raccourci qui
    contournerait la logique réelle. Reflète le format exact produit par
    price_action.py / patterns.py / smc.py / regime.py.
    """
    close = 100.0
    indicators = {
        "close": close,
        "ema20": 105.0, "ema50": 100.0, "ema200": 90.0,
        "rsi": rules.rsi_bullish_zone + 5,
        "atr": close * (rules.atr_min_pct / 100.0) * 2.0,
        "volume_ratio": max(rules.volume_spike_min, 1.0) + 0.5,
        "macd_hist": 1.5,
        "bb_bw": 0.05,
    }
    # Format réel de price_action.py::detect_market_structure — bos_dir vaut
    # "BULLISH"/"BEARISH", PAS "BUY"/"SELL" ni "up"/"down".
    pa = {"trend": "BULLISH", "bos": True, "bos_dir": "BULLISH", "choch": False, "structure": "HH + HL (uptrend)"}
    sr = {"near_support": {"price": close * 0.99, "strength": 2}, "near_resistance": None}
    # Format réel de patterns.py — "BULLISH"/"BEARISH", PAS "BUY"/"SELL".
    patterns = {"pin_bar": "BULLISH", "engulfing": None, "doji": False, "inside_bar": False}
    smc = {
        "fvg": {"near_bullish_fvg": {"mid": close * 0.995}, "near_bearish_fvg": None},
        "ob": {"near_bullish_ob": {"mid": close * 0.99}, "near_bearish_ob": None},
    }
    regime = {"regime": "TRENDING_BULL", "adx": 30, "trend_strength": "STRONG"}
    return indicators, pa, sr, patterns, smc, regime


def build_regime_override(rules, base_regime):
    """Si la stratégie exige un régime précis via filters.regime, on l'utilise."""
    allowed = (rules.filters or {}).get("regime")
    if not allowed:
        return base_regime
    regime = dict(base_regime)
    regime["regime"] = allowed[0]
    if allowed[0] == "RANGING":
        regime["trend_strength"] = "WEAK"
        regime["adx"] = 15
    return regime


def run():
    results = []
    for name, cfg in STRATEGIES.items():
        rules = parse_rules(cfg["rules"])
        rules.analysis_timeframe = cfg["analysis_tf"]
        rules.entry_timeframe = cfg["entry_tf"]

        indicators, pa, sr, patterns, smc, regime = build_favorable_context(rules)
        regime = build_regime_override(rules, regime)

        ev = evaluate_strategy(
            rules, indicators, pa, sr, patterns, smc=smc, regime=regime,
            timeframe=cfg["analysis_tf"], market=cfg["market"],
        )

        status = "PASS" if ev["signal"] != "NEUTRAL" else "FAIL"
        results.append((name, status, ev["signal"], ev["score"], ev["confidence"], ev["dps"], ev["reasons"]))

    width = max(len(r[0]) for r in results) + 2
    print(f"{'Stratégie'.ljust(width)} {'Statut':7} {'Signal':8} {'Score':6} {'Conf':6} {'DPS':6}")
    print("-" * (width + 40))
    n_fail = 0
    for name, status, signal, score, confidence, dps, reasons in results:
        marker = "✅" if status == "PASS" else "❌"
        n_fail += status == "FAIL"
        print(f"{marker} {name.ljust(width-2)} {status:7} {signal:8} {score:<6} {confidence:<6} {dps:<6}")
        if status == "FAIL":
            for r in reasons[-3:]:
                print(f"      └─ {r}")

    print("-" * (width + 40))
    print(f"{len(results) - n_fail}/{len(results)} stratégies produisent un signal avec un contexte pourtant favorable.")
    if n_fail:
        print("Une stratégie en FAIL ici, malgré un scénario BUY construit pour être gagnant,")
        print("indique un blocage structurel (config incohérente ou bug moteur) — pas juste \"pas de setup aujourd'hui\".")
    return n_fail


if __name__ == "__main__":
    sys.exit(1 if run() else 0)
