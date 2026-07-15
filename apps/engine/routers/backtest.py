"""
Backtesting Engine — rejoue la logique de scan sur données historiques.
Paramètres : symbole, timeframe, période, règles stratégie.
Métriques : win rate, PnL total, max drawdown, Sharpe ratio, nb trades.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import numpy as np
import asyncio

from routers.scan import fetch_binance_klines, analyze_candles, TF_MAP

router = APIRouter()


# ─── Modèles ──────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol:          str   = "BTC/USDT"
    timeframe:       str   = "1h"
    lookback_bars:   int   = 500       # Nombre de bougies historiques
    initial_capital: float = 10000.0
    risk_pct:        float = 1.0       # % capital risqué par trade
    min_confidence:  float = 55.0      # Seuil minimum confiance
    use_smc:         bool  = True
    use_pa:          bool  = True
    strategy:        Optional[dict] = None  # Stratégie DSL dynamique (Testeur Lab)

class TradeResult(BaseModel):
    entry_bar:   int
    exit_bar:    int
    direction:   str
    entry_price: float
    exit_price:  float
    pnl:         float
    pnl_pct:     float
    rr_achieved: float
    confidence:  float
    signal_reasons: list[str]
    win:         bool

class BacktestResult(BaseModel):
    symbol:          str
    timeframe:       str
    bars_analyzed:   int
    trades:          int
    wins:            int
    losses:          int
    win_rate:        float
    total_pnl:       float
    total_pnl_pct:   float
    max_drawdown:    float
    max_drawdown_pct: float
    sharpe_ratio:    float
    avg_rr:          float
    avg_pnl_pct:     float
    expectancy:      float
    profit_factor:   float
    final_capital:   float
    equity_curve:    list[float]
    trade_list:      list[dict]
    benchmark_pnl_pct: float
    outperformance_pct: float


# ─── Helpers ──────────────────────────────────────────────────────────────────

def compute_sharpe(returns: list[float], risk_free: float = 0.0) -> float:
    if len(returns) < 2:
        return 0.0
    arr  = np.array(returns)
    mean = np.mean(arr) - risk_free
    std  = np.std(arr)
    return round(float(mean / std * np.sqrt(252)) if std > 0 else 0.0, 3)


def compute_max_drawdown(equity: list[float]) -> tuple[float, float]:
    peak = equity[0]
    max_dd     = 0.0
    max_dd_pct = 0.0
    for v in equity:
        if v > peak:
            peak = v
        dd     = peak - v
        dd_pct = dd / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd     = dd
            max_dd_pct = dd_pct
    return round(max_dd, 2), round(max_dd_pct, 2)


# ─── Moteur de backtest ───────────────────────────────────────────────────────

async def run_backtest(req: BacktestRequest) -> BacktestResult:
    tf = TF_MAP.get(req.timeframe, "1h")

    # Récupérer plus de données (max Binance = 1000 bougies)
    limit = min(req.lookback_bars + 50, 1000)
    df = await fetch_binance_klines(req.symbol, tf, limit=limit)

    if df is None or len(df) < 60:
        raise ValueError("Pas assez de données historiques")

    capital   = req.initial_capital
    equity    = [capital]
    trades: list[dict] = []

    warm_up    = 50   # bougies de chauffe pour indicateurs
    in_trade   = False
    entry_bar  = 0
    entry_price = 0.0
    direction  = ""
    stop_loss  = 0.0
    take_profit = 0.0
    trade_conf  = 0.0
    trade_reasons: list[str] = []

    for i in range(warm_up, len(df)):
        bar_close = float(df["close"].iloc[i])
        bar_high  = float(df["high"].iloc[i])
        bar_low   = float(df["low"].iloc[i])

        # ── Gérer la sortie d'un trade en cours ──
        if in_trade:
            hit_sl = hit_tp = False
            if direction == "BUY":
                hit_sl = bar_low  <= stop_loss
                hit_tp = bar_high >= take_profit
            else:
                hit_sl = bar_high >= stop_loss
                hit_tp = bar_low  <= take_profit

            if hit_tp or hit_sl or (i - entry_bar >= 24):
                exit_price = take_profit if hit_tp else (stop_loss if hit_sl else bar_close)
                sl_dist    = abs(entry_price - stop_loss)
                risk_amt   = capital * req.risk_pct / 100
                qty        = risk_amt / sl_dist if sl_dist > 0 else 0

                if direction == "BUY":
                    pnl = (exit_price - entry_price) * qty
                else:
                    pnl = (entry_price - exit_price) * qty

                pnl_pct    = pnl / capital * 100
                rr_dist    = abs(take_profit - entry_price)
                rr_achieved = rr_dist / sl_dist if sl_dist > 0 else 0

                capital += pnl
                equity.append(capital)

                trades.append({
                    "entry_bar":    entry_bar,
                    "exit_bar":     i,
                    "direction":    direction,
                    "entry_price":  round(entry_price, 4),
                    "exit_price":   round(exit_price, 4),
                    "pnl":          round(pnl, 2),
                    "pnl_pct":      round(pnl_pct, 3),
                    "rr_achieved":  round(rr_achieved, 2),
                    "confidence":   trade_conf,
                    "signal_reasons": trade_reasons[:3],
                    "win":          pnl > 0,
                    "exit_reason":  "TP" if hit_tp else ("SL" if hit_sl else "TIMEOUT"),
                })
                in_trade = False
            continue

        # ── Scanner la bougie courante ──
        window = df.iloc[max(0, i - 200):i + 1].copy()
        result = analyze_candles(req.symbol, req.timeframe, window, strategy=req.strategy)

        sig  = result.get("signal", "NEUTRAL")
        conf = result.get("confidence", 0)

        if sig == "NEUTRAL" or conf < req.min_confidence:
            continue

        # Utiliser les niveaux SL/TP calculés par le moteur (stratégie dynamique ou défaut)
        stop_loss = result.get("stop_loss")
        take_profit = result.get("take_profit_1")
        if stop_loss is None or take_profit is None:
            atr_val = result.get("indicators", {}).get("atr", bar_close * 0.01)
            if sig == "BUY":
                stop_loss   = bar_close - atr_val * 1.5
                take_profit = bar_close + atr_val * 2.5
            else:
                stop_loss   = bar_close + atr_val * 1.5
                take_profit = bar_close - atr_val * 2.5

        sl_dist = abs(bar_close - stop_loss)
        risk_amt = capital * req.risk_pct / 100
        if sl_dist == 0 or risk_amt <= 0:
            continue

        in_trade    = True
        entry_bar   = i
        entry_price = bar_close
        direction   = sig
        trade_conf  = conf
        trade_reasons = result.get("reasons", [])

    # ── Statistiques ──────────────────────────────────────────────────────────
    n_trades = len(trades)
    wins     = [t for t in trades if t["win"]]
    losses   = [t for t in trades if not t["win"]]
    win_rate = len(wins) / n_trades * 100 if n_trades > 0 else 0

    gross_profit = sum(t["pnl"] for t in wins)
    gross_loss   = abs(sum(t["pnl"] for t in losses))
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 99.0

    total_pnl     = sum(t["pnl"] for t in trades)
    total_pnl_pct = total_pnl / req.initial_capital * 100
    avg_rr        = np.mean([t["rr_achieved"] for t in trades]) if trades else 0
    avg_pnl_pct   = np.mean([t["pnl_pct"] for t in trades]) if trades else 0

    avg_win  = np.mean([t["pnl_pct"] for t in wins]) if wins else 0
    avg_loss = np.mean([t["pnl_pct"] for t in losses]) if losses else 0
    win_rate_dec = win_rate / 100
    expectancy = (win_rate_dec * avg_win) - ((1 - win_rate_dec) * abs(avg_loss)) if trades else 0

    pnl_returns = [t["pnl_pct"] / 100 for t in trades]
    sharpe      = compute_sharpe(pnl_returns)
    dd, dd_pct  = compute_max_drawdown(equity)

    # Benchmark : buy & hold sur la période
    start_price = float(df["close"].iloc[warm_up])
    end_price   = float(df["close"].iloc[-1])
    benchmark_pnl_pct = (end_price - start_price) / start_price * 100
    outperformance_pct = total_pnl_pct - benchmark_pnl_pct

    return BacktestResult(
        symbol          = req.symbol,
        timeframe       = req.timeframe,
        bars_analyzed   = len(df) - warm_up,
        trades          = n_trades,
        wins            = len(wins),
        losses          = len(losses),
        win_rate        = round(win_rate, 1),
        total_pnl       = round(total_pnl, 2),
        total_pnl_pct   = round(total_pnl_pct, 2),
        max_drawdown    = dd,
        max_drawdown_pct = dd_pct,
        sharpe_ratio    = sharpe,
        avg_rr          = round(float(avg_rr), 2),
        avg_pnl_pct     = round(float(avg_pnl_pct), 3),
        expectancy      = round(float(expectancy), 3),
        profit_factor   = profit_factor,
        final_capital   = round(capital, 2),
        equity_curve    = [round(v, 2) for v in equity],
        trade_list      = trades,
        benchmark_pnl_pct = round(benchmark_pnl_pct, 2),
        outperformance_pct = round(outperformance_pct, 2),
    )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/backtest/run", response_model=BacktestResult)
async def backtest_run(req: BacktestRequest):
    return await run_backtest(req)


@router.post("/backtest/multi")
async def backtest_multi(requests: list[BacktestRequest]):
    results = await asyncio.gather(*[run_backtest(r) for r in requests])
    return [r.model_dump() for r in results]
