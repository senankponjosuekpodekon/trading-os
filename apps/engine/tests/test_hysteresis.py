"""Tests unitaires — hystérésis flip-flop + persistence_score (Sprint 4)."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.scan import apply_hysteresis_and_persistence, _HYSTERESIS_TTL


def _result(symbol="BTC/USDT", signal="BUY", confidence=60, strategy_id="s1"):
    return {"symbol": symbol, "signal": signal, "confidence": confidence, "strategy_id": strategy_id}


def test_first_buy_scan_is_pending():
    state = {}
    results = [_result(signal="BUY")]
    apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0)
    assert results[0].get("signal_pending") is True
    assert results[0]["persistence_score"] == 20.0  # 1/5 fenêtre


def test_second_consecutive_buy_confirms_and_raises_persistence():
    state = {}
    results = [_result(signal="BUY")]
    apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0)
    results2 = [_result(signal="BUY")]
    apply_hysteresis_and_persistence(results2, "1h", state, now_mono=1005.0)
    assert results2[0].get("signal_pending") is None
    assert results2[0]["persistence_score"] == 40.0  # 2/5


def test_persistence_score_reaches_100_after_full_window():
    state = {}
    for i in range(5):
        results = [_result(signal="BUY")]
        apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0 + i)
    assert results[0]["persistence_score"] == 100.0


def test_direction_flip_resets_persistence():
    state = {}
    for i in range(3):
        results = [_result(signal="BUY")]
        apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0 + i)
    # Flip vers SELL — historique repart de zéro
    results_sell = [_result(signal="SELL")]
    apply_hysteresis_and_persistence(results_sell, "1h", state, now_mono=1010.0)
    assert results_sell[0]["persistence_score"] == 20.0
    assert results_sell[0].get("signal_pending") is True


def test_dead_band_keeps_previous_signal_sticky():
    state = {}
    for i in range(2):
        results = [_result(signal="BUY")]
        apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0 + i)
    # Signal repasse NEUTRAL mais confidence encore >= 25 → bande morte
    results_neutral = [_result(signal="NEUTRAL", confidence=30)]
    apply_hysteresis_and_persistence(results_neutral, "1h", state, now_mono=1005.0)
    assert results_neutral[0]["signal"] == "BUY"
    assert results_neutral[0]["signal_sticky"] is True
    assert results_neutral[0]["persistence_score"] > 0


def test_dead_band_expires_below_confidence_threshold():
    state = {}
    for i in range(2):
        results = [_result(signal="BUY")]
        apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0 + i)
    results_neutral = [_result(signal="NEUTRAL", confidence=10)]
    apply_hysteresis_and_persistence(results_neutral, "1h", state, now_mono=1005.0)
    assert results_neutral[0]["signal"] == "NEUTRAL"
    assert results_neutral[0].get("signal_sticky") is None
    assert results_neutral[0]["persistence_score"] == 0


def test_pure_neutral_scan_has_zero_persistence():
    state = {}
    results = [_result(signal="NEUTRAL", confidence=0)]
    apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0)
    assert results[0]["persistence_score"] == 0
    assert "signal_sticky" not in results[0]


def test_state_expires_after_ttl():
    state = {}
    results = [_result(signal="BUY")]
    apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0)
    key = "BTC/USDT:1h:s1"
    assert key in state
    # Second scan bien après le TTL — l'état doit être considéré expiré (recommence à 1)
    results2 = [_result(signal="BUY")]
    apply_hysteresis_and_persistence(results2, "1h", state, now_mono=1000.0 + _HYSTERESIS_TTL + 10)
    assert results2[0].get("signal_pending") is True
    assert results2[0]["persistence_score"] == 20.0


def test_different_symbols_tracked_independently():
    state = {}
    results = [_result(symbol="BTC/USDT", signal="BUY"), _result(symbol="ETH/USDT", signal="SELL")]
    apply_hysteresis_and_persistence(results, "1h", state, now_mono=1000.0)
    assert "BTC/USDT:1h:s1" in state
    assert "ETH/USDT:1h:s1" in state
    assert results[0]["signal"] == "BUY"
    assert results[1]["signal"] == "SELL"
