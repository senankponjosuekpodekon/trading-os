"""
Scientific Backtesting Endpoints — Phase O
Exposes advanced backtesting metrics: Sortino, Calmar, Monte Carlo,
walk-forward validation, and overfitting detection.
"""
from typing import Any, Dict, List
from fastapi import APIRouter
from pydantic import BaseModel, Field

from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


class TradeData(BaseModel):
    pnl: float = 0
    pnl_pct: float = 0
    win: bool = False
    rr_achieved: float = 0


class ScientificReportRequest(BaseModel):
    trades: List[Dict[str, Any]]
    equity: List[float]
    initial_capital: float = 10_000
    risk_pct: float = 1.0
    mc_simulations: int = 1000
    wf_train_window: int = 100
    wf_test_window: int = 50
    wf_step: int = 25


class OverfitCheckRequest(BaseModel):
    in_sample: Dict[str, float] = Field(..., description="win_rate, profit_factor, sharpe, pnl")
    out_sample: Dict[str, float] = Field(..., description="Same keys from out-of-sample")


@router.post("/backtest/scientific-report")
async def scientific_report(body: ScientificReportRequest):
    """POST /backtest/scientific-report — Full scientific backtesting report."""
    from ml.scientific_backtest import generate_scientific_report
    return generate_scientific_report(
        body.trades,
        body.equity,
        initial_capital=body.initial_capital,
        risk_pct=body.risk_pct,
        mc_simulations=body.mc_simulations,
        wf_train_window=body.wf_train_window,
        wf_test_window=body.wf_test_window,
        wf_step=body.wf_step,
    )


@router.post("/backtest/monte-carlo")
async def monte_carlo_endpoint(body: ScientificReportRequest):
    """POST /backtest/monte-carlo — Monte Carlo simulation only."""
    from ml.scientific_backtest import monte_carlo_simulation
    return monte_carlo_simulation(
        body.trades,
        initial_capital=body.initial_capital,
        risk_pct=body.risk_pct,
        simulations=body.mc_simulations,
    )


@router.post("/backtest/walk-forward")
async def walk_forward_endpoint(body: ScientificReportRequest):
    """POST /backtest/walk-forward — Walk-forward validation only."""
    from ml.scientific_backtest import walk_forward_validation
    return walk_forward_validation(
        body.trades,
        train_window=body.wf_train_window,
        test_window=body.wf_test_window,
        step=body.wf_step,
    )


@router.post("/backtest/overfitting-check")
async def overfitting_check(body: OverfitCheckRequest):
    """POST /backtest/overfitting-check — Compare in-sample vs out-of-sample."""
    from ml.scientific_backtest import detect_overfitting
    return detect_overfitting(body.in_sample, body.out_sample)


@router.get("/backtest/advanced-metrics")
async def advanced_metrics_info():
    """GET /backtest/advanced-metrics — Available advanced metrics documentation."""
    return {
        "metrics": {
            "sortino_ratio": "Downside-adjusted Sharpe ratio — penalizes only negative volatility",
            "calmar_ratio": "Annualized return / max drawdown — risk-adjusted performance",
            "max_consecutive_losses": "Longest losing streak — psychological risk metric",
            "risk_of_ruin": "Probability of losing entire account given win rate, R/R, risk %",
            "monte_carlo": "Bootstrap simulation of trade sequences — confidence intervals on outcomes",
            "walk_forward": "Train on window, test on next — detects overfitting via performance degradation",
            "overfitting_detection": "Compares in-sample vs out-of-sample metrics across multiple dimensions",
        },
        "interpretation": {
            "sortino_ratio": "> 2 = excellent, > 1 = good, < 0 = negative expectation",
            "calmar_ratio": "> 3 = excellent, > 1 = good, < 0 = losing strategy",
            "risk_of_ruin": "< 1% = safe, 1-5% = moderate, > 5% = dangerous",
            "monte_carlo_prob_of_loss": "< 10% = robust, 10-30% = moderate, > 30% = risky",
            "walk_forward_verdict": "ROBUST > MILD_OVERFITTING > MODERATE_OVERFITTING > SEVERE_OVERFITTING",
        },
    }
