"""
Unit tests for Phase L ML modules: portfolio_rebalancing, hidden_gems, ai_defense.
Run: python -m pytest tests/test_phase_l.py -v
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Portfolio Rebalancing ────────────────────────────────────────────────────

def test_rebalancing_conservative_profile():
    from ml.portfolio_rebalancing import compute_rebalancing, TARGET_ALLOCATION
    assert "conservative" in TARGET_ALLOCATION
    assert "moderate" in TARGET_ALLOCATION
    assert "aggressive" in TARGET_ALLOCATION

    positions = [
        {"symbol": "BTC/USDT", "cluster": "CRYPTO_MAJOR", "current_value": 50000, "pnl_pct": 5},
        {"symbol": "ETH/USDT", "cluster": "CRYPTO_MAJOR", "current_value": 30000, "pnl_pct": -2},
    ]
    result = compute_rebalancing(positions, profile="conservative", total_capital=100000)
    assert "actions" in result
    assert "summary" in result
    assert len(result["actions"]) > 0
    # CRYPTO_MAJOR at 80% vs 30% target → should suggest reduce
    assert any(a["action"] == "reduce" and a["cluster"] == "CRYPTO_MAJOR" for a in result["actions"])


def test_rebalancing_single_position_concentration():
    from ml.portfolio_rebalancing import compute_rebalancing
    positions = [
        {"symbol": "BTC/USDT", "cluster": "CRYPTO_MAJOR", "current_value": 30000, "pnl_pct": 10},
        {"symbol": "ETH/USDT", "cluster": "CRYPTO_MAJOR", "current_value": 5000, "pnl_pct": 3},
    ]
    result = compute_rebalancing(positions, profile="moderate", total_capital=35000)
    # BTC at 85.7% → exceeds 25% single position limit
    assert any(a["symbol"] == "BTC/USDT" and a["action"] == "reduce" for a in result["actions"])


def test_rebalancing_drawdown_cut():
    from ml.portfolio_rebalancing import compute_rebalancing
    positions = [
        {"symbol": "SOL/USDT", "cluster": "CRYPTO_MAJOR", "current_value": 10000, "pnl_pct": -20},
    ]
    result = compute_rebalancing(positions, profile="moderate", total_capital=10000)
    assert any(a["action"] == "exit" and a["symbol"] == "SOL/USDT" for a in result["actions"])


def test_rebalancing_empty_portfolio():
    from ml.portfolio_rebalancing import compute_rebalancing
    result = compute_rebalancing([], profile="moderate")
    assert result["actions"] == []


# ── Hidden Gems ──────────────────────────────────────────────────────────────

def test_gem_score_high_liquidity():
    from ml.hidden_gems import _compute_gem_score
    score, reasons, warnings = _compute_gem_score(
        liquidity=500_000, volume_24h=2_000_000, price_change_24h=15, age_hours=48
    )
    assert score >= 60
    assert len(reasons) > 0


def test_gem_score_low_liquidity_warning():
    from ml.hidden_gems import _compute_gem_score
    score, reasons, warnings = _compute_gem_score(
        liquidity=5_000, volume_24h=10_000, price_change_24h=5, age_hours=168
    )
    assert score < 45
    assert any("liquidity" in w.lower() for w in warnings)


def test_gem_score_extreme_pump_warning():
    from ml.hidden_gems import _compute_gem_score
    score, reasons, warnings = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=250, age_hours=12
    )
    assert any("pump" in w.lower() or "fomo" in w.lower() for w in warnings)


def test_gem_score_max_100():
    from ml.hidden_gems import _compute_gem_score
    score, _, _ = _compute_gem_score(
        liquidity=1_000_000, volume_24h=10_000_000, price_change_24h=20,
        age_hours=24, social_buzz=0.5, tokenomics_safety=90
    )
    assert score <= 100


# ── AI Defense ───────────────────────────────────────────────────────────────

def test_defense_pump_dump_critical():
    from ml.ai_defense import run_defense_checks
    result = run_defense_checks(
        "XYZ/USDT", price_change_24h=250, price_change_1h=30,
        volume_24h=500_000, liquidity=100_000, age_hours=12
    )
    assert result["recommendation"] == "BLOCK"
    assert result["defense_score"] == 0
    assert result["critical_count"] >= 1


def test_defense_clear():
    from ml.ai_defense import run_defense_checks
    result = run_defense_checks("BTC/USDT")
    assert result["recommendation"] == "CLEAR"
    assert result["defense_score"] == 100
    assert result["alert_count"] == 0


def test_defense_flash_crash():
    from ml.ai_defense import run_defense_checks
    result = run_defense_checks(
        "ETH/USDT", price_change_1h=-15, atr_pct=7
    )
    assert result["recommendation"] in ("BLOCK", "WARN")
    assert any(a["alert_type"] == "flash_crash" for a in result["alerts"])


def test_defense_liquidity_drain():
    from ml.ai_defense import run_defense_checks
    result = run_defense_checks(
        "ALT/USDT", liquidity=50_000, liquidity_24h_ago=200_000
    )
    assert result["recommendation"] == "BLOCK"
    assert any(a["alert_type"] == "liquidity_drain" for a in result["alerts"])


def test_defense_social_manipulation():
    from ml.ai_defense import run_defense_checks
    result = run_defense_checks(
        "SCAM/USDT", social_score=0.6, social_volume=80,
        price_change_24h=40, liquidity=50_000
    )
    assert any(a["alert_type"] == "social_manipulation" for a in result["alerts"])


# ── Scientific Backtest ──────────────────────────────────────────────────────

def test_sortino_ratio():
    from ml.scientific_backtest import compute_sortino
    returns = [2.0, -1.0, 3.0, -0.5, 1.5, -2.0, 2.5, 0.5]
    sortino = compute_sortino(returns)
    assert isinstance(sortino, float)


def test_calmar_ratio():
    from ml.scientific_backtest import compute_calmar
    returns = [2.0, -1.0, 3.0, -0.5, 1.5, -2.0, 2.5, 0.5]
    equity = [10000]
    for r in returns:
        equity.append(equity[-1] * (1 + r / 100))
    calmar = compute_calmar(returns, equity)
    assert isinstance(calmar, float)


def test_monte_carlo_basic():
    from ml.scientific_backtest import monte_carlo_simulation
    trades = [
        {"pnl_pct": 2.0, "win": True},
        {"pnl_pct": -1.0, "win": False},
        {"pnl_pct": 3.0, "win": True},
        {"pnl_pct": -0.5, "win": False},
        {"pnl_pct": 1.5, "win": True},
        {"pnl_pct": -2.0, "win": False},
        {"pnl_pct": 2.5, "win": True},
        {"pnl_pct": 0.5, "win": True},
        {"pnl_pct": -1.0, "win": False},
        {"pnl_pct": 3.5, "win": True},
    ]
    result = monte_carlo_simulation(trades, simulations=100)
    assert "final_capital" in result
    assert "max_drawdown" in result
    assert "win_rate" in result
    assert result["simulations"] == 100


def test_walk_forward_validation():
    from ml.scientific_backtest import walk_forward_validation
    trades = []
    for i in range(200):
        trades.append({"pnl": 100 if i % 3 != 0 else -50, "win": i % 3 != 0, "pnl_pct": 1.0 if i % 3 != 0 else -0.5})

    result = walk_forward_validation(trades, train_window=50, test_window=25, step=25)
    assert "windows" in result
    assert "overfit_verdict" in result
    assert len(result["windows"]) > 0


def test_overfitting_detection():
    from ml.scientific_backtest import detect_overfitting
    result = detect_overfitting(
        {"win_rate": 70, "profit_factor": 3.0, "sharpe": 2.0, "pnl": 10000},
        {"win_rate": 50, "profit_factor": 1.2, "sharpe": 0.5, "pnl": 2000},
    )
    assert result["verdict"] in ("SEVERE_OVERFITTING", "MODERATE_OVERFITTING")
    assert len(result["checks"]) == 4


def test_risk_of_ruin():
    from ml.scientific_backtest import compute_risk_of_ruin
    # High win rate + good R/R → low risk of ruin
    ror = compute_risk_of_ruin(win_rate=65, risk_reward=2.0, risk_pct=1.0)
    assert ror < 5.0

    # Low win rate → high risk of ruin
    ror_bad = compute_risk_of_ruin(win_rate=35, risk_reward=1.0, risk_pct=2.0)
    assert ror_bad > 50.0
