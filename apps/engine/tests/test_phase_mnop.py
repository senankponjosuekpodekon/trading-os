"""
Integration tests for Phase M/N/O/P API endpoints.
Tests the FastAPI routers directly using TestClient.

Run: python -m pytest tests/test_phase_mnop.py -v
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Phase M — X Sentiment ────────────────────────────────────────────────────

def test_x_sentiment_router_endpoints():
    from routers.x_sentiment import router
    paths = [r.path for r in router.routes]
    assert "/x/sentiment" in paths
    assert "/x/status" in paths


def test_x_sentiment_accounts_config():
    from routers.x_sentiment import TWITTER_ACCOUNTS
    assert "crypto" in TWITTER_ACCOUNTS
    assert len(TWITTER_ACCOUNTS["crypto"]) > 5
    # Check some known accounts
    all_accounts = [a for accounts in TWITTER_ACCOUNTS.values() for a in accounts]
    assert any("bitcoin" in a.lower() or "crypto" in a.lower() for a in all_accounts)


def test_x_api_status_structure():
    from routers.x_sentiment import _can_use_x_api
    status = _can_use_x_api()
    assert isinstance(status, bool)


# ── Phase N — Pre-listing alpha ──────────────────────────────────────────────

def test_pre_listing_router_endpoints():
    from routers.pre_listing import router
    paths = [r.path for r in router.routes]
    assert "/pre-listing/discover" in paths
    assert "/pre-listing/analyze/{symbol}" in paths


def test_asymmetric_score_fully_audited_ieo():
    from routers.pre_listing import _compute_asymmetric_score
    score, risks, opps = _compute_asymmetric_score(
        funding_pct=90, audit_status="audited", social_buzz=500,
        has_website=True, has_twitter=True, listing_type="IEO",
        platform="Binance Launchpad",
    )
    assert score >= 80
    assert any("audited" in o.lower() for o in opps)
    assert any("IEO" in o for o in opps)


def test_asymmetric_score_unaudited_presale():
    from routers.pre_listing import _compute_asymmetric_score
    score, risks, opps = _compute_asymmetric_score(
        funding_pct=20, audit_status="none", social_buzz=10,
        has_website=False, has_twitter=False, listing_type="presale",
        platform="unknown",
    )
    assert score < 30
    assert any("audit" in r.lower() for r in risks)
    assert any("scam" in r.lower() or "presale" in r.lower() or "online" in r.lower() for r in risks)


def test_asymmetric_score_max_100():
    from routers.pre_listing import _compute_asymmetric_score
    score, _, _ = _compute_asymmetric_score(
        funding_pct=100, audit_status="audited", social_buzz=1000,
        has_website=True, has_twitter=True, listing_type="IEO",
        platform="Binance Launchpad",
    )
    assert score <= 100


# ── Phase O — Scientific backtesting ─────────────────────────────────────────

def test_scientific_backtest_router_endpoints():
    from routers.scientific_backtest_router import router
    paths = [r.path for r in router.routes]
    assert "/backtest/scientific-report" in paths
    assert "/backtest/monte-carlo" in paths
    assert "/backtest/walk-forward" in paths
    assert "/backtest/overfitting-check" in paths
    assert "/backtest/advanced-metrics" in paths


def test_sortino_positive_returns():
    from ml.scientific_backtest import compute_sortino
    returns = [1.0, 2.0, 3.0, 1.5, 2.5]
    sortino = compute_sortino(returns)
    # All positive returns → no downside deviation → high sortino
    assert sortino > 0


def test_sortino_with_losses():
    from ml.scientific_backtest import compute_sortino
    returns = [2.0, -1.0, 3.0, -2.0, 1.0, -1.5]
    sortino = compute_sortino(returns)
    assert isinstance(sortino, float)


def test_calmar_with_drawdown():
    from ml.scientific_backtest import compute_calmar
    returns = [5.0, -10.0, 5.0, 3.0]
    equity = [10000]
    for r in returns:
        equity.append(equity[-1] * (1 + r / 100))
    calmar = compute_calmar(returns, equity)
    assert isinstance(calmar, float)


def test_monte_carlo_simulation_structure():
    from ml.scientific_backtest import monte_carlo_simulation
    trades = [
        {"pnl_pct": 2.0, "win": True, "pnl": 200},
        {"pnl_pct": -1.0, "win": False, "pnl": -100},
        {"pnl_pct": 3.0, "win": True, "pnl": 300},
        {"pnl_pct": -0.5, "win": False, "pnl": -50},
        {"pnl_pct": 1.5, "win": True, "pnl": 150},
        {"pnl_pct": -2.0, "win": False, "pnl": -200},
        {"pnl_pct": 2.5, "win": True, "pnl": 250},
        {"pnl_pct": 0.5, "win": True, "pnl": 50},
        {"pnl_pct": -1.0, "win": False, "pnl": -100},
        {"pnl_pct": 3.5, "win": True, "pnl": 350},
        {"pnl_pct": -0.5, "win": False, "pnl": -50},
        {"pnl_pct": 1.0, "win": True, "pnl": 100},
    ]
    result = monte_carlo_simulation(trades, simulations=50)
    assert "final_capital" in result
    assert "max_drawdown" in result
    assert "win_rate" in result
    assert result["simulations"] == 50
    assert "probability_of_profit" in result["final_capital"]
    assert "probability_of_loss" in result["final_capital"]
    assert "percentiles" in result["final_capital"]


def test_walk_forward_multiple_windows():
    from ml.scientific_backtest import walk_forward_validation
    trades = []
    for i in range(300):
        trades.append({"pnl": 100 if i % 3 != 0 else -50, "win": i % 3 != 0, "pnl_pct": 1.0 if i % 3 != 0 else -0.5})
    result = walk_forward_validation(trades, train_window=80, test_window=40, step=40)
    assert len(result["windows"]) >= 2
    assert "overfit_verdict" in result
    for w in result["windows"]:
        assert "train_pnl" in w
        assert "test_pnl" in w
        assert "pnl_degradation_pct" in w


def test_overfitting_detection_all_metrics():
    from ml.scientific_backtest import detect_overfitting
    result = detect_overfitting(
        {"win_rate": 75, "profit_factor": 3.5, "sharpe": 2.5, "pnl": 15000},
        {"win_rate": 45, "profit_factor": 1.0, "sharpe": 0.3, "pnl": 500},
    )
    assert result["verdict"] == "SEVERE_OVERFITTING"
    assert len(result["checks"]) == 4
    assert all(c["overfit"] for c in result["checks"])


def test_overfitting_detection_robust():
    from ml.scientific_backtest import detect_overfitting
    result = detect_overfitting(
        {"win_rate": 55, "profit_factor": 1.5, "sharpe": 1.0, "pnl": 2000},
        {"win_rate": 52, "profit_factor": 1.4, "sharpe": 0.9, "pnl": 1800},
    )
    assert result["verdict"] in ("ROBUST", "MILD_OVERFITTING")


def test_risk_of_ruin_high_win_rate():
    from ml.scientific_backtest import compute_risk_of_ruin
    ror = compute_risk_of_ruin(win_rate=70, risk_reward=2.0, risk_pct=1.0)
    assert ror < 1.0  # Very low risk of ruin


def test_risk_of_ruin_low_win_rate():
    from ml.scientific_backtest import compute_risk_of_ruin
    ror = compute_risk_of_ruin(win_rate=30, risk_reward=1.0, risk_pct=3.0)
    assert ror > 50.0  # Very high risk of ruin


# ── Phase P — On-chain pre-listing signals ───────────────────────────────────

def test_onchain_prelisting_router_endpoints():
    from routers.onchain_prelisting import router
    paths = [r.path for r in router.routes]
    assert "/pre-listing/signals/{symbol}" in paths


def test_smart_money_addresses_config():
    from routers.onchain_prelisting import SMART_MONEY_ADDRESSES
    assert "ethereum" in SMART_MONEY_ADDRESSES
    assert "solana" in SMART_MONEY_ADDRESSES
    eth_addresses = SMART_MONEY_ADDRESSES["ethereum"]
    assert len(eth_addresses) > 0
    # Addresses are strings, not dicts
    assert any(addr.startswith("0x") for addr in eth_addresses)


def test_smart_money_address_structure():
    from routers.onchain_prelisting import SMART_MONEY_ADDRESSES
    for chain, addresses in SMART_MONEY_ADDRESSES.items():
        assert len(addresses) > 0
        for addr in addresses:
            assert isinstance(addr, str)
            assert len(addr) > 10  # Valid address length


# ── XGBoost Shadow Mode ──────────────────────────────────────────────────────

def test_shadow_stats_initial():
    from ml.xgboost_shadow import get_shadow_stats, reset_shadow_stats
    reset_shadow_stats()
    stats = get_shadow_stats()
    assert stats["total_predictions"] == 0
    assert stats["agreement_rate"] == 0


def test_shadow_stats_after_reset():
    from ml.xgboost_shadow import reset_shadow_stats, get_shadow_stats
    reset_shadow_stats()
    stats = get_shadow_stats()
    assert stats["total_predictions"] == 0
    assert "started_at" in stats


# ── Cron jobs ────────────────────────────────────────────────────────────────

def test_cron_module_imports():
    from utils.crons import run_all_crons, cron_daily_pulse, cron_hidden_gems, cron_portfolio_rebalance
    assert callable(run_all_crons)
    assert callable(cron_daily_pulse)
    assert callable(cron_hidden_gems)
    assert callable(cron_portfolio_rebalance)


def test_cron_intervals():
    from utils.crons import DAILY_PULSE_INTERVAL, HIDDEN_GEMS_INTERVAL, REBALANCE_INTERVAL
    assert DAILY_PULSE_INTERVAL == 3600
    assert HIDDEN_GEMS_INTERVAL == 1800
    assert REBALANCE_INTERVAL == 3600 * 6
