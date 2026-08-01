"""
Risk Engine — Shared singleton DisciplineController instance.

Provides a single entry point for all pre-trade risk evaluation.
Import get_risk_engine() anywhere in the app to access the controller.
"""
from __future__ import annotations

import os
from typing import Optional

from risk.discipline_controller import DisciplineController


_risk_engine: Optional[DisciplineController] = None


def get_risk_engine() -> DisciplineController:
    """Get or create the shared DisciplineController singleton."""
    global _risk_engine
    if _risk_engine is None:
        capital = float(os.getenv("RISK_INITIAL_CAPITAL", "10000"))
        risk_pct = float(os.getenv("RISK_BASE_PCT", "1.0"))
        _risk_engine = DisciplineController(capital=capital, risk_pct=risk_pct)
    return _risk_engine


def reset_risk_engine() -> None:
    """Reset the singleton (useful for tests)."""
    global _risk_engine
    _risk_engine = None
