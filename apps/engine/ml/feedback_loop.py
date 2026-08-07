"""
Self-Learning Feedback Loop — Phase D
Automatically evaluates signal outcomes and feeds them back into the ML model
for continuous improvement.

Flow:
1. Signal generated → stored in market_memory
2. Signal resolved (TP/SL hit) → outcome recorded
3. Periodically: retrain the signal scorer with new outcomes
4. Adjust confidence based on historical pattern performance

This creates a closed loop: generate → execute → evaluate → learn → improve
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.logger import get_logger

logger = get_logger(__name__)

# Track signals that need resolution checking
_pending_signals: Dict[str, Dict[str, Any]] = {}

# Feedback stats
_feedback_stats: Dict[str, Any] = {
    "total_evaluated": 0,
    "total_wins": 0,
    "total_losses": 0,
    "total_breakeven": 0,
    "retriggers": 0,
    "last_retrain": None,
    "last_evaluation": None,
}


async def register_signal_for_tracking(
    signal_id: str,
    symbol: str,
    timeframe: str,
    signal_type: str,
    entry_price: float,
    stop_loss: float,
    take_profit1: Optional[float],
    metadata: Dict[str, Any],
) -> None:
    """
    Register a new signal for outcome tracking.
    Called when a signal is generated and stored.
    """
    from ml.market_memory import store_pattern

    pattern_id = await store_pattern(
        symbol, timeframe, signal_type, metadata, signal_id=signal_id,
    )

    _pending_signals[signal_id] = {
        "pattern_id": pattern_id,
        "symbol": symbol,
        "timeframe": timeframe,
        "signal_type": signal_type,
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "take_profit1": take_profit1,
        "metadata": metadata,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info("signal_registered_for_tracking", signal_id=signal_id, pattern_id=pattern_id)


async def check_and_resolve_signals(live_prices: Dict[str, float]) -> List[Dict[str, Any]]:
    """
    Check pending signals against live prices and resolve those that hit TP or SL.
    Returns list of resolved signals.
    """
    from ml.market_memory import resolve_pattern

    resolved: List[Dict[str, Any]] = []

    for signal_id, info in list(_pending_signals.items()):
        symbol = info["symbol"]
        price_key = symbol.replace("/", "")
        live_price = live_prices.get(price_key) or live_prices.get(symbol)

        if live_price is None:
            continue

        entry = info["entry_price"]
        sl = info["stop_loss"]
        tp1 = info["take_profit1"]
        is_buy = info["signal_type"] == "BUY"

        outcome = None
        pnl_pct = 0.0

        # Check SL hit
        if is_buy and live_price <= sl:
            outcome = "loss"
            pnl_pct = ((live_price - entry) / entry) * 100
        elif not is_buy and live_price >= sl:
            outcome = "loss"
            pnl_pct = ((entry - live_price) / entry) * 100
        # Check TP hit
        elif tp1 is not None:
            if is_buy and live_price >= tp1:
                outcome = "win"
                pnl_pct = ((live_price - entry) / entry) * 100
            elif not is_buy and live_price <= tp1:
                outcome = "win"
                pnl_pct = ((entry - live_price) / entry) * 100

        if outcome:
            await resolve_pattern(info["pattern_id"], outcome, pnl_pct)

            resolved.append({
                "signal_id": signal_id,
                "pattern_id": info["pattern_id"],
                "symbol": symbol,
                "outcome": outcome,
                "pnl_pct": round(pnl_pct, 2),
                "live_price": live_price,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            })

            # Update stats
            _feedback_stats["total_evaluated"] += 1
            if outcome == "win":
                _feedback_stats["total_wins"] += 1
            elif outcome == "loss":
                _feedback_stats["total_losses"] += 1
            else:
                _feedback_stats["total_breakeven"] += 1

            del _pending_signals[signal_id]

            logger.info("signal_resolved", signal_id=signal_id, outcome=outcome, pnl=pnl_pct)

    if resolved:
        _feedback_stats["last_evaluation"] = datetime.now(timezone.utc).isoformat()

    return resolved


async def auto_retrain_if_needed(min_new_outcomes: int = 20) -> Optional[Dict[str, Any]]:
    """
    Automatically retrain the signal scorer if enough new outcomes have been collected.
    Returns training result if retrain happened, None otherwise.
    """
    new_outcomes = _feedback_stats["total_evaluated"]
    last_retrain_count = _feedback_stats.get("last_retrain_evaluated_count", 0)
    pending_new = new_outcomes - last_retrain_count

    if pending_new < min_new_outcomes:
        return None

    logger.info("auto_retrain_triggered", new_outcomes=pending_new, total=new_outcomes)

    try:
        from ml.signal_scorer import signal_scorer
        result = await signal_scorer.train(market=None, timeframe=None, limit=500)

        _feedback_stats["retriggers"] += 1
        _feedback_stats["last_retrain"] = datetime.now(timezone.utc).isoformat()
        _feedback_stats["last_retrain_evaluated_count"] = new_outcomes

        logger.info("auto_retrain_complete", result=result)
        return result
    except Exception as exc:
        logger.warning("auto_retrain_failed", error=str(exc))
        return None


async def get_feedback_stats() -> Dict[str, Any]:
    """Get current feedback loop statistics."""
    total = _feedback_stats["total_evaluated"]
    win_rate = round(_feedback_stats["total_wins"] / max(total, 1) * 100, 1) if total > 0 else 0

    return {
        **_feedback_stats,
        "pending_signals": len(_pending_signals),
        "win_rate": win_rate,
        "pending_signal_ids": list(_pending_signals.keys())[:10],
    }


async def feedback_loop_tick(live_prices: Dict[str, float]) -> Dict[str, Any]:
    """
    Main feedback loop tick — called periodically (e.g. every 30s).
    1. Check and resolve pending signals
    2. Auto-retrain if enough new data
    3. Return summary
    """
    resolved = await check_and_resolve_signals(live_prices)
    retrain_result = await auto_retrain_if_needed()
    stats = await get_feedback_stats()

    return {
        "resolved_count": len(resolved),
        "resolved": resolved[:5],  # Last 5
        "retrain_triggered": retrain_result is not None,
        "retrain_result": retrain_result,
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
