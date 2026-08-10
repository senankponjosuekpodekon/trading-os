"""
Scientific Backtesting — Phase O
Advanced backtesting metrics and validation to prevent overfitting.

Features:
  1. Sortino ratio (downside deviation only)
  2. Calmar ratio (return / max drawdown)
  3. Monte Carlo simulation (bootstrap trade sequences)
  4. Walk-forward validation (train on window, test on next)
  5. Out-of-sample testing
  6. Overfitting detection (in-sample vs out-of-sample performance gap)
  7. Confidence intervals on key metrics
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np

from utils.logger import get_logger

logger = get_logger(__name__)


# ── Advanced Metrics ──────────────────────────────────────────────────────────

def compute_sortino(returns: List[float], risk_free: float = 0.0) -> float:
    """
    Sortino ratio — like Sharpe but only penalizes downside volatility.
    Sortino = (mean_return - risk_free) / downside_std
    """
    if len(returns) < 2:
        return 0.0
    arr = np.array(returns)
    mean = np.mean(arr) - risk_free
    downside = arr[arr < 0]
    if len(downside) == 0:
        return float("inf") if mean > 0 else 0.0
    downside_std = np.std(downside)
    return round(float(mean / downside_std) if downside_std > 0 else 0.0, 3)


def compute_calmar(returns: List[float], equity: List[float], periods_per_year: int = 252) -> float:
    """
    Calmar ratio — annualized return / max drawdown.
    """
    if len(equity) < 2 or equity[0] <= 0:
        return 0.0

    total_return = (equity[-1] / equity[0]) - 1

    # Max drawdown
    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > max_dd:
            max_dd = dd

    if max_dd == 0:
        return float("inf") if total_return > 0 else 0.0
    return round(float(total_return / max_dd), 3)


def compute_max_consecutive_losses(trades: List[dict]) -> int:
    """Maximum consecutive losing trades."""
    max_streak = 0
    current = 0
    for t in trades:
        if t.get("win", False):
            current = 0
        else:
            current += 1
            max_streak = max(max_streak, current)
    return max_streak


def compute_risk_of_ruin(win_rate: float, risk_reward: float, risk_pct: float) -> float:
    """
    Probability of losing entire account given win rate, R/R, and risk per trade.
    Uses the simplified formula: RoR = ((1 - edge) / (1 + edge))^(capital_units)
    """
    if win_rate <= 0 or win_rate >= 100:
        return 0.0 if win_rate >= 100 else 100.0

    w = win_rate / 100
    l = 1 - w
    # Edge = win_rate * RR - loss_rate
    edge = w * risk_reward - l
    if edge <= 0:
        return 100.0  # Negative edge = certain ruin eventually

    # Capital units = how many losing trades to wipe out
    capital_units = int(100 / risk_pct) if risk_pct > 0 else 100
    ror = ((1 - edge) / (1 + edge)) ** capital_units
    return round(min(ror * 100, 100.0), 4)


# ── Monte Carlo Simulation ───────────────────────────────────────────────────

def monte_carlo_simulation(
    trades: List[dict],
    initial_capital: float = 10_000,
    risk_pct: float = 1.0,
    simulations: int = 1000,
    confidence_levels: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    Bootstrap Monte Carlo: randomly sample trade sequences (with replacement)
    to generate distribution of possible outcomes.

    Returns confidence intervals on:
    - Final capital
    - Max drawdown
    - Win rate
    - Profit factor
    """
    if confidence_levels is None:
        confidence_levels = [5, 25, 50, 75, 95]
    if len(trades) < 10:
        return {
            "error": "Not enough trades for Monte Carlo (minimum 10 required)",
            "simulations": 0,
        }

    # Extract trade returns (as percentage of capital risked)
    trade_returns = []
    for t in trades:
        pnl_pct = t.get("pnl_pct", 0)
        trade_returns.append(pnl_pct)

    trade_arr = np.array(trade_returns)
    n_trades = len(trade_arr)

    final_capitals = []
    max_drawdowns = []
    win_rates = []

    rng = np.random.default_rng(seed=42)

    for _ in range(simulations):
        # Bootstrap: sample with replacement
        sampled = rng.choice(trade_arr, size=n_trades, replace=True)

        # Simulate equity curve with fixed risk
        equity = [initial_capital]
        for ret in sampled:
            # Each trade risks risk_pct of current capital
            trade_pnl = equity[-1] * (ret / 100) * risk_pct
            equity.append(equity[-1] + trade_pnl)

        final_capitals.append(equity[-1])

        # Max drawdown
        peak = equity[0]
        max_dd = 0.0
        for v in equity:
            if v > peak:
                peak = v
            dd = (peak - v) / peak if peak > 0 else 0
            max_dd = max(max_dd, dd)
        max_drawdowns.append(max_dd * 100)

        # Win rate
        wins = np.sum(sampled > 0)
        win_rates.append(wins / n_trades * 100)

    # Compute confidence intervals
    final_arr = np.array(final_capitals)
    dd_arr = np.array(max_drawdowns)
    wr_arr = np.array(win_rates)

    def percentile(arr, p):
        return round(float(np.percentile(arr, p)), 2)

    results = {
        "simulations": simulations,
        "initial_capital": initial_capital,
        "risk_pct": risk_pct,
        "final_capital": {
            "mean": round(float(np.mean(final_arr)), 2),
            "median": percentile(final_arr, 50),
            "std": round(float(np.std(final_arr)), 2),
            "percentiles": {p: percentile(final_arr, p) for p in confidence_levels},
            "probability_of_loss": round(float(np.mean(final_arr < initial_capital) * 100), 2),
            "probability_of_profit": round(float(np.mean(final_arr > initial_capital) * 100), 2),
            "probability_of_2x": round(float(np.mean(final_arr > initial_capital * 2) * 100), 2),
            "probability_of_50pct_loss": round(float(np.mean(final_arr < initial_capital * 0.5) * 100), 2),
        },
        "max_drawdown": {
            "mean": round(float(np.mean(dd_arr)), 2),
            "median": percentile(dd_arr, 50),
            "worst_case_95pct": percentile(dd_arr, 95),
            "percentiles": {p: percentile(dd_arr, p) for p in confidence_levels},
        },
        "win_rate": {
            "mean": round(float(np.mean(wr_arr)), 2),
            "median": percentile(wr_arr, 50),
            "std": round(float(np.std(wr_arr)), 2),
            "percentiles": {p: percentile(wr_arr, p) for p in confidence_levels},
        },
    }

    return results


# ── Walk-Forward Validation ──────────────────────────────────────────────────

def walk_forward_validation(
    trades: List[dict],
    train_window: int = 100,
    test_window: int = 50,
    step: int = 25,
) -> Dict[str, Any]:
    """
    Walk-forward validation: train on window, test on next window.
    Detects overfitting by comparing in-sample vs out-of-sample performance.

    Args:
        trades: List of trade dicts (chronologically ordered)
        train_window: Number of trades in training window
        test_window: Number of trades in test window
        step: How many trades to step forward between windows
    """
    if len(trades) < train_window + test_window:
        return {
            "error": f"Not enough trades for walk-forward (need {train_window + test_window}, got {len(trades)})",
            "windows": [],
        }

    windows: List[Dict[str, Any]] = []
    in_sample_pnls = []
    out_sample_pnls = []

    for i in range(0, len(trades) - train_window - test_window + 1, step):
        train = trades[i:i + train_window]
        test = trades[i + train_window:i + train_window + test_window]

        # Compute metrics for each window
        train_pnl = sum(t.get("pnl", 0) for t in train)
        test_pnl = sum(t.get("pnl", 0) for t in test)
        train_wins = sum(1 for t in train if t.get("win", False))
        test_wins = sum(1 for t in test if t.get("win", False))
        train_wr = train_wins / len(train) * 100 if train else 0
        test_wr = test_wins / len(test) * 100 if test else 0

        # Degradation = how much performance drops from train to test
        pnl_degradation = ((train_pnl - test_pnl) / abs(train_pnl) * 100) if train_pnl != 0 else 0
        wr_degradation = train_wr - test_wr

        windows.append({
            "window_start": i,
            "train_trades": len(train),
            "test_trades": len(test),
            "train_pnl": round(train_pnl, 2),
            "test_pnl": round(test_pnl, 2),
            "train_win_rate": round(train_wr, 1),
            "test_win_rate": round(test_wr, 1),
            "pnl_degradation_pct": round(pnl_degradation, 1),
            "win_rate_degradation": round(wr_degradation, 1),
            "overfit_flag": pnl_degradation > 50 or wr_degradation > 15,
        })

        in_sample_pnls.append(train_pnl)
        out_sample_pnls.append(test_pnl)

    # Overall assessment
    avg_in = np.mean(in_sample_pnls) if in_sample_pnls else 0
    avg_out = np.mean(out_sample_pnls) if out_sample_pnls else 0
    overfit_windows = sum(1 for w in windows if w["overfit_flag"])

    if avg_in > 0:
        overall_degradation = ((avg_in - avg_out) / avg_in) * 100
    else:
        overall_degradation = 0

    overfit_verdict = "CLEAN"
    if overall_degradation > 60:
        overfit_verdict = "SEVERE_OVERFITTING"
    elif overall_degradation > 40:
        overfit_verdict = "MODERATE_OVERFITTING"
    elif overall_degradation > 20:
        overfit_verdict = "MILD_OVERFITTING"

    return {
        "windows": windows,
        "window_count": len(windows),
        "overfit_windows": overfit_windows,
        "avg_in_sample_pnl": round(float(avg_in), 2),
        "avg_out_sample_pnl": round(float(avg_out), 2),
        "overall_degradation_pct": round(float(overall_degradation), 1),
        "overfit_verdict": overfit_verdict,
        "summary": (
            f"{len(windows)} walk-forward windows · "
            f"avg in-sample: ${avg_in:.2f} vs out-sample: ${avg_out:.2f} · "
            f"degradation: {overall_degradation:.1f}% · "
            f"verdict: {overfit_verdict}"
        ),
    }


# ── Overfitting Detection ────────────────────────────────────────────────────

def detect_overfitting(
    in_sample_metrics: Dict[str, float],
    out_sample_metrics: Dict[str, float],
) -> Dict[str, Any]:
    """
    Compare in-sample vs out-of-sample metrics to detect overfitting.

    Args:
        in_sample_metrics: dict with win_rate, profit_factor, sharpe, pnl
        out_sample_metrics: same keys from out-of-sample test
    """
    checks: List[Dict[str, Any]] = []

    # Win rate degradation
    in_wr = in_sample_metrics.get("win_rate", 0)
    out_wr = out_sample_metrics.get("win_rate", 0)
    wr_drop = in_wr - out_wr
    checks.append({
        "metric": "win_rate",
        "in_sample": in_wr,
        "out_sample": out_wr,
        "degradation": round(wr_drop, 1),
        "overfit": wr_drop > 10,
        "severity": "high" if wr_drop > 20 else "medium" if wr_drop > 10 else "low",
    })

    # Profit factor degradation
    in_pf = in_sample_metrics.get("profit_factor", 0)
    out_pf = out_sample_metrics.get("profit_factor", 0)
    pf_drop = ((in_pf - out_pf) / in_pf * 100) if in_pf > 0 else 0
    checks.append({
        "metric": "profit_factor",
        "in_sample": in_pf,
        "out_sample": out_pf,
        "degradation_pct": round(pf_drop, 1),
        "overfit": pf_drop > 30,
        "severity": "high" if pf_drop > 50 else "medium" if pf_drop > 30 else "low",
    })

    # Sharpe degradation
    in_sharpe = in_sample_metrics.get("sharpe", 0)
    out_sharpe = out_sample_metrics.get("sharpe", 0)
    sharpe_drop = ((in_sharpe - out_sharpe) / abs(in_sharpe) * 100) if in_sharpe != 0 else 0
    checks.append({
        "metric": "sharpe",
        "in_sample": in_sharpe,
        "out_sample": out_sharpe,
        "degradation_pct": round(sharpe_drop, 1),
        "overfit": sharpe_drop > 30,
        "severity": "high" if sharpe_drop > 50 else "medium" if sharpe_drop > 30 else "low",
    })

    # PnL degradation
    in_pnl = in_sample_metrics.get("pnl", 0)
    out_pnl = out_sample_metrics.get("pnl", 0)
    pnl_drop = ((in_pnl - out_pnl) / abs(in_pnl) * 100) if in_pnl != 0 else 0
    checks.append({
        "metric": "pnl",
        "in_sample": in_pnl,
        "out_sample": out_pnl,
        "degradation_pct": round(pnl_drop, 1),
        "overfit": pnl_drop > 40,
        "severity": "high" if pnl_drop > 60 else "medium" if pnl_drop > 40 else "low",
    })

    overfit_count = sum(1 for c in checks if c.get("overfit", False))
    high_count = sum(1 for c in checks if c.get("severity") == "high")

    if high_count >= 2:
        verdict = "SEVERE_OVERFITTING"
    elif overfit_count >= 2:
        verdict = "MODERATE_OVERFITTING"
    elif overfit_count >= 1:
        verdict = "MILD_OVERFITTING"
    else:
        verdict = "ROBUST"

    return {
        "checks": checks,
        "overfit_count": overfit_count,
        "verdict": verdict,
        "summary": f"{overfit_count}/{len(checks)} metrics show overfitting · verdict: {verdict}",
    }


# ── Full Scientific Report ───────────────────────────────────────────────────

def generate_scientific_report(
    trades: List[dict],
    equity: List[float],
    *,
    initial_capital: float = 10_000,
    risk_pct: float = 1.0,
    mc_simulations: int = 1000,
    wf_train_window: int = 100,
    wf_test_window: int = 50,
    wf_step: int = 25,
) -> Dict[str, Any]:
    """
    Generate a complete scientific backtesting report with all advanced metrics.
    """
    if not trades or not equity:
        return {"error": "No trades or equity data provided"}

    # Basic returns
    returns = [t.get("pnl_pct", 0) for t in trades]

    # Advanced metrics
    sortino = compute_sortino(returns)
    calmar = compute_calmar(returns, equity)
    max_consec_losses = compute_max_consecutive_losses(trades)

    # Win rate and R/R for risk of ruin
    wins = sum(1 for t in trades if t.get("win", False))
    win_rate = wins / len(trades) * 100 if trades else 0
    avg_rr = np.mean([t.get("rr_achieved", 0) for t in trades]) if trades else 0
    risk_of_ruin = compute_risk_of_ruin(win_rate, avg_rr, risk_pct)

    # Monte Carlo
    mc_result = monte_carlo_simulation(
        trades, initial_capital, risk_pct, mc_simulations
    )

    # Walk-forward
    wf_result = walk_forward_validation(
        trades, wf_train_window, wf_test_window, wf_step
    )

    return {
        "advanced_metrics": {
            "sortino_ratio": sortino,
            "calmar_ratio": calmar,
            "max_consecutive_losses": max_consec_losses,
            "risk_of_ruin_pct": risk_of_ruin,
            "avg_risk_reward": round(float(avg_rr), 3),
        },
        "monte_carlo": mc_result,
        "walk_forward": wf_result,
        "trade_count": len(trades),
        "initial_capital": initial_capital,
        "final_capital": round(equity[-1], 2),
        "summary": (
            f"Sortino: {sortino} | Calmar: {calmar} | "
            f"Max consec losses: {max_consec_losses} | "
            f"Risk of ruin: {risk_of_ruin}% | "
            f"MC prob of profit: {mc_result.get('final_capital', {}).get('probability_of_profit', 0)}% | "
            f"WF verdict: {wf_result.get('overfit_verdict', 'N/A')}"
        ),
    }
