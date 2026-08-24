"""Backtest engine for signal performance by asset and timeframe.

Supports simple long/short signal backtesting over OHLCV candles.
The engine is intentionally lightweight: plug in a DataFrame of candles
and a list of signal entries/exits, get PnL / drawdown / win-rate stats.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional, Sequence, Tuple

import pandas as pd


@dataclass
class Trade:
    entry_time: int
    exit_time: int
    side: Literal["long", "short"]
    entry_price: float
    exit_price: float
    pnl_pct: float
    pnl_usd: float = 0.0
    result: str = "open"


@dataclass
class BacktestResult:
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    total_return_pct: float = 0.0
    total_return_usd: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    profit_factor: float = 0.0
    avg_trade_pct: float = 0.0
    trades: List[Trade] = field(default_factory=list)


class BacktestEngine:
    """Run a signal-based backtest over a DataFrame of OHLCV candles."""

    def __init__(
        self,
        candles: pd.DataFrame,
        initial_capital: float = 10_000.0,
        fee_pct: float = 0.001,
        slippage_pct: float = 0.0005,
    ):
        """
        candles must have columns: time, open, high, low, close, volume
        time as int timestamp (ms or s) is expected.
        """
        self.candles = candles.copy()
        self.initial_capital = initial_capital
        self.fee_pct = fee_pct
        self.slippage_pct = slippage_pct

    def _price_at(self, idx: int, direction: Literal["entry", "exit"]) -> float:
        """Get execution price with simple slippage on close."""
        close = float(self.candles.iloc[idx]["close"])
        if direction == "entry":
            return close * (1 + self.slippage_pct)
        return close * (1 - self.slippage_pct)

    def run(
        self,
        signals: Sequence[Tuple[int, Literal["long", "short"]]],
        hold_bars: int = 5,
        stop_loss_pct: Optional[float] = None,
    ) -> BacktestResult:
        """
        signals: list of (candle_index, side)
        hold_bars: how many bars to hold before closing at market
        stop_loss_pct: optional stop-loss as fraction (e.g. 0.05 for 5%)
        """
        trades: List[Trade] = []
        n = len(self.candles)

        for idx, side in signals:
            if idx < 0 or idx >= n - 1:
                continue

            entry_price = self._price_at(idx, "entry")
            exit_idx = min(idx + hold_bars, n - 1)

            # Walk forward to find stop or target bar
            for j in range(idx + 1, exit_idx + 1):
                high = float(self.candles.iloc[j]["high"])
                low = float(self.candles.iloc[j]["low"])

                if stop_loss_pct is not None:
                    if side == "long" and low <= entry_price * (1 - stop_loss_pct):
                        exit_idx = j
                        break
                    if side == "short" and high >= entry_price * (1 + stop_loss_pct):
                        exit_idx = j
                        break

            exit_price = self._price_at(exit_idx, "exit")

            # Apply fees both sides
            if side == "long":
                gross_pnl = (exit_price - entry_price) / entry_price
            else:
                gross_pnl = (entry_price - exit_price) / entry_price

            pnl = gross_pnl - (2 * self.fee_pct) - (2 * self.slippage_pct)

            trades.append(
                Trade(
                    entry_time=int(self.candles.iloc[idx]["time"]),
                    exit_time=int(self.candles.iloc[exit_idx]["time"]),
                    side=side,
                    entry_price=entry_price,
                    exit_price=exit_price,
                    pnl_pct=round(pnl * 100, 4),
                    pnl_usd=round(self.initial_capital * pnl, 2),
                    result="win" if pnl > 0 else "loss" if pnl < 0 else "breakeven",
                )
            )

        if not trades:
            return BacktestResult()

        pnls = [t.pnl_pct / 100 for t in trades]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]

        # Equity curve
        equity = [self.initial_capital]
        for p in pnls:
            equity.append(equity[-1] * (1 + p))

        # Max drawdown
        peak = equity[0]
        max_dd = 0.0
        for val in equity:
            if val > peak:
                peak = val
            dd = (peak - val) / peak
            if dd > max_dd:
                max_dd = dd

        # Sharpe (assume 0% risk-free for daily-ish bars; simplistic)
        returns = pd.Series(pnls)
        sharpe = 0.0
        if len(returns) > 1 and returns.std() != 0:
            sharpe = round((returns.mean() / returns.std()) * (252 ** 0.5), 3)

        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        profit_factor = gross_profit / gross_loss if gross_loss != 0 else float("inf")

        total_return = (equity[-1] - self.initial_capital) / self.initial_capital

        return BacktestResult(
            total_trades=len(trades),
            winning_trades=len(wins),
            losing_trades=len(losses),
            win_rate=round(len(wins) / len(trades) * 100, 2) if trades else 0.0,
            total_return_pct=round(total_return * 100, 2),
            total_return_usd=round(equity[-1] - self.initial_capital, 2),
            max_drawdown_pct=round(max_dd * 100, 2),
            sharpe_ratio=sharpe,
            profit_factor=round(profit_factor, 2),
            avg_trade_pct=round(sum(t.pnl_pct for t in trades) / len(trades), 4),
            trades=trades,
        )
