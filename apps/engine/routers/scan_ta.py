"""Technical analysis helper wrappers used by the scanner."""
import pandas as pd
import pandas_ta as ta


def ema(s: pd.Series, p: int) -> pd.Series:
    return ta.ema(s, length=p)


def rsi(s: pd.Series, p: int = 14) -> pd.Series:
    return ta.rsi(s, length=p)


def atr(h: pd.Series, lo: pd.Series, c: pd.Series, p: int = 14) -> pd.Series:
    return ta.atr(h, lo, c, length=p)


def macd(s: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    out = ta.macd(s, fast=fast, slow=slow, signal=signal)
    # pandas-ta order: MACD line, histogram, signal line
    return out.iloc[:, 0], out.iloc[:, 2], out.iloc[:, 1]


def bollinger(s: pd.Series, p: int = 20, k: float = 2.0):
    out = ta.bbands(s, length=p, std=k)
    # pandas-ta order: lower, mid, upper, bandwidth, %B
    return out.iloc[:, 2], out.iloc[:, 1], out.iloc[:, 0], out.iloc[:, 3]
