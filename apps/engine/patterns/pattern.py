"""
Base abstraction for chart / harmonic patterns.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MarketPattern:
    """Represents a detected market pattern with tradeable levels."""

    name: str
    category: str  # e.g. reversal, continuation
    direction: str  # BUY | SELL | NEUTRAL
    confidence: float  # 0.0 - 1.0
    points: dict[str, Any] = field(default_factory=dict)
    prz: dict[str, float] | None = None
    entry: float | None = None
    stop_loss: float | None = None
    targets: list[float] = field(default_factory=list)
    confluence: list[str] = field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "category": self.category,
            "direction": self.direction,
            "confidence": round(self.confidence, 4),
            "points": self.points,
            "prz": self.prz,
            "entry": self.entry,
            "stop_loss": self.stop_loss,
            "targets": self.targets,
            "confluence": self.confluence,
            "reason": self.reason,
        }
