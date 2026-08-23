"""Warmup orchestration and klines prefetch."""
import asyncio
import random
import time

from utils.circuit_breaker import BREAKERS, State as BreakerState
from utils.logger import get_logger
from utils.cache import set_cached
from utils.asset_config import (
    load_asset_config,
    is_market_active,
    is_warmup_enabled,
    get_max_strategies,
    get_scan_interval,
    get_timeframes as get_config_timeframes,
)
from routers.scan import _load_active_strategies, fetch_and_analyze
from routers.scan_fetchers import fetch_klines_fallback
from routers.scan_market_hours import _is_brvm_open, _is_nyse_open
from routers.scan_persistence import _persist_scan, _try_ingest_signal, _scan_batch_flusher
from routers.scan_symbols import (
    BINANCE_PRIORITY_SYMBOLS,
    DERIV_SYMBOLS,
    BRVM_SYMBOLS,
    FOREX_COMMODITY_SYMBOLS,
)
from routers.symbol_mappings import US_STOCK_SYMBOLS
from routers.scan import WARMUP_INTERVAL_FAST, WARMUP_TIMEFRAMES_FAST, WARMUP_TTL_FAST
from routers.scan import WARMUP_INTERVAL_MEDIUM, WARMUP_TIMEFRAMES_MEDIUM, WARMUP_TTL_MEDIUM
from routers.scan import WARMUP_INTERVAL_SLOW, WARMUP_TIMEFRAMES_SLOW, WARMUP_TTL_SLOW
from routers.scan import WARMUP_INTERVAL_BRVM, WARMUP_TTL_BRVM
from routers.scan import WARMUP_INTERVAL_STOCKS, WARMUP_TIMEFRAMES_STOCKS, WARMUP_TTL_STOCKS

logger = get_logger(__name__)


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
            _supervised_loop("warmup_fast", warmup_fast),
            _supervised_loop("warmup_medium", _scan.warmup_medium),
            _supervised_loop("warmup_slow", _scan.warmup_slow),
            _supervised_loop("warmup_brvm", _scan.warmup_brvm),
            _supervised_loop("warmup_stocks", _scan.warmup_stocks),
            _supervised_loop("batch_flusher", _scan_batch_flusher),
            return_exceptions=True,
        )
    except Exception as e:
        logger.error("warmup_features_fatal", error=str(e))


async def warmup_fast():
    """Boucle rapide — actifs Binance prioritaires, cycle 60s.
    Binance REST est gratuit et sans limite raisonnable.
    Couvre 15m et 1h pour le day trading.
    Parallélisé : tous les symboles scannés en un seul asyncio.gather.
    """
    logger.info("warmup_fast_start", symbols=len(BINANCE_PRIORITY_SYMBOLS), interval=WARMUP_INTERVAL_FAST)
    while True:
        t0 = time.monotonic()

        # Refresh asset config
        await load_asset_config()
        if not is_market_active("CRYPTO"):
            await asyncio.sleep(60)
            continue
        if not is_warmup_enabled("CRYPTO"):
            await asyncio.sleep(60)
            continue

        # Skip entire cycle if Binance batch circuit breaker is OPEN
        breaker = BREAKERS.get("binance_batch")
        if breaker and breaker.state == BreakerState.OPEN.value:
            logger.info("warmup_fast_skipped", reason="binance_batch_circuit_open")
            await asyncio.sleep(get_scan_interval("CRYPTO", WARMUP_INTERVAL_FAST))
            continue

        strategies = await _load_active_strategies()
        _max_strats = get_max_strategies("CRYPTO")
        if _max_strats and strategies:
            strategies = strategies[:_max_strats]
        _timeframes = get_config_timeframes("CRYPTO", WARMUP_TIMEFRAMES_FAST)
        _interval = get_scan_interval("CRYPTO", WARMUP_INTERVAL_FAST)

        async def _scan_one(sym: str, timeframe: str, strat):
            try:
                res = await fetch_and_analyze(sym, timeframe, strategy=strat)
                if res and not isinstance(res, Exception):
                    suffix = f":{strat['id']}" if strat else ""
                    await set_cached(f"scan:{sym}:{timeframe}{suffix}", res, ttl=WARMUP_TTL_FAST)
                    await _persist_scan(res, timeframe)
                    await _try_ingest_signal(res, timeframe)
            except Exception as e:
                logger.warning("warmup_fast_failed", symbol=sym, tf=timeframe,
                               error_type=type(e).__name__, error=repr(e))

        _BATCH_SIZE = 1  # Sequential to minimize CPU spikes
        for timeframe in _timeframes:
            all_syms = list(BINANCE_PRIORITY_SYMBOLS)
            for i in range(0, len(all_syms), _BATCH_SIZE):
                batch = all_syms[i:i + _BATCH_SIZE]
                tasks = [
                    _scan_one(sym, timeframe, None)
                    for sym in batch
                ]
                await asyncio.gather(*tasks, return_exceptions=True)
            logger.info("warmup_fast_done", timeframe=timeframe,
                        symbols=len(BINANCE_PRIORITY_SYMBOLS),
                        elapsed_ms=round((time.monotonic() - t0) * 1000))
        # Attendre le reste du cycle
        elapsed = time.monotonic() - t0
        wait = max(1, _interval - elapsed)
        wait += random.uniform(0, _interval * 0.2)
        await asyncio.sleep(wait)
