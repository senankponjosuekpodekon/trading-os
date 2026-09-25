"""
Unit tests for Phase L ML modules: portfolio_rebalancing, hidden_gems, ai_defense.
Run: python -m pytest tests/test_phase_l.py -v
"""
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


def test_gem_score_honeypot_capped():
    from ml.hidden_gems import _compute_gem_score
    score, _, warnings = _compute_gem_score(
        liquidity=500_000, volume_24h=2_000_000, price_change_24h=15, age_hours=48,
        onchain={"available": True, "honeypot": True, "top10_pct": 20,
                 "holder_count": 5000, "lp_locked_pct": 80},
    )
    assert score <= 15
    assert any("honeypot" in w.lower() for w in warnings)


def test_gem_score_whale_concentration_penalty():
    from ml.hidden_gems import _compute_gem_score
    concentrated, _, warnings = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=15, age_hours=48,
        onchain={"available": True, "top10_pct": 75, "holder_count": 3000},
    )
    distributed, _, _ = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=15, age_hours=48,
        onchain={"available": True, "top10_pct": 20, "holder_count": 3000},
    )
    assert distributed > concentrated
    assert any("concentration" in w.lower() for w in warnings)


def test_gem_score_buy_flow_bonus():
    from ml.hidden_gems import _compute_gem_score
    with_flow, reasons, _ = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=15, age_hours=48,
        buys_24h=800, sells_24h=400,
    )
    without_flow, _, _ = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=15, age_hours=48,
    )
    assert with_flow > without_flow
    assert any("buy" in r.lower() for r in reasons)


def test_gem_score_sell_flow_penalty():
    from ml.hidden_gems import _compute_gem_score
    score, _, warnings = _compute_gem_score(
        liquidity=200_000, volume_24h=500_000, price_change_24h=15, age_hours=48,
        buys_24h=200, sells_24h=800,
    )
    assert any("sell" in w.lower() for w in warnings)


def _snap(ts, price=1.0, liquidity=100_000, volume=50_000, holders=1000,
          top10=30.0, buys=600, sells=400):
    return {"ts": ts, "price": price, "liquidity": liquidity,
            "volume_24h": volume, "holders": holders, "top10_pct": top10,
            "buys": buys, "sells": sells}


def test_trajectory_insufficient_history():
    from ml.hidden_gems import _compute_trajectory
    assert _compute_trajectory([])["snapshots"] == 0
    assert _compute_trajectory([_snap(1000)])["tracked_hours"] == 0.0


def test_trajectory_growth_detection():
    from ml.hidden_gems import _compute_trajectory
    import time
    now = int(time.time())
    history = [
        _snap(now, holders=3000, liquidity=200_000, buys=700, sells=300),
        _snap(now - 43200, holders=2000, liquidity=150_000, buys=650, sells=350),
        _snap(now - 86400, holders=1000, liquidity=100_000, buys=600, sells=400),
    ]
    traj = _compute_trajectory(history)
    assert traj["snapshots"] == 3
    assert traj["tracked_hours"] == 24.0
    assert traj["holder_growth_pct"] == 200.0  # 1000 → 3000 sur ~24h
    assert traj["buy_ratio_avg"] == 0.65  # moyenne de 0.7, 0.65, 0.6
    assert traj["liquidity_growth_pct"] == 100.0


def test_score_trajectory_moonshot():
    from ml.hidden_gems import _score_trajectory
    pts, reasons, warnings, moonshot = _score_trajectory({
        "snapshots": 20, "tracked_hours": 12.0,
        "holder_growth_pct": 120.0, "liquidity_growth_pct": 60.0,
        "buy_ratio_avg": 0.62, "price_change_pct": 80.0, "top10_trend": -8.0,
    })
    assert moonshot is True
    assert pts > 10
    assert any("holder" in r.lower() for r in reasons)


def test_score_trajectory_declining():
    from ml.hidden_gems import _score_trajectory
    pts, _, warnings, moonshot = _score_trajectory({
        "snapshots": 10, "tracked_hours": 48.0,
        "holder_growth_pct": -60.0, "buy_ratio_avg": 0.35,
        "price_change_pct": -70.0,
    })
    assert moonshot is False
    assert pts < 0
    assert any("shrinking" in w.lower() or "bleeding" in w.lower() for w in warnings)


def test_parse_goplus_evm():
    from ml.hidden_gems import _parse_goplus_evm
    sec = {
        "holder_count": "5000",
        "holders": [{"percent": "0.20"}, {"percent": "0.10"}],
        "lp_holders": [{"percent": "0.8", "is_locked": 1}, {"percent": "0.2", "is_locked": 0}],
        "is_honeypot": "0", "is_mintable": "1", "is_proxy": "1",
        "is_open_source": "1", "hidden_owner": "0",
        "buy_tax": "0.03", "sell_tax": "0.03", "creator_percent": "0.02",
    }
    out = _parse_goplus_evm(sec)
    assert out["available"] is True
    assert out["holder_count"] == 5000
    assert out["top10_pct"] == 30.0
    assert out["lp_locked_pct"] == 80.0
    assert out["mintable"] is True
    assert out["buy_tax"] == 3.0
    assert out["honeypot"] is False


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


# ── Manipulation detection & under-the-radar ────────────────────────────────

def test_manipulation_wash_trading_flag():
    from ml.hidden_gems import _detect_manipulation
    m = _detect_manipulation(
        liquidity=100_000, volume_24h=2_000_000,  # 20x — volume fabriqué
        buys_24h=2000, sells_24h=1900,
        onchain={"available": True, "holder_count": 500},
    )
    assert m["penalty"] < 0
    assert any("wash" in f.lower() for f in m["flags"])
    assert m["txns_per_holder"] == 7.8


def test_manipulation_bot_churn_flag():
    from ml.hidden_gems import _detect_manipulation
    m = _detect_manipulation(
        liquidity=200_000, volume_24h=400_000,
        buys_24h=5000, sells_24h=5050,  # churn équilibré + 40 txns/holder
        onchain={"available": True, "holder_count": 250},
    )
    assert m["penalty"] <= -11  # bot churn -6 + balanced churn -5
    assert any("bot" in f.lower() for f in m["flags"])
    assert any("churn" in f.lower() for f in m["flags"])


def test_manipulation_lp_expiring_soon():
    from ml.hidden_gems import _detect_manipulation
    m = _detect_manipulation(
        liquidity=200_000, volume_24h=400_000,
        buys_24h=600, sells_24h=400,
        onchain={"available": True, "holder_count": 2000,
                 "lp_locked_pct": 90, "lp_min_unlock_days": 3.0},
    )
    assert m["penalty"] == -10
    assert any("rug" in f.lower() for f in m["flags"])


def test_manipulation_clean_token():
    from ml.hidden_gems import _detect_manipulation
    m = _detect_manipulation(
        liquidity=500_000, volume_24h=1_000_000,
        buys_24h=800, sells_24h=500,
        onchain={"available": True, "holder_count": 5000},
    )
    assert m["penalty"] == 0
    assert m["price_impact_1k_pct"] == 0.2


def test_under_the_radar_flag():
    from ml.hidden_gems import _is_under_the_radar
    # Croissance holders forte + buzz quasi nul + score correct → sous le radar
    assert _is_under_the_radar(
        {"honeypot": False}, social_buzz=0.05,
        trajectory={"holder_growth_pct": 45, "snapshots": 10}, score=60,
    ) is True
    # Buzz élevé → déjà pricé, pas "sous le radar"
    assert _is_under_the_radar(
        {"honeypot": False}, social_buzz=0.5,
        trajectory={"holder_growth_pct": 45}, score=60,
    ) is False
    # Honeypot → jamais sous le radar
    assert _is_under_the_radar(
        {"honeypot": True}, social_buzz=0.05,
        trajectory={"holder_growth_pct": 45}, score=60,
    ) is False
    # Pas de trajectoire → pas de preuve de fondamentaux forts
    assert _is_under_the_radar(
        {"honeypot": False}, social_buzz=0.05,
        trajectory={}, score=60,
    ) is False


# ── Majors tracker & non-EVM GoPlus ─────────────────────────────────────────

def test_major_trajectory_growth():
    from ml.majors_tracker import _major_trajectory
    import time
    now = int(time.time())
    hist = [{"ts": now - i * 1800, "price": 100 - i, "mcap": 1e9,
             "volume": 1e8 if i < 12 else 5e7} for i in range(24)]
    traj = _major_trajectory(hist)
    assert traj["snapshots"] == 24
    assert traj["price_change_pct"] > 0  # prix monte dans le temps
    assert traj["volume_trend_pct"] == 100.0  # 1e8 vs 5e7


def test_major_comment_accumulation():
    from ml.majors_tracker import _major_comment
    c = _major_comment("Bitcoin", {
        "price_change_pct": 3.0, "volume_trend_pct": 45.0, "tracked_hours": 72,
    })
    assert "accumulation" in c or "volume" in c


def test_goplus_generic_parser_tron():
    from ml.hidden_gems import _parse_goplus_generic
    sec = _parse_goplus_generic({
        "holder_count": "5000",
        "holders": [{"percent": "0.30"}, {"percent": "0.20"}],
        "is_honeypot": "0", "is_mintable": "0", "buy_tax": "0.02",
        "sell_tax": "0.60",  # 60% de sell tax → honeypot de fait
    })
    assert sec["available"] is True
    assert sec["holder_count"] == 5000
    assert sec["honeypot"] is True
    assert sec["top10_pct"] == 50.0


class TestUpsideEstimate:
    def test_multiple_and_bucket(self):
        from ml.hidden_gems import _estimate_upside
        u = _estimate_upside(5_000_000, "Meme", {"dogecoin": 30_000_000_000})
        assert u["multiple"] == 6000.0 and u["bucket"] == "1000x+"
        assert u["benchmark"] == "dogecoin"

    def test_buckets(self):
        from ml.hidden_gems import _estimate_upside
        assert _estimate_upside(1e9, "DeFi", {"uniswap": 8e9})["bucket"] == "~10x"
        assert _estimate_upside(1e9, "DeFi", {"uniswap": 60e9})["bucket"] == "~50x"
        assert _estimate_upside(1e9, "DeFi", {"uniswap": 300e9})["bucket"] == "~250x"

    def test_no_upside_when_too_close_or_unknown(self):
        from ml.hidden_gems import _estimate_upside
        assert _estimate_upside(1e9, "DeFi", {"uniswap": 4e9}) is None  # <5x
        assert _estimate_upside(0, "DeFi", {"uniswap": 8e9}) is None   # fdv inconnu
        assert _estimate_upside(1e9, None, {"uniswap": 8e9}) is None   # pas de narrative
        assert _estimate_upside(1e9, "Stablecoin", {}) is None         # pas de leader
