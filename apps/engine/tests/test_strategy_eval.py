"""Tests unitaires — évaluation de règles de stratégie."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.strategy_eval import (
    StrategyRules,
    parse_rules,
    evaluate_strategy,
    derive_profile_suitability,
)


def test_parse_rules_default():
    r = parse_rules({})
    assert isinstance(r, StrategyRules)
    assert r.ema_fast == 20


def test_parse_rules_override():
    r = parse_rules({"ema_fast": 10, "rsi_overbought": 80.0})
    assert r.ema_fast == 10
    assert r.rsi_overbought == 80.0


def _default_indicators(close: float = 100.0, ema20=110.0, ema50=105.0, ema200=100.0, rsi=25.0, atr=2.0, volume_ratio=1.5):
    return {
        "close": close,
        "ema20": ema20,
        "ema50": ema50,
        "ema200": ema200,
        "rsi": rsi,
        "atr": atr,
        "volume_ratio": volume_ratio,
    }


def test_evaluate_strategy_buy_signal():
    rules = StrategyRules(min_confidence=55)
    indicators = _default_indicators(close=110, ema20=112, ema50=108, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h")
    assert result["signal"] == "BUY"
    assert result["confidence"] >= 55
    assert result["entry_price"] is not None
    assert result["stop_loss"] < result["entry_price"]
    assert result["take_profit_1"] > result["entry_price"]


def test_evaluate_strategy_sell_signal():
    rules = StrategyRules(min_confidence=55)
    indicators = _default_indicators(close=90, ema20=88, ema50=92, ema200=100, rsi=75, atr=2)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h")
    assert result["signal"] == "SELL"
    assert result["confidence"] >= 55
    assert result["stop_loss"] > result["entry_price"]
    assert result["take_profit_1"] < result["entry_price"]


def test_evaluate_strategy_neutral_on_missing_close():
    rules = StrategyRules()
    result = evaluate_strategy(rules, {}, {}, {}, {})
    assert result["signal"] == "NEUTRAL"
    assert result["confidence"] == 0
    assert result["reasons"] == ["no data"]


def test_evaluate_strategy_market_filter_excludes():
    rules = StrategyRules(markets=["forex"])
    indicators = _default_indicators(close=101, ema20=112, ema50=105, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, market="crypto", timeframe="1h")
    assert result["signal"] == "NEUTRAL"
    assert "Market crypto not in" in " ".join(result["reasons"])


def test_derive_profile_suitability_swing_ok():
    profiles = derive_profile_suitability("1h", 2.0, [], "BUY", 70)
    assert "SWING" in profiles


def test_derive_profile_suitability_neutral_empty():
    profiles = derive_profile_suitability("1h", 2.0, [], "NEUTRAL", 0)
    assert profiles == []


def test_evaluate_strategy_dps_filter_blocks_low_dps_signal():
    # min_confidence bas (40) laisse passer un signal faible (confidence 50%) que le DPS (seuil 60) doit filtrer.
    rules = StrategyRules(min_confidence=40, min_dps=60.0)
    indicators = _default_indicators(close=101, ema20=102, ema50=101.5, ema200=100, rsi=52, atr=2, volume_ratio=1.0)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h")
    assert result["dps"] == 50.0
    assert result["signal"] == "NEUTRAL"
    assert result["confidence"] == 0
    assert any("DPS" in r for r in result["reasons"])


def test_evaluate_strategy_dps_filter_allows_high_dps_signal():
    rules = StrategyRules(min_confidence=55, min_dps=60.0)
    indicators = _default_indicators(close=110, ema20=112, ema50=108, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h")
    assert result["signal"] == "BUY"
    assert result["dps"] >= 60.0


def test_evaluate_strategy_entry_timeframe_refines_entry_price():
    rules = StrategyRules(min_confidence=55, min_dps=0.0, analysis_timeframe="1h", entry_timeframe="5m")
    indicators = _default_indicators(close=110, ema20=112, ema50=108, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(
        rules, indicators, {}, {}, {}, timeframe="1h", entry_context={"close": 111.5},
    )
    assert result["signal"] == "BUY"
    assert result["entry_price"] == 111.5
    assert any("Entrée affinée sur 5m" in r for r in result["reasons"])


def test_evaluate_strategy_entry_timeframe_ignored_without_context():
    rules = StrategyRules(min_confidence=55, min_dps=0.0, analysis_timeframe="1h", entry_timeframe="5m")
    indicators = _default_indicators(close=110, ema20=112, ema50=108, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h", entry_context=None)
    assert result["signal"] == "BUY"
    assert result["entry_price"] == 110.0


def test_evaluate_strategy_entry_timeframe_same_as_analysis_no_refinement():
    rules = StrategyRules(min_confidence=55, min_dps=0.0, analysis_timeframe="1h", entry_timeframe="1h")
    indicators = _default_indicators(close=110, ema20=112, ema50=108, ema200=100, rsi=25, atr=2)
    result = evaluate_strategy(
        rules, indicators, {}, {}, {}, timeframe="1h", entry_context={"close": 999.0},
    )
    assert result["entry_price"] == 110.0


def test_evaluate_strategy_dps_filter_disabled_with_low_threshold():
    rules = StrategyRules(min_confidence=40, min_dps=0.0)
    indicators = _default_indicators(close=101, ema20=102, ema50=101.5, ema200=100, rsi=52, atr=2, volume_ratio=1.0)
    result = evaluate_strategy(rules, indicators, {}, {}, {}, timeframe="1h")
    # Avec min_dps=0, le filtre DPS ne peut jamais déclencher
    assert not any("DPS" in r for r in result["reasons"])
