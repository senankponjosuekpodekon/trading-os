"""
Liquidity Structure — Detect and classify structural liquidity pools.

Identifies:
  - Equal Highs / Equal Lows (multi-touch clusters)
  - Previous Day/Week/Month High-Low
  - Session Highs/Lows (Asia, London, NY)
  - Liquidity Grab (sweep + reversal) vs Liquidity Run (breakout + continuation)

Integrates with SMC module for order block / FVG confluence.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum


class LiquidityType(Enum):
    EQUAL_HIGHS = "EQUAL_HIGHS"
    EQUAL_LOWS = "EQUAL_LOWS"
    PDH = "PREVIOUS_DAY_HIGH"
    PDL = "PREVIOUS_DAY_LOW"
    PWH = "PREVIOUS_WEEK_HIGH"
    PWL = "PREVIOUS_WEEK_LOW"
    PMH = "PREVIOUS_MONTH_HIGH"
    PML = "PREVIOUS_MONTH_LOW"
    SESSION_HIGH = "SESSION_HIGH"
    SESSION_LOW = "SESSION_LOW"
    ROUND_NUMBER = "ROUND_NUMBER"


class LiquidityBehavior(Enum):
    GRAB = "GRAB"    # Sweep + reversal (stop hunt)
    RUN = "RUN"      # Breakout + continuation
    PENDING = "PENDING"  # Not yet tested


@dataclass
class LiquidityPool:
    type: LiquidityType
    price: float
    touches: int
    indices: list[int] = field(default_factory=list)
    behavior: LiquidityBehavior = LiquidityBehavior.PENDING
    strength: float = 0.0  # 0-1, based on touches + timeframe
    swept: bool = False
    sweep_index: Optional[int] = None


@dataclass
class LiquidityAnalysis:
    pools: list[LiquidityPool]
    nearest_above: Optional[LiquidityPool]
    nearest_below: Optional[LiquidityPool]
    current_behavior: LiquidityBehavior
    grab_detected: bool
    run_detected: bool


# ── Equal Highs/Lows ──────────────────────────────────────────

def detect_equal_highs(
    df: pd.DataFrame,
    tolerance: float = 0.0008,
    min_touches: int = 2,
    lookback: Optional[int] = None,
) -> list[LiquidityPool]:
    """
    Detect equal highs clusters.

    tolerance: max relative difference between prices (0.0008 = 0.08%)
    """
    window = df if lookback is None else df.iloc[-lookback:]
    highs = window["high"].values
    indices = window.index.tolist()

    pools: list[LiquidityPool] = []
    used = set()

    for i in range(len(highs)):
        if i in used:
            continue
        cluster = [i]
        for j in range(i + 1, len(highs)):
            if j in used:
                continue
            if highs[i] > 0 and abs(highs[i] - highs[j]) / highs[i] <= tolerance:
                cluster.append(j)
                used.add(j)
        if len(cluster) >= min_touches:
            used.add(i)
            price = float(np.mean([highs[c] for c in cluster]))
            pools.append(LiquidityPool(
                type=LiquidityType.EQUAL_HIGHS,
                price=round(price, 6),
                touches=len(cluster),
                indices=[indices[c] for c in cluster],
                strength=min(0.5 + len(cluster) * 0.15, 1.0),
            ))
    return pools


def detect_equal_lows(
    df: pd.DataFrame,
    tolerance: float = 0.0008,
    min_touches: int = 2,
    lookback: Optional[int] = None,
) -> list[LiquidityPool]:
    """Detect equal lows clusters."""
    window = df if lookback is None else df.iloc[-lookback:]
    lows = window["low"].values
    indices = window.index.tolist()

    pools: list[LiquidityPool] = []
    used = set()

    for i in range(len(lows)):
        if i in used:
            continue
        cluster = [i]
        for j in range(i + 1, len(lows)):
            if j in used:
                continue
            if lows[i] > 0 and abs(lows[i] - lows[j]) / lows[i] <= tolerance:
                cluster.append(j)
                used.add(j)
        if len(cluster) >= min_touches:
            used.add(i)
            price = float(np.mean([lows[c] for c in cluster]))
            pools.append(LiquidityPool(
                type=LiquidityType.EQUAL_LOWS,
                price=round(price, 6),
                touches=len(cluster),
                indices=[indices[c] for c in cluster],
                strength=min(0.5 + len(cluster) * 0.15, 1.0),
            ))
    return pools


# ── Previous Day/Week/Month levels ────────────────────────────

def detect_previous_levels(
    df: pd.DataFrame,
    freq: str = "D",
) -> list[LiquidityPool]:
    """
    Detect previous day/week/month high-low levels.

    freq: "D" (day), "W" (week), "M" (month)
    """
    if df.empty or "high" not in df.columns:
        return []

    df = df.copy()
    if not isinstance(df.index, pd.DatetimeIndex):
        if "time" in df.columns:
            df.index = pd.to_datetime(df["time"], unit="s")
        elif "timestamp" in df.columns:
            df.index = pd.to_datetime(df["timestamp"], unit="s")
        else:
            return []

    # Resample to get period highs/lows
    resampled = df.resample(freq).agg({"high": "max", "low": "min"})
    if len(resampled) < 2:
        return []

    prev = resampled.iloc[-2]
    pools: list[LiquidityPool] = []

    type_map = {
        "D": (LiquidityType.PDH, LiquidityType.PDL, 0.8),
        "W": (LiquidityType.PWH, LiquidityType.PWL, 0.9),
        "M": (LiquidityType.PMH, LiquidityType.PML, 1.0),
    }
    hi_type, lo_type, strength = type_map.get(freq, (LiquidityType.PDH, LiquidityType.PDL, 0.8))

    if pd.notna(prev["high"]):
        pools.append(LiquidityPool(
            type=hi_type, price=round(float(prev["high"]), 6),
            touches=1, strength=strength,
        ))
    if pd.notna(prev["low"]):
        pools.append(LiquidityPool(
            type=lo_type, price=round(float(prev["low"]), 6),
            touches=1, strength=strength,
        ))
    return pools


# ── Round numbers ─────────────────────────────────────────────

def detect_round_numbers(
    current_price: float,
    count: int = 5,
) -> list[LiquidityPool]:
    """Detect significant round number levels near current price."""
    pools: list[LiquidityPool] = []
    if current_price <= 0:
        return pools

    # Determine step size based on price magnitude
    magnitude = 10 ** (int(np.log10(current_price)) - 1)
    for step in [magnitude, magnitude * 5, magnitude * 10]:
        base = int(current_price / step) * step
        for offset in range(-count, count + 1):
            level = base + offset * step
            if level > 0 and abs(level - current_price) / current_price < 0.05:
                pools.append(LiquidityPool(
                    type=LiquidityType.ROUND_NUMBER,
                    price=round(float(level), 6),
                    touches=1,
                    strength=0.3,
                ))
    # Deduplicate
    seen = set()
    unique = []
    for p in pools:
        key = round(p.price, 4)
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


# ── Grab vs Run classification ────────────────────────────────

def classify_liquidity_event(
    pool: LiquidityPool,
    df: pd.DataFrame,
    lookback: int = 5,
) -> LiquidityPool:
    """
    Classify whether a liquidity pool was grabbed (sweep + reversal)
    or run (breakout + continuation).

    Grab: price breaks the level, then reverses back within `lookback` bars
    Run: price breaks the level and continues in the same direction
    """
    if pool.swept:
        return pool

    n = len(df)
    if n < lookback:
        return pool

    recent = df.iloc[-lookback:]
    is_high = pool.type in (LiquidityType.EQUAL_HIGHS, LiquidityType.PDH,
                           LiquidityType.PWH, LiquidityType.PMH,
                           LiquidityType.SESSION_HIGH)
    is_low = pool.type in (LiquidityType.EQUAL_LOWS, LiquidityType.PDL,
                          LiquidityType.PWL, LiquidityType.PML,
                          LiquidityType.SESSION_LOW)

    if is_high:
        # Check if price went above the pool (sweep)
        swept = bool((recent["high"] > pool.price).any())
        if swept:
            pool.swept = True
            pool.sweep_index = int(recent["high"].idxmax())
            # Grab: price came back below the level
            current = float(df["close"].iloc[-1])
            if current < pool.price:
                pool.behavior = LiquidityBehavior.GRAB
            else:
                pool.behavior = LiquidityBehavior.RUN
    elif is_low:
        swept = bool((recent["low"] < pool.price).any())
        if swept:
            pool.swept = True
            pool.sweep_index = int(recent["low"].idxmin())
            current = float(df["close"].iloc[-1])
            if current > pool.price:
                pool.behavior = LiquidityBehavior.GRAB
            else:
                pool.behavior = LiquidityBehavior.RUN
    return pool


# ── Full analysis ─────────────────────────────────────────────

def analyze_liquidity(
    df: pd.DataFrame,
    current_price: Optional[float] = None,
    lookback: int = 100,
) -> LiquidityAnalysis:
    """
    Full liquidity structure analysis.

    Combines equal highs/lows, previous levels, round numbers,
    and classifies grab vs run for each pool.
    """
    pools: list[LiquidityPool] = []

    # Equal highs/lows
    pools.extend(detect_equal_highs(df, lookback=lookback))
    pools.extend(detect_equal_lows(df, lookback=lookback))

    # Previous day/week levels
    pools.extend(detect_previous_levels(df, "D"))
    pools.extend(detect_previous_levels(df, "W"))

    # Round numbers
    price = current_price or float(df["close"].iloc[-1])
    pools.extend(detect_round_numbers(price))

    # Classify each pool
    for i, pool in enumerate(pools):
        pools[i] = classify_liquidity_event(pool, df)

    # Find nearest above and below current price
    above = [p for p in pools if p.price > price]
    below = [p for p in pools if p.price < price]
    nearest_above = min(above, key=lambda p: p.price - price) if above else None
    nearest_below = max(below, key=lambda p: price - p.price) if below else None

    grab_detected = any(p.behavior == LiquidityBehavior.GRAB for p in pools)
    run_detected = any(p.behavior == LiquidityBehavior.RUN for p in pools)

    current_behavior = LiquidityBehavior.PENDING
    if grab_detected:
        current_behavior = LiquidityBehavior.GRAB
    elif run_detected:
        current_behavior = LiquidityBehavior.RUN

    return LiquidityAnalysis(
        pools=pools,
        nearest_above=nearest_above,
        nearest_below=nearest_below,
        current_behavior=current_behavior,
        grab_detected=grab_detected,
        run_detected=run_detected,
    )
