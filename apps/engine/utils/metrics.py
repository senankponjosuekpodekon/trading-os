"""
Sprint 8 — Métriques basiques sans dépendance externe.
Exposition au format OpenMetrics / Prometheus text.
"""
import time
from collections import defaultdict
from typing import Any

_counters: dict[str, int] = defaultdict(int)
_histograms: dict[str, list[float]] = defaultdict(list)
_labeled_counters: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))


def inc(counter: str, value: int = 1):
    _counters[counter] += value


def inc_labeled(counter: str, labels: dict[str, str] | None = None, value: int = 1):
    """
    Increment a labeled counter.

    Labels are stored as key=value pairs in the counter key.
    Example: inc_labeled("strategy_funnel", {"strategy": "MACD", "stage": "score"})
    """
    if labels:
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        key = f"{counter}{{{label_str}}}"
    else:
        key = counter
    _labeled_counters[counter][key] += value


def observe(name: str, value: float):
    _histograms[name].append(value)


def timeit(name: str):
    """Décorateur / context manager simple pour chronométrer une fonction."""
    start = time.monotonic()
    try:
        yield
    finally:
        observe(name, (time.monotonic() - start) * 1000)


def render() -> str:
    """Rendu texte simple compatible Prometheus."""
    lines = ["# Trading OS Engine Metrics"]
    for name, value in sorted(_counters.items()):
        lines.append(f"{name} {value}")
    for counter, entries in sorted(_labeled_counters.items()):
        for key, value in sorted(entries.items()):
            lines.append(f"{counter} {key} {value}")
    for name, values in sorted(_histograms.items()):
        if not values:
            continue
        lines.append(f"{name}_count {len(values)}")
        lines.append(f"{name}_sum {sum(values):.3f}")
        lines.append(f"{name}_avg {sum(values) / len(values):.3f}")
    return "\n".join(lines)


def snapshot() -> dict[str, Any]:
    return {
        "counters": dict(_counters),
        "labeled_counters": {k: dict(v) for k, v in _labeled_counters.items()},
        "histograms": {k: {"count": len(v), "sum": sum(v), "avg": sum(v) / len(v) if v else 0} for k, v in _histograms.items()},
    }


def reset():
    """Reset all metrics (useful for tests)."""
    _counters.clear()
    _histograms.clear()
    _labeled_counters.clear()
