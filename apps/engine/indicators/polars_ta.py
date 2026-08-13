"""Polars-native technical indicators — Rust multi-threaded, zero pandas dependency.

All functions take a Polars DataFrame with OHLCV columns and return a Polars DataFrame
with indicator columns appended. This avoids the overhead of pandas_ta's single-threaded
Python implementation and the conversion cost of Polars↔Pandas round-trips.

Usage:
    df_pl = pl.from_pandas(df_pd)
    df_pl = compute_all_indicators(df_pl, ema_fast=20, ema_slow=50, ema_trend=200, rsi_period=14)
    last = df_pl.height - 1
    e20_val = df_pl["ema_fast"][last]
"""
from __future__ import annotations

import polars as pl


def compute_all_indicators(
    df: pl.DataFrame,
    ema_fast: int = 20,
    ema_slow: int = 50,
    ema_trend: int = 200,
    rsi_period: int = 14,
    atr_period: int = 14,
    macd_fast: int = 12,
    macd_slow: int = 26,
    macd_signal: int = 9,
    bb_period: int = 20,
    bb_std: float = 2.0,
    vol_period: int = 20,
) -> pl.DataFrame:
    """Compute all TA indicators in a single Polars pass (multi-threaded Rust).

    Adds columns: ema_fast, ema_slow, ema_trend, rsi, atr,
    macd_line, macd_signal, macd_hist,
    bb_upper, bb_mid, bb_lower, bb_bw,
    vol_sma.
    """
    n = df.height

    exprs: list[pl.Expr] = []

    # ── EMA ──
    exprs.append(pl.col("close").ewm_mean(span=ema_fast, adjust=False).alias("ema_fast"))
    exprs.append(pl.col("close").ewm_mean(span=ema_slow, adjust=False).alias("ema_slow"))
    if n >= ema_trend:
        exprs.append(pl.col("close").ewm_mean(span=ema_trend, adjust=False).alias("ema_trend"))
    else:
        exprs.append(pl.lit(None).cast(pl.Float64).alias("ema_trend"))

    # ── RSI (Wilder's smoothing) ──
    delta = pl.col("close").diff()
    gain = pl.when(delta > 0).then(delta).otherwise(0.0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0.0)
    avg_gain = gain.ewm_mean(alpha=1.0 / rsi_period, adjust=False).alias("_avg_gain")
    avg_loss = loss.ewm_mean(alpha=1.0 / rsi_period, adjust=False).alias("_avg_loss")
    rs = avg_gain / avg_loss
    rsi_expr = pl.when(avg_loss == 0).then(pl.lit(100.0)).otherwise(
        100.0 - (100.0 / (1.0 + rs))
    ).alias("rsi")
    exprs.append(avg_gain)
    exprs.append(avg_loss)
    exprs.append(rsi_expr)

    # ── ATR (Wilder's) ──
    prev_close = pl.col("close").shift(1)
    tr = pl.max_horizontal(
        pl.col("high") - pl.col("low"),
        (pl.col("high") - prev_close).abs(),
        (pl.col("low") - prev_close).abs(),
    )
    atr_expr = tr.ewm_mean(alpha=1.0 / atr_period, adjust=False).alias("atr")
    exprs.append(tr.alias("_tr"))
    exprs.append(atr_expr)

    # ── MACD line (pass 1) ──
    ema_f = pl.col("close").ewm_mean(span=macd_fast, adjust=False)
    ema_s = pl.col("close").ewm_mean(span=macd_slow, adjust=False)
    exprs.append((ema_f - ema_s).alias("macd_line"))

    # ── Bollinger Bands ──
    bb_mid = pl.col("close").rolling_mean(window_size=bb_period)
    bb_std_val = pl.col("close").rolling_std(window_size=bb_period)
    exprs.append((bb_mid + bb_std * bb_std_val).alias("bb_upper"))
    exprs.append(bb_mid.alias("bb_mid"))
    exprs.append((bb_mid - bb_std * bb_std_val).alias("bb_lower"))
    exprs.append(
        ((((bb_mid + bb_std * bb_std_val) - (bb_mid - bb_std * bb_std_val)) / bb_mid) * 100.0).alias("bb_bw")
    )

    # ── Volume SMA ──
    exprs.append(pl.col("volume").rolling_mean(window_size=vol_period).alias("vol_sma"))

    # Pass 1: all independent indicators
    df = df.with_columns(exprs)

    # Drop intermediate columns
    df = df.drop(["_avg_gain", "_avg_loss", "_tr"])

    # Pass 2: MACD signal (depends on macd_line from pass 1)
    df = df.with_columns(
        pl.col("macd_line").ewm_mean(span=macd_signal, adjust=False).alias("macd_signal")
    )

    # Pass 3: MACD histogram (depends on macd_line + macd_signal)
    df = df.with_columns(
        (pl.col("macd_line") - pl.col("macd_signal")).alias("macd_hist")
    )

    return df


def get_indicator_values(df: pl.DataFrame) -> dict:
    """Extract last-bar indicator values from a DataFrame produced by compute_all_indicators.

    Returns a dict with scalar values ready for use in scoring logic.
    """
    if df.height == 0:
        return {}

    last = df.height - 1

    def _val(col: str, offset: int = 0) -> float | None:
        idx = last + offset
        if idx < 0 or idx >= df.height:
            return None
        v = df[col][idx]
        if v is None:
            return None
        return round(float(v), 6)

    return {
        "ema_fast": _val("ema_fast"),
        "ema_slow": _val("ema_slow"),
        "ema_trend": _val("ema_trend"),
        "rsi": _val("rsi"),
        "atr": _val("atr"),
        "macd_line": _val("macd_line"),
        "macd_signal": _val("macd_signal"),
        "macd_hist": _val("macd_hist"),
        "macd_prev_hist": _val("macd_hist", offset=-1),
        "bb_upper": _val("bb_upper"),
        "bb_mid": _val("bb_mid"),
        "bb_lower": _val("bb_lower"),
        "bb_bw": _val("bb_bw"),
        "vol_sma": _val("vol_sma"),
    }
