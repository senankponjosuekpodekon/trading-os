"""
Portfolio Rebalancing — Phase L
Analyzes current portfolio allocation and suggests rebalancing actions.
Considers: cluster concentration, drawdown, performance drift, risk budget.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)

# Target allocation by risk profile
TARGET_ALLOCATION: dict[str, dict[str, float]] = {
    "conservative": {
        "CRYPTO_MAJOR": 0.30,
        "FOREX": 0.20,
        "METALS": 0.20,
        "COMMODITIES": 0.10,
        "US_STOCKS": 0.10,
        "US_INDICES": 0.05,
        "SYNTHETIC": 0.05,
        "BRVM": 0.00,
    },
    "moderate": {
        "CRYPTO_MAJOR": 0.40,
        "FOREX": 0.15,
        "METALS": 0.15,
        "COMMODITIES": 0.10,
        "US_STOCKS": 0.10,
        "US_INDICES": 0.05,
        "SYNTHETIC": 0.05,
        "BRVM": 0.00,
    },
    "aggressive": {
        "CRYPTO_MAJOR": 0.50,
        "FOREX": 0.10,
        "METALS": 0.10,
        "COMMODITIES": 0.05,
        "US_STOCKS": 0.15,
        "US_INDICES": 0.05,
        "SYNTHETIC": 0.05,
        "BRVM": 0.00,
    },
}

MAX_CLUSTER_DEVIATION = 0.15  # 15% drift triggers rebalance suggestion
MAX_SINGLE_POSITION_PCT = 0.25  # 25% max per single position


@dataclass
class RebalanceAction:
    symbol: str
    cluster: str
    current_weight: float
    target_weight: float
    deviation: float
    action: str  # reduce | increase | exit | enter
    reason: str
    priority: str  # high | medium | low


def compute_rebalancing(
    positions: List[Dict[str, Any]],
    *,
    profile: str = "moderate",
    total_capital: Optional[float] = None,
    portfolio_risk: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Analyze portfolio and produce rebalancing suggestions.

    Args:
        positions: List of position dicts with symbol, pnl_pct, entry_value, cluster
        profile: Risk profile (conservative | moderate | aggressive)
        total_capital: Current portfolio capital
        portfolio_risk: Output from analyze_portfolio_risk (cluster alerts)
    """
    target = TARGET_ALLOCATION.get(profile, TARGET_ALLOCATION["moderate"])

    if not positions:
        return {
            "actions": [],
            "summary": "No open positions to rebalance",
            "profile": profile,
            "target_allocation": target,
            "current_allocation": {},
        }

    # Compute current allocation by cluster
    total_value = total_capital or sum(p.get("current_value", p.get("entry_value", 0)) for p in positions)
    if total_value <= 0:
        return {
            "actions": [],
            "summary": "Unable to compute portfolio value",
            "profile": profile,
            "target_allocation": target,
            "current_allocation": {},
        }

    cluster_values: dict[str, float] = {}
    position_values: dict[str, float] = {}
    for p in positions:
        val = p.get("current_value", p.get("entry_value", 0))
        symbol = p.get("symbol", "")
        cluster = p.get("cluster", "UNKNOWN")

        cluster_values[cluster] = cluster_values.get(cluster, 0) + val
        position_values[symbol] = position_values.get(symbol, 0) + val

    current_alloc = {k: round(v / total_value, 4) for k, v in cluster_values.items()}

    # Check for cluster alerts from portfolio_risk
    cluster_alerts = {}
    if portfolio_risk and portfolio_risk.get("alerts"):
        for alert in portfolio_risk["alerts"]:
            cluster_alerts[alert.get("cluster", "")] = alert

    actions: List[RebalanceAction] = []

    # 1. Cluster deviation analysis
    for cluster, target_pct in target.items():
        current_pct = current_alloc.get(cluster, 0)
        deviation = current_pct - target_pct

        if abs(deviation) > MAX_CLUSTER_DEVIATION:
            if deviation > 0:
                # Overweight — suggest reducing
                actions.append(RebalanceAction(
                    symbol="*",
                    cluster=cluster,
                    current_weight=round(current_pct, 4),
                    target_weight=target_pct,
                    deviation=round(deviation, 4),
                    action="reduce",
                    reason=f"Overweight {cluster}: {current_pct*100:.1f}% vs target {target_pct*100:.1f}% — reduce by {deviation*100:.1f}%",
                    priority="high" if deviation > 0.25 else "medium",
                ))
            elif current_pct > 0:
                # Underweight — suggest increasing
                actions.append(RebalanceAction(
                    symbol="*",
                    cluster=cluster,
                    current_weight=round(current_pct, 4),
                    target_weight=target_pct,
                    deviation=round(deviation, 4),
                    action="increase",
                    reason=f"Underweight {cluster}: {current_pct*100:.1f}% vs target {target_pct*100:.1f}% — increase by {abs(deviation)*100:.1f}%",
                    priority="low",
                ))

    # 2. Single position concentration
    for symbol, value in position_values.items():
        weight = value / total_value
        if weight > MAX_SINGLE_POSITION_PCT:
            cluster = next((p.get("cluster", "UNKNOWN") for p in positions if p.get("symbol") == symbol), "UNKNOWN")
            actions.append(RebalanceAction(
                symbol=symbol,
                cluster=cluster,
                current_weight=round(weight, 4),
                target_weight=MAX_SINGLE_POSITION_PCT,
                deviation=round(weight - MAX_SINGLE_POSITION_PCT, 4),
                action="reduce",
                reason=f"Single position {symbol} at {weight*100:.1f}% — exceeds {MAX_SINGLE_POSITION_PCT*100:.0f}% limit",
                priority="high",
            ))

    # 3. Loss-cutting: positions with significant drawdown
    for p in positions:
        pnl_pct = p.get("pnl_pct", p.get("pnlPercent", 0))
        if pnl_pct is not None and pnl_pct < -15:
            symbol = p.get("symbol", "")
            cluster = p.get("cluster", "UNKNOWN")
            weight = position_values.get(symbol, 0) / total_value
            actions.append(RebalanceAction(
                symbol=symbol,
                cluster=cluster,
                current_weight=round(weight, 4),
                target_weight=0,
                deviation=round(weight, 4),
                action="exit",
                reason=f"{symbol} down {pnl_pct:.1f}% — consider cutting losses",
                priority="high" if pnl_pct < -25 else "medium",
            ))

    # 4. Cluster alert-based actions
    for cluster, alert in cluster_alerts.items():
        if alert.get("severity") == "HIGH":
            actions.append(RebalanceAction(
                symbol="*",
                cluster=cluster,
                current_weight=current_alloc.get(cluster, 0),
                target_weight=target.get(cluster, 0),
                deviation=round(current_alloc.get(cluster, 0) - target.get(cluster, 0), 4),
                action="reduce",
                reason=f"Risk alert: {alert.get('message', 'concentration detected')}",
                priority="high",
            ))

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    actions.sort(key=lambda a: priority_order.get(a.priority, 3))

    # Summary
    high_count = sum(1 for a in actions if a.priority == "high")
    summary = (
        f"{len(actions)} rebalancing actions suggested "
        f"({high_count} high priority) "
        f"· Profile: {profile}"
    )

    return {
        "actions": [
            {
                "symbol": a.symbol,
                "cluster": a.cluster,
                "current_weight": a.current_weight,
                "target_weight": a.target_weight,
                "deviation": a.deviation,
                "action": a.action,
                "reason": a.reason,
                "priority": a.priority,
            }
            for a in actions
        ],
        "summary": summary,
        "profile": profile,
        "target_allocation": target,
        "current_allocation": current_alloc,
        "total_value": round(total_value, 2),
    }
