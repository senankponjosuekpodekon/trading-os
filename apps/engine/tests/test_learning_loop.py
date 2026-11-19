"""Tests A/B/C : auto-promotion, sizing adaptatif, profils de gestion."""
import json
import ml.model_promotion as mp
from risk.adaptive import multiplier_from_stats, MULT_HIGH, MULT_MID, MULT_LOW
from ml.management_profiles import best_profile, profile_params


# ── A : auto-promotion ─────────────────────────────────────────

def test_promotion_rule_pure(tmp_path, monkeypatch):
    flag = tmp_path / "flag.json"
    monkeypatch.setattr(mp, "FLAG_PATH", str(flag))
    monkeypatch.setattr(mp, "MIN_OUTCOMES", 10)
    monkeypatch.setattr(mp, "MIN_DELTA", 0.05)
    mp._outcome_stats.update(n=10, xgb_correct=7, log_correct=4)  # 70% vs 40%
    assert mp.active_model() == "logistic"
    r = mp.evaluate_promotion()
    assert r and r["promoted"] == "xgboost"
    assert mp.active_model() == "xgboost"
    assert json.loads(flag.read_text())["active"] == "xgboost"


def test_promotion_reverts(tmp_path, monkeypatch):
    flag = tmp_path / "flag.json"
    flag.write_text(json.dumps({"active": "xgboost"}))
    monkeypatch.setattr(mp, "FLAG_PATH", str(flag))
    monkeypatch.setattr(mp, "MIN_OUTCOMES", 10)
    mp._outcome_stats.update(n=10, xgb_correct=3, log_correct=8)
    r = mp.evaluate_promotion()
    assert r and r["reverted"] == "logistic"


def test_promotion_insufficient_samples(monkeypatch):
    monkeypatch.setattr(mp, "MIN_OUTCOMES", 100)
    mp._outcome_stats.update(n=50, xgb_correct=45, log_correct=10)
    assert mp.evaluate_promotion() is None


def test_outcome_attribution(monkeypatch):
    mp._outcome_stats.update(n=0, xgb_correct=0, log_correct=0)
    mp.register_prediction("s1", 0.8, 0.3)   # log dit win, xgb dit lose
    assert mp.record_outcome("s1", "win") is True
    assert mp._outcome_stats["log_correct"] == 1
    assert mp._outcome_stats["xgb_correct"] == 0
    assert mp.record_outcome("unknown", "win") is False


# ── B : sizing adaptatif ───────────────────────────────────────

def test_multiplier_bounds():
    assert multiplier_from_stats({"win_rate": 70, "sample_size": 50})["multiplier"] == MULT_HIGH
    assert multiplier_from_stats({"win_rate": 30, "sample_size": 50})["multiplier"] == MULT_LOW
    assert multiplier_from_stats({"win_rate": 50, "sample_size": 50})["multiplier"] == MULT_MID
    # échantillon insuffisant → neutre même si WR extrême
    assert multiplier_from_stats({"win_rate": 95, "sample_size": 5})["multiplier"] == MULT_MID
    assert multiplier_from_stats({"win_rate": None, "sample_size": 0})["multiplier"] == MULT_MID


# ── C : profils de gestion ─────────────────────────────────────

def test_best_profile_needs_sample():
    stats = {"runner": {"n": 5, "avg_pnl": 900.0}}   # pas assez de trades
    assert best_profile(stats) == "balanced"


def test_best_profile_picks_winner():
    stats = {"runner": {"n": 15, "avg_pnl": 120.0},
             "conservative": {"n": 20, "avg_pnl": 30.0}}
    assert best_profile(stats) == "runner"


def test_profile_params_fallback():
    assert profile_params("inconnu") == profile_params("balanced")
    assert profile_params(None)["tp1_pct"] == 50.0
