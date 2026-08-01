"""
IO Observability Dashboard — JSON endpoint for the frontend.

Consolidates funnel metrics, error rates, latencies, and risk engine status
into a single JSON response consumed by the NextJS frontend at /observability.
"""
from __future__ import annotations

from fastapi import APIRouter

from utils.metrics import snapshot, reset
from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


def _build_funnel_data(labeled: dict) -> dict:
    """Extract funnel stages per strategy from labeled counters."""
    funnel_raw = labeled.get("strategy_funnel", {})
    strategies: dict[str, dict] = {}

    for key, count in funnel_raw.items():
        labels_str = key.split("{", 1)[-1].rstrip("}")
        labels = dict(pair.split("=", 1) for pair in labels_str.split(",") if "=" in pair)
        strat = labels.get("strategy", "unknown")
        stage = labels.get("stage", "unknown")

        if strat not in strategies:
            strategies[strat] = {}
        strategies[strat][stage] = count

    return strategies


def _build_error_data(labeled: dict) -> dict:
    """Extract error counts from labeled counters."""
    errors = {}
    for counter, entries in labeled.items():
        if "error" in counter or "failed" in counter:
            for key, count in entries.items():
                errors[key] = count
    return errors


@router.get("/metrics/dashboard/json")
def metrics_dashboard_json():
    """Return consolidated metrics as JSON for the frontend dashboard."""
    snap = snapshot()

    labeled = snap.get("labeled_counters", {})
    funnel = _build_funnel_data(labeled)
    errors = _build_error_data(labeled)

    # Risk engine status
    risk_status = {}
    try:
        from risk.engine import get_risk_engine
        risk_status = get_risk_engine().get_status()
    except Exception as e:
        risk_status = {"error": str(e)}

    return {
        "summary": {
            "counters": len(snap.get("counters", {})),
            "histograms": len(snap.get("histograms", {})),
            "errors": len(errors),
        },
        "funnel": funnel,
        "histograms": snap.get("histograms", {}),
        "errors": errors,
        "risk_engine": risk_status,
        "raw_counters": snap.get("counters", {}),
    }


@router.post("/metrics/reset")
def metrics_reset():
    """Reset all metrics (useful for testing)."""
    reset()
    return {"status": "reset"}
