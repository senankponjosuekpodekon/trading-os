"""
Shared asyncpg connection pool — single pool for all engine modules.

Reduces connection count from 4 independent pools (xgboost_scorer, signal_scorer,
rag, llm) to 1 shared pool. Each module calls get_shared_pool() instead of
creating its own asyncpg.create_pool().

Pool size: min_size=2, max_size=10 (sufficient for concurrent engine workloads).
"""
from __future__ import annotations

import asyncio
from typing import Optional

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

_shared_pool: Optional[object] = None
_lock = asyncio.Lock()


def _db_url() -> str:
    return (
        settings.database_url
        .replace("postgresql+asyncpg://", "postgresql://")
        .replace("postgres://", "postgresql://")
    )


async def get_shared_pool():
    """Return the singleton shared asyncpg pool, creating it on first call."""
    global _shared_pool
    if _shared_pool is None:
        async with _lock:
            if _shared_pool is None:
                import asyncpg
                _shared_pool = await asyncpg.create_pool(
                    _db_url(),
                    min_size=2,
                    max_size=10,
                )
                logger.info("shared_db_pool_created", min_size=2, max_size=10)
    return _shared_pool


async def close_shared_pool() -> None:
    """Close the shared pool on engine shutdown."""
    global _shared_pool
    if _shared_pool is not None:
        await _shared_pool.close()
        _shared_pool = None
        logger.info("shared_db_pool_closed")
