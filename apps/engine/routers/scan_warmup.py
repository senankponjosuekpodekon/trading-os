"""Warmup orchestration and klines prefetch."""
import asyncio
import time

from utils.logger import get_logger
from routers.scan_fetchers import fetch_klines_fallback
from routers.scan_persistence import _scan_batch_flusher
from routers import scan as _scan

logger = get_logger(__name__)

BINANCE_PRIORITY_SYMBOLS = _scan.BINANCE_PRIORITY_SYMBOLS
DERIV_SYMBOLS = _scan.DERIV_SYMBOLS
FOREX_COMMODITY_SYMBOLS = _scan.FOREX_COMMODITY_SYMBOLS
US_STOCK_SYMBOLS = _scan.US_STOCK_SYMBOLS


async def prefetch_klines():
    """Pré-fetch parallèle de toutes les klines au démarrage.
    Remplit le cache en mémoire pour que le premier scan utilisateur soit instantané.
    Timeout global de 15s — les symboles non fetchés seront récupérés par les boucles warmup.
    """
    t0 = time.monotonic()
    all_symbols = BINANCE_PRIORITY_SYMBOLS + DERIV_SYMBOLS + FOREX_COMMODITY_SYMBOLS + sorted(US_STOCK_SYMBOLS)
    tf = "1h"

    async def _safe_fetch(sym: str):
        try:
            df = await fetch_klines_fallback(
                sym,
                tf,
                providers=["binance", "deriv", "yfinance"],
                timeout=6.0,
            )
            return sym, df is not None
        except Exception:
            return sym, False

    try:
        results = await asyncio.wait_for(
            asyncio.gather(*[_safe_fetch(s) for s in all_symbols], return_exceptions=True),
            timeout=15.0,
        )
        ok = sum(1 for r in results if isinstance(r, tuple) and r[1])
        logger.info("prefetch_klines_done", total=len(all_symbols), cached=ok,
                    elapsed_ms=round((time.monotonic() - t0) * 1000))
    except asyncio.TimeoutError:
        logger.warning("prefetch_klines_timeout", elapsed_ms=round((time.monotonic() - t0) * 1000))


async def _supervised_loop(name: str, coro_factory, max_restarts: int = -1):
    """Superviseur : redémarre une boucle async si elle crash.
    coro_factory est une fonction qui crée la coroutine (appelée à chaque restart).
    """
    restarts = 0
    while max_restarts < 0 or restarts <= max_restarts:
        try:
            await coro_factory()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            restarts += 1
            logger.error("warmup_loop_crashed", loop=name, restart=restarts, error=str(e))
            await asyncio.sleep(5)
        else:
            logger.info("warmup_loop_exited_normally", loop=name)
            break


async def warmup_features():
    """Point d'entrée — pré-fetch klines au démarrage puis lance les 5 boucles + batch flusher.
    Chaque boucle est supervisée et redémarre automatiquement si elle crash.
    """
    try:
        await prefetch_klines()
    except Exception as e:
        logger.warning("prefetch_klines_failed", error=str(e))

    try:
        await asyncio.gather(
            _supervised_loop("warmup_fast", _scan.warmup_fast),
            _supervised_loop("warmup_medium", _scan.warmup_medium),
            _supervised_loop("warmup_slow", _scan.warmup_slow),
            _supervised_loop("warmup_brvm", _scan.warmup_brvm),
            _supervised_loop("warmup_stocks", _scan.warmup_stocks),
            _supervised_loop("batch_flusher", _scan_batch_flusher),
            return_exceptions=True,
        )
    except Exception as e:
        logger.error("warmup_features_fatal", error=str(e))
