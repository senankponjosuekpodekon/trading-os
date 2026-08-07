"""
Market Memory System — Phase D
Persistent memory of market patterns, setups, and outcomes.
Enables cross-session learning by storing successful/failed setups
and retrieving similar patterns when new signals are generated.

Storage: PostgreSQL tables (market_memory, market_pattern_outcomes)
Retrieval: Vector similarity on feature embeddings (simplified: key-based matching)
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

from utils.logger import get_logger

logger = get_logger(__name__)

# In-memory cache for recent patterns (fallback if DB not available)
_memory_cache: Dict[str, List[Dict[str, Any]]] = {}
_pattern_outcomes: List[Dict[str, Any]] = []


@dataclass
class MarketPattern:
    pattern_id: str
    symbol: str
    timeframe: str
    signal_type: str  # BUY / SELL
    setup_type: str   # e.g. "BOS+OB", "FVG+CHOCH", "PinBar+Support"
    features: Dict[str, Any]
    outcome: Optional[str] = None  # "win" / "loss" / "breakeven" / None (pending)
    pnl_pct: Optional[float] = None
    confidence: float = 0.0
    created_at: str = ""
    resolved_at: Optional[str] = None


def _build_pattern_key(symbol: str, timeframe: str, setup_type: str, signal_type: str) -> str:
    return f"{symbol}:{timeframe}:{setup_type}:{signal_type}"


def _extract_setup_type(metadata: Dict[str, Any]) -> str:
    """Extract a canonical setup type from signal metadata."""
    parts: List[str] = []
    pa = metadata.get("price_action", {})
    smc = metadata.get("smc", {})
    pats = metadata.get("patterns", {})

    if pa.get("bos"):
        parts.append("BOS")
    if pa.get("choch"):
        parts.append("CHOCH")
    if smc.get("ob", {}).get("near_bullish_ob") or smc.get("ob", {}).get("near_bearish_ob"):
        parts.append("OB")
    if smc.get("fvg", {}).get("near_bullish_fvg") or smc.get("fvg", {}).get("near_bearish_fvg"):
        parts.append("FVG")
    if smc.get("liquidity", {}).get("near_eqh") or smc.get("liquidity", {}).get("near_eql"):
        parts.append("LIQ")
    if pats.get("pin_bar"):
        parts.append("PinBar")
    if pats.get("engulfing"):
        parts.append("Engulfing")

    return "+".join(parts) if parts else "GENERIC"


def _extract_features(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract key features for pattern matching."""
    regime = metadata.get("regime", {})
    mtf = metadata.get("mtf_context", {})
    return {
        "regime": regime.get("regime", "UNKNOWN"),
        "adx": regime.get("adx"),
        "mtf_confluence": mtf.get("confluence", "NONE"),
        "confidence": metadata.get("confidence"),
        "rr": metadata.get("risk_reward"),
        "has_news": bool(metadata.get("news_sentiment")),
        "has_social": bool(metadata.get("social_context")),
        "has_tokenomics": bool(metadata.get("tokenomics_context")),
    }


async def store_pattern(
    symbol: str,
    timeframe: str,
    signal_type: str,
    metadata: Dict[str, Any],
    signal_id: Optional[str] = None,
) -> str:
    """
    Store a market pattern in memory.
    Called when a new signal is generated.
    Returns the pattern_id.
    """
    setup_type = _extract_setup_type(metadata)
    features = _extract_features(metadata)
    pattern_id = f"{signal_id or 'pat'}_{int(time.time() * 1000)}"
    key = _build_pattern_key(symbol, timeframe, setup_type, signal_type)

    pattern = {
        "pattern_id": pattern_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "signal_type": signal_type,
        "setup_type": setup_type,
        "features": features,
        "outcome": None,
        "pnl_pct": None,
        "confidence": metadata.get("confidence", 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
        "signal_id": signal_id,
    }

    # Store in cache
    if key not in _memory_cache:
        _memory_cache[key] = []
    _memory_cache[key].append(pattern)

    # Keep last 200 patterns per key
    if len(_memory_cache[key]) > 200:
        _memory_cache[key] = _memory_cache[key][-200:]

    # Try to persist to DB
    try:
        from db import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO market_memory (pattern_id, symbol, timeframe, signal_type, setup_type, features_json, confidence, created_at, signal_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (pattern_id) DO NOTHING
                """,
                pattern_id, symbol, timeframe, signal_type, setup_type,
                json.dumps(features), pattern["confidence"],
                pattern["created_at"], signal_id,
            )
    except Exception as exc:
        logger.debug("market_memory_db_store_failed", error=str(exc))

    logger.info("market_pattern_stored", pattern_id=pattern_id, key=key, setup=setup_type)
    return pattern_id


async def resolve_pattern(pattern_id: str, outcome: str, pnl_pct: float) -> None:
    """
    Resolve a pattern with its outcome (win/loss/breakeven) and PnL.
    Called when a signal hits TP or SL.
    """
    # Update cache
    for patterns in _memory_cache.values():
        for p in patterns:
            if p["pattern_id"] == pattern_id:
                p["outcome"] = outcome
                p["pnl_pct"] = pnl_pct
                p["resolved_at"] = datetime.now(timezone.utc).isoformat()
                break

    _pattern_outcomes.append({
        "pattern_id": pattern_id,
        "outcome": outcome,
        "pnl_pct": pnl_pct,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    })

    # Try to update DB
    try:
        from db import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE market_memory SET outcome = $1, pnl_pct = $2, resolved_at = $3
                WHERE pattern_id = $4
                """,
                outcome, pnl_pct, datetime.now(timezone.utc).isoformat(), pattern_id,
            )
    except Exception as exc:
        logger.debug("market_memory_db_resolve_failed", error=str(exc))

    logger.info("market_pattern_resolved", pattern_id=pattern_id, outcome=outcome, pnl=pnl_pct)


async def recall_similar_patterns(
    symbol: str,
    timeframe: str,
    signal_type: str,
    metadata: Dict[str, Any],
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """
    Recall similar past patterns for the current setup.
    Returns list of historical patterns with outcomes.
    """
    setup_type = _extract_setup_type(metadata)
    features = _extract_features(metadata)
    key = _build_pattern_key(symbol, timeframe, setup_type, signal_type)

    # Try DB first
    try:
        from db import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM market_memory
                WHERE symbol = $1 AND timeframe = $2 AND signal_type = $3
                  AND setup_type = $4 AND outcome IS NOT NULL
                ORDER BY created_at DESC LIMIT $5
                """,
                symbol, timeframe, signal_type, setup_type, limit,
            )
            if rows:
                return [dict(r) for r in rows]
    except Exception as exc:
        logger.debug("market_memory_db_recall_failed", error=str(exc))

    # Fallback to cache
    patterns = _memory_cache.get(key, [])
    resolved = [p for p in patterns if p["outcome"] is not None]
    return resolved[-limit:]


async def get_pattern_stats(
    symbol: str,
    timeframe: str,
    signal_type: str,
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Get aggregated statistics for similar past patterns.
    Returns win rate, avg PnL, sample size, and confidence adjustment.
    """
    patterns = await recall_similar_patterns(symbol, timeframe, signal_type, metadata, limit=50)

    if not patterns:
        return {
            "sample_size": 0,
            "win_rate": None,
            "avg_pnl_pct": None,
            "confidence_adjustment": 0,
            "recommendation": "NO_HISTORY",
        }

    wins = sum(1 for p in patterns if p.get("outcome") == "win")
    losses = sum(1 for p in patterns if p.get("outcome") == "loss")
    total = len(patterns)
    win_rate = (wins / total) * 100 if total > 0 else 0

    pnls = [p.get("pnl_pct", 0) or 0 for p in patterns]
    avg_pnl = sum(pnls) / len(pnls) if pnls else 0

    # Confidence adjustment: boost if historically good, penalize if bad
    if total >= 5:
        if win_rate >= 65:
            adjustment = +5
            recommendation = "STRONG_SETUP"
        elif win_rate >= 55:
            adjustment = +2
            recommendation = "GOOD_SETUP"
        elif win_rate >= 45:
            adjustment = 0
            recommendation = "NEUTRAL_SETUP"
        elif win_rate >= 35:
            adjustment = -3
            recommendation = "WEAK_SETUP"
        else:
            adjustment = -8
            recommendation = "AVOID_SETUP"
    else:
        adjustment = 0
        recommendation = "INSUFFICIENT_SAMPLE"

    return {
        "sample_size": total,
        "win_rate": round(win_rate, 1),
        "avg_pnl_pct": round(avg_pnl, 2),
        "wins": wins,
        "losses": losses,
        "confidence_adjustment": adjustment,
        "recommendation": recommendation,
        "setup_type": _extract_setup_type(metadata),
    }


def get_memory_summary() -> Dict[str, Any]:
    """Get summary stats of the market memory system."""
    total_patterns = sum(len(p) for p in _memory_cache.values())
    total_resolved = sum(1 for p in _pattern_outcomes)
    total_wins = sum(1 for p in _pattern_outcomes if p.get("outcome") == "win")
    total_losses = sum(1 for p in _pattern_outcomes if p.get("outcome") == "loss")

    return {
        "total_patterns_stored": total_patterns,
        "total_resolved": total_resolved,
        "total_wins": total_wins,
        "total_losses": total_losses,
        "overall_win_rate": round(total_wins / max(total_resolved, 1) * 100, 1),
        "unique_setups": len(_memory_cache),
        "cache_keys": list(_memory_cache.keys())[:20],
    }


async def init_market_memory_db() -> None:
    """Create the market_memory table if it doesn't exist."""
    try:
        from db import get_pool
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS market_memory (
                    pattern_id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    signal_type TEXT NOT NULL,
                    setup_type TEXT NOT NULL,
                    features_json JSONB,
                    confidence REAL DEFAULT 0,
                    outcome TEXT,
                    pnl_pct REAL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    resolved_at TIMESTAMPTZ,
                    signal_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_market_memory_lookup
                ON market_memory (symbol, timeframe, signal_type, setup_type);
                CREATE INDEX IF NOT EXISTS idx_market_memory_outcome
                ON market_memory (outcome) WHERE outcome IS NOT NULL;
            """)
            logger.info("market_memory_table_ready")
    except Exception as exc:
        logger.warning("market_memory_init_failed", error=str(exc))
