"""
Correlation ID — Request tracing across the full signal pipeline.

Generates and propagates a unique correlation_id for each scan request,
allowing end-to-end tracing from API call → fetch → evaluate_strategy → risk → response.
"""
from __future__ import annotations

import uuid
from contextvars import ContextVar
from typing import Optional

# ContextVar for async-safe correlation ID propagation
_correlation_id: ContextVar[Optional[str]] = ContextVar("correlation_id", default=None)


def set_correlation_id(corr_id: Optional[str] = None) -> str:
    """
    Set the correlation ID for the current async context.
    Generates a new UUID if none provided.
    Returns the ID that was set.
    """
    cid = corr_id or str(uuid.uuid4())[:12]
    _correlation_id.set(cid)
    return cid


def get_correlation_id() -> Optional[str]:
    """Get the correlation ID for the current async context."""
    return _correlation_id.get()


def clear_correlation_id() -> None:
    """Clear the correlation ID (useful at end of request)."""
    _correlation_id.set(None)


def with_correlation_id(corr_id: Optional[str] = None):
    """
    Decorator that sets a correlation ID for the duration of a function call.

    Usage:
        @with_correlation_id()
        async def analyze_candles(...):
            ...
    """
    import functools

    def decorator(func):
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            set_correlation_id(corr_id)
            try:
                return await func(*args, **kwargs)
            finally:
                clear_correlation_id()

        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            set_correlation_id(corr_id)
            try:
                return func(*args, **kwargs)
            finally:
                clear_correlation_id()

        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator
