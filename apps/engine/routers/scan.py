from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict
import json
import httpx
import asyncio
import time
import pandas as pd
import pandas_ta as ta
import atexit
from concurrent.futures import ThreadPoolExecutor

from routers.price_action import detect_market_structure, price_action_bonus
from routers.synthetic_engine import analyze_synthetic, evaluate_synthetic_strategy, SYMBOL_TO_DERIV as SYNTHETIC_SYMBOLS
from routers.boom_crash_model import analyze_boom_crash
from routers.sr_zones import get_sr_zones, sr_bonus
from utils.deriv_symbols import to_wire_symbol
from routers.patterns import scan_last_patterns, patterns_bonus
from patterns.detector import detect_all as detect_chart_patterns
from patterns.confluence import score_pattern_confluence
from routers.regime import detect_regime, regime_bonus, regime_filter
from routers.smc import analyze_smc, smc_bonus
from routers import ws as ws_module
from routers.news import get_news_sentiment, NewsRequest
from routers.news_scraper import scrape_all_sources, aggregate_sentiment
from routers.brvm import is_brvm_symbol, analyze_brvm_symbols
from routers.forex_context import should_suspend_forex
from routers.portfolio_risk import analyze_portfolio_risk, get_cluster
from routers.strategy_eval import parse_rules, evaluate_strategy, derive_profile_suitability
from routers.onchain import is_crypto_symbol, onchain_context, onchain_bonus
from routers.onchain_advanced import (
    get_advanced_onchain_context,
    advanced_onchain_bonus,
)
from routers.tokenomics import fetch_tokenomics, tokenomics_penalty
from routers.social_sentiment import fetch_social_metrics, social_bonus
from routers.macro import fear_greed
from features.market_concept_layer import compute_market_concept_vector
from features.market_embedding import build_market_embedding
from ml.feature_factory import build_feature_vector
import config
from utils.cache import get_cached, set_cached, cache
from utils.logger import get_logger
from utils.http import retry_async
from utils.rate_limiter import rate_limit
from utils.market_context import get_signal_context
from utils.metrics import inc, observe
from utils.session import get_session_info
from risk.engine import get_risk_engine
from risk.discipline_controller import TradeDecision
from utils.correlation import set_correlation_id, clear_correlation_id

logger = get_logger(__name__)
_executor = ThreadPoolExecutor(max_workers=16)
atexit.register(lambda: _executor.shutdown(wait=False))

# ── Scan history persistence ──────────────────────────────────
_scan_db_pool = None
_scan_db_lock = asyncio.Lock()
_scan_batch: list[dict] = []
_scan_batch_lock = asyncio.Lock()


async def _get_scan_pool():
    global _scan_db_pool
    if _scan_db_pool is None:
        async with _scan_db_lock:
            if _scan_db_pool is None:
                import asyncpg
                url = config.settings.database_url.replace(
                    "postgresql+asyncpg://", "postgresql://"
                ).replace("postgres://", "postgresql://")
                _scan_db_pool = await asyncpg.create_pool(url, min_size=1, max_size=3)
    return _scan_db_pool


async def _persist_scan_redis(result: dict, timeframe: str) -> None:
    """Push scan result to Redis list for real-time frontend access (TTL 1h)."""
    try:
        entry = {
            "strategy_id": result.get("strategy_id"),
            "strategy_name": result.get("strategy_name") or "Default",
            "symbol": result.get("symbol"),
            "timeframe": timeframe,
            "signal": result.get("signal", "NEUTRAL"),
            "confidence": result.get("confidence", 0),
            "explanation": result.get("explanation", ""),
            "signal_pending": result.get("signal_pending", False),
            "persistence_score": result.get("persistence_score", 0),
            "asset_type": result.get("asset_type"),
            "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        key = "scan_history:recent"
        r = await cache.client()
        await r.lpush(key, json.dumps(entry, default=str))
        await r.ltrim(key, 0, 499)  # keep last 500 entries
        await r.expire(key, SCAN_HISTORY_REDIS_TTL)
    except Exception:
        pass


async def _queue_scan_for_batch(result: dict, timeframe: str) -> None:
    """Queue scan result for batch DB insertion (every 5 min)."""
    entry = {
        "strategy_id": result.get("strategy_id"),
        "strategy_name": result.get("strategy_name") or "Default",
        "symbol": result.get("symbol"),
        "timeframe": timeframe,
        "signal": result.get("signal", "NEUTRAL"),
        "confidence": int(result.get("confidence", 0)),
        "explanation": result.get("explanation", "")[:2000],
        "signal_pending": bool(result.get("signal_pending", False)),
        "persistence_score": float(result.get("persistence_score", 0)),
        "asset_type": result.get("asset_type"),
    }
    async with _scan_batch_lock:
        _scan_batch.append(entry)
        if len(_scan_batch) > 2000:
            _scan_batch[:] = _scan_batch[-2000:]


async def _flush_scan_batch() -> None:
    """Batch insert queued scans into scan_history table."""
    async with _scan_batch_lock:
        if not _scan_batch:
            return
        batch = _scan_batch.copy()
        _scan_batch.clear()
    try:
        pool = await _get_scan_pool()
        async with pool.acquire() as conn:
            rows = [
                (e["strategy_id"], e["strategy_name"], e["symbol"], e["timeframe"],
                 e["signal"], e["confidence"], e["explanation"], e["signal_pending"],
                 e["persistence_score"], e["asset_type"])
                for e in batch
            ]
            await conn.executemany(
                """INSERT INTO scan_history
                   (id, strategy_id, strategy_name, symbol, timeframe, signal,
                    confidence, explanation, signal_pending, persistence_score,
                    asset_type, scanned_at)
                   VALUES (md5(random()::text || clock_timestamp()::text || random()::text), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())""",
                rows,
            )
        logger.info("scan_history_batch_inserted", count=len(rows))
    except Exception as e:
        logger.warning("scan_history_batch_failed", error=str(e), count=len(batch))


async def _scan_batch_flusher():
    """Flush scan batch to DB every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        await _flush_scan_batch()


async def _persist_scan(result: dict, timeframe: str) -> None:
    """Persist scan result to Redis (real-time) + queue for DB batch."""
    await _persist_scan_redis(result, timeframe)
    await _queue_scan_for_batch(result, timeframe)


# ── Active strategies loader ─────────────────────────────────
_active_strategies_cache: list[dict] = []
_active_strategies_ts: float = 0
_active_strategies_lock = asyncio.Lock()


async def _load_active_strategies() -> list[dict]:
    """Charge les stratégies actives depuis la DB (cache 60s)."""
    global _active_strategies_cache, _active_strategies_ts
    now = time.monotonic()
    if _active_strategies_cache and (now - _active_strategies_ts) < 60:
        return _active_strategies_cache
    async with _active_strategies_lock:
        if _active_strategies_cache and (now - _active_strategies_ts) < 60:
            return _active_strategies_cache
        try:
            pool = await _get_scan_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT id, name, rules::text FROM strategies WHERE "isActive" = true"""
                )
            strategies = []
            for r in rows:
                try:
                    rules = json.loads(r["rules"]) if r["rules"] else {}
                except Exception:
                    rules = {}
                strategies.append({"id": r["id"], "name": r["name"], "rules": rules})
            _active_strategies_cache = strategies
            _active_strategies_ts = time.monotonic()
            logger.info("active_strategies_loaded", count=len(strategies))
            return strategies
        except Exception as e:
            logger.warning("active_strategies_load_failed", error=str(e))
            return _active_strategies_cache if _active_strategies_cache else []

# ── Default strategy ──────────────────────────────────────────
# Used when no strategy is provided (no UserStrategy active, fresh install,
# manual scan without strategy). Ensures all signals go through
# evaluate_strategy with proper filters (min_confidence, regime, DPS, etc.)
# instead of the legacy hardcoded pipeline.
DEFAULT_STRATEGY = {
    "id": None,
    "name": "Default",
    "rules": {
        "ema_fast": 20,
        "ema_slow": 50,
        "ema_trend": 200,
        "rsi_period": 14,
        "rsi_oversold": 30,
        "rsi_overbought": 70,
        "rsi_bullish_zone": 45,
        "rsi_bearish_zone": 55,
        "min_confidence": 40,
        "min_dps": 0,
        "volume_spike_min": 1.3,
        "use_price_action": True,
        "use_sr_zones": True,
        "use_smc": True,
        "use_patterns": True,
        "atr_min_pct": 0.0,
        "trigger": "BREAKOUT",
        "markets": [],
        "profiles": [],
        "timeframes": ["1h", "4h"],
    },
}

# Actifs précalculés en background
ACTIVE_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "AVAX/USDT",
    "ADA/USDT", "XRP/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT",
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
    "XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD",
    "V75", "V25", "V10",
    "BOOM1000", "CRASH1000",
]

# Actifs Binance prioritaires → scan rapide (Binance = gratuit, sans limite)
BINANCE_PRIORITY_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
    "AVAX/USDT", "XRP/USDT", "LINK/USDT", "ADA/USDT",
    "DOT/USDT", "MATIC/USDT",
]

# Actifs Deriv (synthétiques) → scan medium (2 min)
DERIV_SYMBOLS = [
    "V75", "V25", "V10", "V50", "V100",
    "BOOM1000", "CRASH1000", "BOOM500", "CRASH500",
    "JUMP25", "JUMP50", "JUMP75",
]

# Actifs BRVM → scan pendant heures de marché uniquement
BRVM_SYMBOLS = [
    "ONTBF", "SGBF", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSIC",
    "ORGT", "BICC", "CBIBF", "ABJC", "STAC",
]

# Actifs Forex/Commodités → scan lent (5 min)
FOREX_COMMODITY_SYMBOLS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
    "XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD",
]

# Timeframes par catégorie
WARMUP_TIMEFRAMES_FAST   = ["15m", "1h"]       # Binance prioritaire — cycle 60s
WARMUP_TIMEFRAMES_MEDIUM = ["1h", "15m"]       # Deriv synthétiques — cycle 2 min
WARMUP_TIMEFRAMES_SLOW   = ["1h", "4h"]        # Forex/Commodités — cycle 5 min
WARMUP_TIMEFRAMES_BRVM   = ["1h"]               # BRVM — cycle 5 min pendant heures de marché

WARMUP_INTERVAL_FAST    = 60                   # secondes — Binance prioritaire
WARMUP_INTERVAL_MEDIUM  = 120                  # secondes — Deriv synthétiques
WARMUP_INTERVAL_SLOW    = 300                  # secondes — Forex/Commodités
WARMUP_INTERVAL_BRVM    = 300                  # secondes — BRVM (heures de marché uniquement)
WARMUP_TTL_FAST         = 90                   # TTL cache pour actifs rapides
WARMUP_TTL_MEDIUM       = 180                  # TTL cache pour actifs medium
WARMUP_TTL_SLOW         = 360                  # TTL cache pour actifs lents
WARMUP_TTL_BRVM         = 360                  # TTL cache pour BRVM

# BRVM market hours: Mon-Fri 10:00-14:30 UTC
BRVM_OPEN_HOUR   = 10
BRVM_CLOSE_HOUR   = 14
BRVM_CLOSE_MIN    = 30

# Redis TTL for scan history feed (1 hour)
SCAN_HISTORY_REDIS_TTL = 3600

# Compat legacy
WARMUP_TIMEFRAMES        = WARMUP_TIMEFRAMES_SLOW
WARMUP_INTERVAL_SECONDS  = WARMUP_INTERVAL_FAST
WARMUP_TTL_SECONDS       = WARMUP_TTL_FAST

# Hystérésis flip-flop : mémoire d'état par (symbol, timeframe)
# Structure : { "BTC/USDT:1h": {"signal": "BUY", "count": 2, "ts": <monotonic>, "history": [...]} }
# Un signal est «hystérésis-confirmé» seulement après 2 scans consécutifs dans la même direction.
# Bande morte asymmétrique : repasser NEUTRAL exige score < 25, pas juste < 40.
# persistence_score (Sprint 4) : enrichit l'hystérésis binaire par un score continu 0-100%
# = fraction des N derniers scans allant dans la même direction que le signal actuel.
_signal_state: dict[str, dict] = {}
_HYSTERESIS_CONFIRM = 2   # scans consécutifs pour confirmer
_HYSTERESIS_TTL     = 3600  # réinitialise l'état après 1h sans scan
_PERSISTENCE_WINDOW = 5    # fenêtre glissante (nb de scans) pour le persistence_score

router = APIRouter()

SYMBOL_TO_BINANCE = {
    "BTC/USDT":   "BTCUSDT",
    "ETH/USDT":   "ETHUSDT",
    "SOL/USDT":   "SOLUSDT",
    "BNB/USDT":   "BNBUSDT",
    "AVAX/USDT":  "AVAXUSDT",
    "ADA/USDT":   "ADAUSDT",
    "DOT/USDT":   "DOTUSDT",
    "LINK/USDT":  "LINKUSDT",
    "MATIC/USDT": "MATICUSDT",
    "ATOM/USDT":  "ATOMUSDT",
    "LTC/USDT":   "LTCUSDT",
    "XRP/USDT":   "XRPUSDT",
    "DOGE/USDT":  "DOGEUSDT",
    "TRX/USDT":   "TRXUSDT",
    "TON/USDT":   "TONUSDT",
    "EUR/USDT":   "EURUSDT",
    "GBP/USDT":   "GBPUSDT",
    "PAXG/USDT":  "PAXGUSDT",
}

# Symboles disponibles via Twelve Data (Forex réel, métaux, énergie)
# Clé gratuite: https://twelvedata.com  →  TWELVE_DATA_API_KEY dans .env
SYMBOL_TO_TWELVEDATA = {
    "EUR/USD": "EUR/USD",
    "GBP/USD": "GBP/USD",
    "USD/JPY": "USD/JPY",
    "AUD/USD": "AUD/USD",
    "USD/CHF": "USD/CHF",
    "USD/CAD": "USD/CAD",
    "NZD/USD": "NZD/USD",
    "XAU/USD": "XAU/USD",
    "XAG/USD": "XAG/USD",
    "WTI/USD": "WTI/USD",
    "BRENT/USD": "BRENT/USD",
}

# Symboles disponibles via yfinance (fallback gratuit, sans clé API)
# Utilisé quand Twelve Data n'est pas configuré OU pour commodités/VIX
SYMBOL_TO_YFINANCE = {
    "EUR/USD":   "EURUSD=X",
    "GBP/USD":   "GBPUSD=X",
    "USD/JPY":   "JPY=X",
    "AUD/USD":   "AUDUSD=X",
    "USD/CHF":   "CHF=X",
    "USD/CAD":   "CAD=X",
    "NZD/USD":   "NZDUSD=X",
    "XAU/USD":   "GC=F",      # Gold Futures
    "XAG/USD":   "SI=F",      # Silver Futures
    "WTI/USD":   "CL=F",      # WTI Crude Oil Futures
    "BRENT/USD": "BZ=F",      # Brent Crude Futures
}

# Conversion timeframe interne → yfinance interval
TF_TO_YF: dict = {
    "1m": "1m",  "5m": "5m",  "15m": "15m",
    "1h": "1h",  "4h": "1h",   "1d": "1d",   # yfinance n'a pas 4h natif
}

# Période yfinance selon le timeframe (pour obtenir ~300 bougies)
TF_TO_YF_PERIOD: dict = {
    "1m": "7d", "5m": "60d", "15m": "60d",
    "1h": "730d", "4h": "730d", "1d": "5y",
}

TWELVE_DATA_API_KEY = config.settings.twelve_data_api_key
DERIV_API_TOKEN     = config.settings.deriv_api_token

_CACHE_TTL_YF    = 300  # yfinance : cache 5 min
_CACHE_TTL_DERIV = 60   # Deriv : cache 1 min

# Mapping symboles internes → identifiants API Deriv
SYMBOL_TO_DERIV = {
    # Volatility Indices — aliases courts (format seed) + aliases longs (legacy)
    "V10":   "R_10",   "VIX10/USD":   "R_10",
    "V25":   "R_25",   "VIX25/USD":   "R_25",
    "V50":   "R_50",   "VIX50/USD":   "R_50",
    "V75":   "R_75",   "VIX75/USD":   "R_75",
    "V100":  "R_100",  "VIX100/USD":  "R_100",
    # Boom & Crash
    "BOOM300":   to_wire_symbol("BOOM300"), "BOOM300/USD":   to_wire_symbol("BOOM300"),
    "BOOM500":   "BOOM500",  "BOOM500/USD":   "BOOM500",
    "BOOM1000":  "BOOM1000", "BOOM1000/USD":  "BOOM1000",
    "CRASH300":  to_wire_symbol("CRASH300"),"CRASH300/USD":  to_wire_symbol("CRASH300"),
    "CRASH500":  "CRASH500", "CRASH500/USD":  "CRASH500",
    "CRASH1000": "CRASH1000","CRASH1000/USD": "CRASH1000",
    # Jump Indices
    "JUMP10":  "JD10", "JUMP10/USD":  "JD10",
    "JUMP25":  "JD25", "JUMP25/USD":  "JD25",
    "JUMP50":  "JD50", "JUMP50/USD":  "JD50",
    "JUMP75":  "JD75", "JUMP75/USD":  "JD75",
    "JUMP100": "JD100","JUMP100/USD": "JD100",
}

# Conversion timeframe → granularité Deriv en secondes
TF_TO_DERIV_GRANULARITY: dict = {
    "1m": 60, "5m": 300, "15m": 900,
    "1h": 3600, "4h": 14400, "1d": 86400,
}

# Asset type classification
FOREX_SYMBOLS = set(SYMBOL_TO_TWELVEDATA.keys()) | set(SYMBOL_TO_YFINANCE.keys())
COMMODITY_SYMBOLS = {"XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD"}


def get_asset_type(symbol: str) -> str:
    """Classify an internal symbol into CRYPTO | FOREX | SYNTHETIC | BRVM | COMMODITY | UNKNOWN."""
    if symbol in SYMBOL_TO_BINANCE or symbol.endswith("/USDT"):
        return "CRYPTO"
    if symbol in SYNTHETIC_SYMBOLS:
        return "SYNTHETIC"
    if is_brvm_symbol(symbol):
        return "BRVM"
    if symbol in COMMODITY_SYMBOLS:
        return "COMMODITY"
    if symbol in FOREX_SYMBOLS or ("/" in symbol and len(symbol.split("/")) == 2):
        return "FOREX"
    return "UNKNOWN"


# Conversion timeframe interne → Twelve Data
TF_TO_TD: dict = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1h": "1h",   "4h": "4h",   "1d": "1day",
}

TF_MAP = {"1m":"1m","5m":"5m","15m":"15m","1h":"1h","4h":"4h","1d":"1d"}

# Durée en ms de chaque timeframe — utilisé pour détecter la bougie non clôturée
TF_TO_MS: dict[str, int] = {
    "1m":    60_000,
    "5m":   300_000,
    "15m":  900_000,
    "1h":  3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


class ScanRequest(BaseModel):
    symbols: List[str]
    timeframe: str = "1h"
    strategies: List[dict] = []


def ema(s: pd.Series, p: int) -> pd.Series:
    return ta.ema(s, length=p)

def rsi(s: pd.Series, p: int = 14) -> pd.Series:
    return ta.rsi(s, length=p)

def atr(h: pd.Series, lo: pd.Series, c: pd.Series, p: int = 14) -> pd.Series:
    return ta.atr(h, lo, c, length=p)

def macd(s: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    out = ta.macd(s, fast=fast, slow=slow, signal=signal)
    # pandas-ta order: MACD line, histogram, signal line
    return out.iloc[:, 0], out.iloc[:, 2], out.iloc[:, 1]

def bollinger(s: pd.Series, p: int = 20, k: float = 2.0):
    out = ta.bbands(s, length=p, std=k)
    # pandas-ta order: lower, mid, upper, bandwidth, %B
    return out.iloc[:, 2], out.iloc[:, 1], out.iloc[:, 0], out.iloc[:, 3]


_http_client: Optional[httpx.AsyncClient] = None
_klines_cache: dict = {}  # key -> (timestamp, df)
_CACHE_TTL = 60  # secondes
_CACHE_TTL_TD = 300  # Twelve Data: 5min (limite 800 req/jour sur plan gratuit)
_TD_SEMAPHORE   = asyncio.Semaphore(1)  # Twelve Data : un appel à la fois pour éviter le 429
_TD_MIN_DELAY   = 1.2   # secondes entre 2 appels Twelve Data (~50 req/min sur plan gratuit)
_td_last_call   = 0.0   # timestamp monotonic du dernier appel


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_connections=20))
    return _http_client


async def fetch_twelvedata_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV depuis Twelve Data API — pour Forex, métaux, WTI."""
    if not TWELVE_DATA_API_KEY:
        return None
    td_sym = SYMBOL_TO_TWELVEDATA.get(symbol)
    if not td_sym:
        return None
    td_interval = TF_TO_TD.get(interval, "1h")

    cache_key = f"td:{td_sym}:{td_interval}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL_TD:
            return df

    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol":    td_sym,
        "interval":  td_interval,
        "outputsize": limit,
        "apikey":    TWELVE_DATA_API_KEY,
        "format":    "JSON",
        "order":     "ASC",
    }

    async def _do_fetch():
        global _td_last_call
        async with _TD_SEMAPHORE:
            # Respecter le délai minimum entre deux appels Twelve Data
            elapsed = time.monotonic() - _td_last_call
            if elapsed < _TD_MIN_DELAY:
                await asyncio.sleep(_TD_MIN_DELAY - elapsed)
            client = _get_http_client()
            r = await client.get(url, params=params)
            _td_last_call = time.monotonic()
            r.raise_for_status()
            return r.json()

    try:
        data = await retry_async(
            _do_fetch,
            max_retries=1,
            base_delay=0.5,
            exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
            on_retry=lambda attempt, exc: logger.warning(
                "twelvedata_retry", symbol=symbol, attempt=attempt, error=str(exc)
            ),
            source="twelvedata",
        )
        if "values" not in data:
            return None
        rows = data["values"]
        df = pd.DataFrame(rows)
        df.rename(columns={"datetime": "time"}, inplace=True)
        for col in ["open", "high", "low", "close"]:
            df[col] = df[col].astype(float)
        df["volume"] = df.get("volume", pd.Series([0.0] * len(df))).astype(float)
        df["time"] = pd.to_datetime(df["time"]).map(lambda t: int(t.timestamp()))
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning(
            "twelvedata_fetch_failed",
            symbol=symbol,
            interval=interval,
            error=str(exc),
        )
        return None


@rate_limit(max_concurrent=8, min_delay=0.1)
async def fetch_deriv_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV depuis l'API Deriv WebSocket — pour les indices synthétiques (V75, Boom/Crash, Jump)."""
    import websockets
    import json as _json
    deriv_sym = SYMBOL_TO_DERIV.get(symbol)
    if not deriv_sym:
        return None

    granularity = TF_TO_DERIV_GRANULARITY.get(interval, 3600)
    cache_key   = f"deriv:{deriv_sym}:{granularity}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL_DERIV:
            return df

    ws_url = "wss://ws.binaryws.com/websockets/v3?app_id=1089"
    payload = {
        "ticks_history": deriv_sym,
        "adjust_start_time": 1,
        "count": limit,
        "end": "latest",
        "granularity": granularity,
        "style": "candles",
    }

    try:
        async with websockets.connect(ws_url, ping_interval=None) as ws:
            await ws.send(_json.dumps(payload))
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            data = _json.loads(raw)

        if "error" in data or "candles" not in data:
            return None

        candles_raw = data["candles"]
        df = pd.DataFrame([
            {
                "time":   c["epoch"],
                "open":   float(c["open"]),
                "high":   float(c["high"]),
                "low":    float(c["low"]),
                "close":  float(c["close"]),
                # Deriv API doesn't provide volume — use candle range as proxy
                # (captures intrabar volatility, which is what volume_spike measures)
                "volume": float(c["high"]) - float(c["low"]),
            }
            for c in candles_raw
        ])
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning("deriv_klines_error", symbol=symbol, error=str(exc))
        return None


async def fetch_yfinance_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    """Fetch OHLCV via yfinance — fallback gratuit pour Forex, commodités."""
    import datetime as _dt
    yf_sym = SYMBOL_TO_YFINANCE.get(symbol)
    if not yf_sym:
        return None

    yf_interval = TF_TO_YF.get(interval, "1h")
    cache_key   = f"yf:{yf_sym}:{yf_interval}:{limit}"
    now = time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL_YF:
            return df

    # Calculer la fenêtre start/end pour obtenir ~limit bougies
    # yfinance limite les données intraday : 7j max pour <=1h, 60j pour <=1h sur Forex
    _interval_seconds = {
        "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400,
    }
    seconds_per_bar = _interval_seconds.get(yf_interval, 3600)
    # On demande limit*1.5 barres pour absorber les gaps week-end/nuit
    needed_seconds = int(seconds_per_bar * limit * 1.5)
    # Plafond selon les limites yfinance par intervalle
    _max_seconds = {
        "1m": 7 * 86400, "5m": 60 * 86400, "15m": 60 * 86400,
        "1h": 730 * 86400, "1d": 5 * 365 * 86400,
    }
    max_sec = _max_seconds.get(yf_interval, 730 * 86400)
    window  = min(needed_seconds, max_sec)
    end_dt   = _dt.datetime.utcnow()
    start_dt = end_dt - _dt.timedelta(seconds=window)

    try:
        import yfinance as yf
        loop = asyncio.get_event_loop()
        def _download():
            ticker = yf.Ticker(yf_sym)
            df_raw = ticker.history(
                start=start_dt.strftime("%Y-%m-%d"),
                end=(end_dt + _dt.timedelta(days=1)).strftime("%Y-%m-%d"),
                interval=yf_interval,
                auto_adjust=True,
                actions=False,
            )
            return df_raw
        df_raw = await loop.run_in_executor(_executor, _download)
        if df_raw is None or df_raw.empty:
            return None
        # Normaliser l'index → secondes Unix entières
        # datetime64[s, tz] : astype int64 = secondes (pas ns) → ne pas diviser
        # datetime64[ns, tz] : astype int64 = nanosecondes → diviser par 1e9
        # Méthode robuste : utiliser .timestamp() sur chaque Timestamp
        times = df_raw.index.map(lambda t: int(t.timestamp()))
        df = pd.DataFrame({
            "time":   times.values,
            "open":   df_raw["Open"].astype(float).values,
            "high":   df_raw["High"].astype(float).values,
            "low":    df_raw["Low"].astype(float).values,
            "close":  df_raw["Close"].astype(float).values,
            "volume": df_raw["Volume"].astype(float).values,
        })
        # Pour 4h : rééchantillonner depuis 1h
        if interval == "4h" and yf_interval == "1h":
            df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
            df = df.set_index("time").resample("4h").agg(
                open=("open", "first"), high=("high", "max"),
                low=("low", "min"),   close=("close", "last"),
                volume=("volume", "sum")
            ).dropna().reset_index()
            df["time"] = df["time"].map(lambda t: int(t.timestamp()))
        # Trier, déduplicquer, limiter
        df = (df.sort_values("time")
                .drop_duplicates(subset=["time"])
                .dropna(subset=["close"])
                .tail(limit)
                .reset_index(drop=True))
        if len(df) < 2:
            return None
        # Proxy volume: si yfinance retourne volume=0 (forex/commodities),
        # utiliser le range de bougie (high - low) comme proxy de volatilité intrabar.
        # Cohérent avec l'approche Deriv (indices synthétiques sans volume).
        if df["volume"].sum() == 0:
            df["volume"] = (df["high"] - df["low"]).astype(float)
        _klines_cache[cache_key] = (time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning("yfinance_error", symbol=symbol, error=str(exc))
        return None


@rate_limit(max_concurrent=10, min_delay=0.05)
async def fetch_binance_klines(symbol: str, interval: str, limit: int = 300) -> Optional[pd.DataFrame]:
    import time as _time
    binance_sym = SYMBOL_TO_BINANCE.get(symbol)
    if not binance_sym:
        return None

    cache_key = f"{binance_sym}:{interval}:{limit}"
    now = _time.monotonic()
    if cache_key in _klines_cache:
        ts, df = _klines_cache[cache_key]
        if now - ts < _CACHE_TTL:
            return df

    url = f"https://api.binance.com/api/v3/klines?symbol={binance_sym}&interval={interval}&limit={limit}"

    async def _do_fetch():
        client = _get_http_client()
        r = await client.get(url)
        r.raise_for_status()
        return r.json()

    try:
        data = await retry_async(
            _do_fetch,
            max_retries=3,
            base_delay=0.5,
            exceptions=(httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException),
            on_retry=lambda attempt, exc: logger.warning(
                "binance_retry", symbol=symbol, attempt=attempt, error=str(exc)
            ),
            source="binance",
        )
        df = pd.DataFrame(data, columns=[
            "time","open","high","low","close","volume",
            "close_time","quote_vol","trades","taker_buy_base","taker_buy_quote","ignore"
        ])
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        # Exclure la dernière bougie si elle n'est pas encore clôturée (anti-repaint)
        candle_ms = TF_TO_MS.get(interval, 3_600_000)
        now_ms = int(_time.time() * 1000)
        if len(df) > 1 and int(df["time"].iloc[-1]) + candle_ms > now_ms:
            df = df.iloc[:-1].reset_index(drop=True)
        _klines_cache[cache_key] = (_time.monotonic(), df)
        return df
    except Exception as exc:
        logger.warning(
            "binance_klines_failed",
            symbol=symbol,
            interval=interval,
            error=str(exc),
        )
        return None


# Hiérarchie 3-TF : pour chaque LTF (timeframe d'exécution), définit quel TF intermédiaire
# et quel TF supérieur sont utilisés pour la confluence.
# Format : LTF -> (MTF, HTF)
_TF_HIERARCHY: dict[str, tuple[str, str]] = {
    "5m":  ("1h",  "4h"),
    "15m": ("1h",  "4h"),
    "1h":  ("4h",  "1d"),
    "4h":  ("1d",  "1d"),   # fallback si 4h est lui-même LTF
}


def apply_hysteresis_and_persistence(
    results: list,
    timeframe: str,
    signal_state: dict,
    now_mono: float,
) -> None:
    """
    Hystérésis flip-flop + persistence_score (Sprint 4), mutation in-place de `results`.
    Règles :
      - Un signal BUY/SELL doit être produit _HYSTERESIS_CONFIRM fois consécutivement pour être "confirmé".
      - Un signal confirmé repasse NEUTRAL seulement si la confidence descend sous 25 (bande morte).
      - L'état expire après _HYSTERESIS_TTL secondes sans scan.
      - persistence_score (0-100%) : fraction des _PERSISTENCE_WINDOW derniers scans allant
        dans la même direction que le signal courant — enrichit le compteur binaire d'hystérésis.
    """
    for r in results:
        sig = r.get("signal", "NEUTRAL")
        key = f"{r['symbol']}:{timeframe}:{r.get('strategy_id', 'default')}"
        state = signal_state.get(key)

        # Expiration TTL
        if state and (now_mono - state["ts"]) > _HYSTERESIS_TTL:
            state = None
            signal_state.pop(key, None)

        if sig in ("BUY", "SELL"):
            if state and state["signal"] == sig:
                state["count"] = min(state["count"] + 1, _HYSTERESIS_CONFIRM + 1)
                state["ts"] = now_mono
            else:
                # Nouvelle direction — réinitialiser compteur et historique
                state = {"signal": sig, "count": 1, "ts": now_mono, "history": []}
                signal_state[key] = state

            history = state.setdefault("history", [])
            history.append(sig)
            del history[:-_PERSISTENCE_WINDOW]
            r["persistence_score"] = round(100 * history.count(sig) / _PERSISTENCE_WINDOW, 2)

            # Pas encore confirmé : dégrader en NEUTRAL pour les notifications
            # (le signal reste dans results avec signal_pending=True pour info)
            if state["count"] < _HYSTERESIS_CONFIRM:
                r["signal_pending"] = True
        else:
            if state:
                history = state.setdefault("history", [])
                history.append("NEUTRAL")
                del history[:-_PERSISTENCE_WINDOW]

            # Signal NEUTRAL : si l'état précédent était confirmé, appliquer bande morte
            if state and state.get("count", 0) >= _HYSTERESIS_CONFIRM:
                conf = r.get("confidence", 0)
                if conf >= 25:
                    # Score encore dans la bande morte → maintenir le signal précédent
                    r["signal"] = state["signal"]
                    r["signal_sticky"] = True
                    history = state.get("history", [])
                    r["persistence_score"] = round(100 * history.count(state["signal"]) / _PERSISTENCE_WINDOW, 2)
                else:
                    signal_state.pop(key, None)
                    r["persistence_score"] = 0
            else:
                signal_state.pop(key, None)
                r["persistence_score"] = 0


def _analyze_synthetic_candles(symbol: str, timeframe: str, df: pd.DataFrame, strategy: Optional[dict] = None) -> dict:
    """Route synthetic indices through the statistical engine (no trend-following)."""
    close = df["close"].astype(float)
    deriv_sym = SYNTHETIC_SYMBOLS.get(symbol)
    category = "volatility"
    if deriv_sym:
        from routers.synthetic_engine import DERIV_SYMBOLS as _DERIV_CATS
        category = _DERIV_CATS.get(deriv_sym, "volatility")

    if category == "boom_crash":
        direction = "boom" if "BOOM" in symbol.upper() else "crash"
        stats = analyze_boom_crash(close, direction=direction)
    else:
        stats = analyze_synthetic(close, category=category)

    entry = round(float(close.iloc[-1]), 6)
    confidence = int(min(95, stats.get("spike_probability", 0) + stats.get("mean_reversion_prob", 0) * 0.5))

    synthetic_regime = {"regime": stats.get("regime"), "state": stats.get("state")}
    # reuse the same universal concept layer for synthetic indices
    market_concept_vector = compute_market_concept_vector(
        symbol, df, "SYNTHETIC", regime=synthetic_regime, mtf_regime=synthetic_regime
    )
    market_embedding = build_market_embedding(market_concept_vector, symbol, timeframe)
    feature_vector = build_feature_vector(symbol, timeframe, df)

    # ── Strategy evaluation for synthetic assets ──
    strategy_rules = strategy.get("rules", {}) if strategy else {}
    ev = evaluate_synthetic_strategy(close, stats, category=category, strategy_rules=strategy_rules)

    signal = ev["signal"]
    confidence = ev["confidence"]
    entry_price = ev["entry_price"] or entry
    stop_loss = ev["stop_loss"]
    take_profit_1 = ev["take_profit_1"]
    take_profit_2 = ev["take_profit_2"]
    risk_reward = ev["risk_reward"]
    explanation = " | ".join(ev["reasons"]) if ev["reasons"] else f"Synthetic {category}: {stats.get('state')} | regime={stats.get('regime')}"
    if not explanation.startswith("Synthetic"):
        explanation = f"Synthetic {category}: {explanation}"

    strategy_id = strategy.get("id") if strategy else None
    strategy_name = strategy.get("name") if strategy else None
    trigger = ev["trigger"]
    dps = ev["dps"]

    return {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "timeframe": timeframe,
        "asset_type": "SYNTHETIC",
        "signal": signal,
        "confidence": confidence,
        "score": ev["score"],
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "take_profit_1": take_profit_1,
        "take_profit_2": take_profit_2,
        "risk_reward": risk_reward,
        "trigger": trigger,
        "signal_pending": ev["signal_pending"],
        "invalidation": ev["invalidation"],
        "dps": dps,
        "tps": None,
        "success_probability": None,
        "expected_move": None,
        "explanation": explanation,
        "indicators": {"close": entry, "atr": round(close.iloc[-20:].std(), 6)},
        "session": {},
        "price_action": {},
        "sr_zones": {},
        "patterns": {},
        "regime": synthetic_regime,
        "smc": {},
        "synthetic_stats": stats,
        "market_concept_vector": market_concept_vector,
        "market_embedding": market_embedding,
        "feature_vector": feature_vector,
    }


def analyze_candles(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    htf_regime: Optional[dict] = None,   # régime TF supérieur (HTF2 = top)
    mtf_regime: Optional[dict] = None,   # régime TF intermédiaire (HTF1)
    strategy: Optional[dict] = None,
    onchain: Optional[dict] = None,      # contexte on-chain crypto (funding, fear&greed)
    entry_context: Optional[dict] = None,  # dernière clôture sur l'entry_timeframe (Sprint 3)
    forex_context: Optional[dict] = None,  # macro calendrier + DXY momentum
    tokenomics_context: Optional[dict] = None,  # token unlocks / concentration risk
    social_context: Optional[dict] = None,  # LunarCrush social sentiment
) -> dict:
    # ── Correlation ID for end-to-end tracing ──
    corr_id = set_correlation_id()
    logger.info("analyze_candles.start", correlation_id=corr_id, symbol=symbol, timeframe=timeframe)

    if len(df) < 50:
        clear_correlation_id()
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "not enough data", "correlation_id": corr_id}

    asset_type = get_asset_type(symbol)

    # Synthetic assets (Deriv indices) use a dedicated statistical engine
    # — no EMA/RSI/MACD trend-following, only spike/mean-reversion stats
    if asset_type == "SYNTHETIC":
        return _analyze_synthetic_candles(symbol, timeframe, df, strategy=strategy)

    # Synthetic assets: compute statistical bonus alongside standard indicators
    synthetic_stats = None
    if asset_type == "SYNTHETIC":
        deriv_sym = SYNTHETIC_SYMBOLS.get(symbol)
        _syn_category = "volatility"
        if deriv_sym:
            from routers.synthetic_engine import DERIV_SYMBOLS as _DERIV_CATS
            _syn_category = _DERIV_CATS.get(deriv_sym, "volatility")
        _syn_close = df["close"].astype(float)
        if _syn_category == "boom_crash":
            _syn_dir = "boom" if "BOOM" in symbol.upper() else "crash"
            synthetic_stats = analyze_boom_crash(_syn_close, direction=_syn_dir)
        else:
            synthetic_stats = analyze_synthetic(_syn_close, category=_syn_category)

    close    = df["close"]
    high     = df["high"]
    low      = df["low"]
    open_col = df["open"]
    last     = len(df) - 1

    # ── Default strategy fallback ──
    # When no strategy is provided, use the default strategy so all signals
    # go through evaluate_strategy with proper filters instead of the
    # legacy hardcoded pipeline.
    _using_default = False
    if strategy is None:
        strategy = DEFAULT_STRATEGY
        _using_default = True
        logger.info("analyze_candles.default_strategy", symbol=symbol, timeframe=timeframe)

    # Dynamic indicator periods from strategy rules (defaults: 20/50/200/14)
    _rules_raw = strategy.get("rules", {}) if strategy else {}
    _ema_fast = int(_rules_raw.get("ema_fast", 20))
    _ema_slow = int(_rules_raw.get("ema_slow", 50))
    _ema_trend = int(_rules_raw.get("ema_trend", 200))
    _rsi_period = int(_rules_raw.get("rsi_period", 14))

    e20  = ema(close, _ema_fast)
    e50  = ema(close, _ema_slow)
    e200 = ema(close, _ema_trend) if len(df) >= _ema_trend else None
    r14  = rsi(close, _rsi_period)
    a14  = atr(high, low, close, 14)
    vs   = df["volume"].rolling(20).mean()
    macd_line, macd_sig, macd_hist = macd(close)
    bb_upper, bb_mid, bb_lower, bb_bw = bollinger(close)

    def safe(s, i=last):
        if s is None: return None
        v = s.iloc[i]
        return None if pd.isna(v) else round(float(v), 6)

    c_val      = float(close.iloc[last])
    e20_v      = safe(e20)
    e50_v      = safe(e50)
    e200_v     = safe(e200)
    rsi_v      = safe(r14)
    atr_v      = safe(a14)
    vol_avg    = safe(vs)
    vol_cur    = float(df["volume"].iloc[last])
    vol_r      = round(vol_cur / vol_avg, 3) if vol_avg and vol_avg > 0 else None
    macd_v     = safe(macd_line)
    macd_sig_v = safe(macd_sig)
    macd_hist_v = safe(macd_hist)
    macd_prev_hist = safe(macd_hist, last - 1) if last > 0 else None
    bb_upper_v = safe(bb_upper)
    bb_mid_v   = safe(bb_mid)
    bb_lower_v = safe(bb_lower)
    bb_bw_v    = safe(bb_bw)

    score = 0
    reasons = []

    # Sub-scores for ML feature store (score_trend, score_pa, etc.)
    _sub_trend = 0
    _sub_pa = 0
    _sub_sr = 0
    _sub_patterns = 0
    _sub_regime = 0
    _sub_smc = 0
    _sub_mtf = 0
    _sub_sentiment = 0

    # ── Couche 1 : Momentum/Trend (EMA + RSI + MACD groupés, plafond ±50) ──
    # Les trois mesurent la même dimension (momentum directionnel).
    # On les regroupe pour éviter qu'une tendance simple sature le score avant
    # d'atteindre les couches Price Action / SMC qui apportent une info différente.
    trend_raw = 0.0
    trend_reasons: list[str] = []

    # EMA : signal structurel fort (alignement long terme)
    if e20_v and e50_v and e200_v:
        if e20_v > e50_v > e200_v and c_val > e200_v:
            trend_raw += 2.0
            trend_reasons.append("EMA bullish alignment + above 200")
        elif e20_v < e50_v < e200_v and c_val < e200_v:
            trend_raw -= 2.0
            trend_reasons.append("EMA bearish alignment + below 200")
        elif e20_v > e50_v:
            trend_raw += 1.0
            trend_reasons.append("EMA20 > EMA50 bullish")
        elif e20_v < e50_v:
            trend_raw -= 1.0
            trend_reasons.append("EMA20 < EMA50 bearish")
    elif e20_v and e50_v:
        if e20_v > e50_v:
            trend_raw += 1.0
            trend_reasons.append("EMA20 > EMA50 bullish")
        elif e20_v < e50_v:
            trend_raw -= 1.0
            trend_reasons.append("EMA20 < EMA50 bearish")

    # RSI : confirmation momentum
    if rsi_v:
        if 50 <= rsi_v <= 65:
            trend_raw += 1.0
            trend_reasons.append(f"RSI bullish zone ({rsi_v:.1f})")
        elif 35 <= rsi_v <= 50:
            trend_raw -= 1.0
            trend_reasons.append(f"RSI bearish zone ({rsi_v:.1f})")
        elif rsi_v > 70:
            trend_raw -= 0.5
            trend_reasons.append(f"RSI overbought ({rsi_v:.1f})")
        elif rsi_v < 30:
            trend_raw += 0.5
            trend_reasons.append(f"RSI oversold ({rsi_v:.1f})")

    # MACD : crossover prioritaire, momentum secondaire
    if macd_v is not None and macd_sig_v is not None and macd_hist_v is not None:
        if macd_hist_v > 0 and macd_prev_hist is not None and macd_prev_hist <= 0:
            trend_raw += 1.0
            trend_reasons.append(f"MACD bullish crossover ({macd_v:.4f})")
        elif macd_hist_v < 0 and macd_prev_hist is not None and macd_prev_hist >= 0:
            trend_raw -= 1.0
            trend_reasons.append(f"MACD bearish crossover ({macd_v:.4f})")
        elif macd_hist_v > 0 and macd_v > 0:
            trend_raw += 0.5
            trend_reasons.append("MACD bullish momentum")
        elif macd_hist_v < 0 and macd_v < 0:
            trend_raw -= 0.5
            trend_reasons.append("MACD bearish momentum")

    # Conversion trend_raw → score plafonné à ±50
    trend_contribution = max(-50, min(50, int(trend_raw * 12)))
    score += trend_contribution
    _sub_trend += trend_contribution
    reasons += trend_reasons

    # Volume : amplificateur (indépendant du cluster trend)
    if vol_r and vol_r > 1.3:
        _vol_bonus = 10 if score > 0 else -10
        score += _vol_bonus
        _sub_trend += _vol_bonus
        reasons.append(f"Volume spike x{vol_r:.1f}")

    # ATR : info contextuelle uniquement (pas de score)
    if atr_v and c_val > 0:
        atr_pct = (atr_v / c_val) * 100
        if atr_pct > 0.3:
            reasons.append(f"ATR OK ({atr_pct:.2f}%)")

    # ── Bollinger Bands : signal structurel indépendant ──
    # En tendance forte, le toucher des bandes est interprété comme continuation
    # (breakout), pas comme réversion. En tendance neutre, on garde l'interprétation
    # mean-reversion.
    if bb_upper_v and bb_lower_v and bb_mid_v:
        bb_pos = (c_val - bb_lower_v) / (bb_upper_v - bb_lower_v) if (bb_upper_v - bb_lower_v) > 0 else 0.5
        if trend_raw > 0.5:
            # Tendance haussière → continuation
            if c_val >= bb_upper_v * 0.995:
                score += 15
                reasons.append("Price at BB upper — bullish continuation")
            elif c_val <= bb_lower_v * 1.005:
                score -= 15
                reasons.append("Price at BB lower — pull-back in uptrend")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
        elif trend_raw < -0.5:
            # Tendance baissière → continuation
            if c_val <= bb_lower_v * 1.005:
                score -= 15
                reasons.append("Price at BB lower — bearish continuation")
            elif c_val >= bb_upper_v * 0.995:
                score += 15
                reasons.append("Price at BB upper — pull-back in downtrend")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
        else:
            # Range / direction faible → mean reversion
            if c_val <= bb_lower_v * 1.005:
                score += 15
                reasons.append("Price at BB lower — mean reversion setup")
            elif c_val >= bb_upper_v * 0.995:
                score -= 15
                reasons.append("Price at BB upper — potential reversal")
            elif bb_pos > 0.7 and macd_hist_v and macd_hist_v > 0:
                score += 8
                reasons.append("BB upper half + MACD momentum")
            elif bb_pos < 0.3 and macd_hist_v and macd_hist_v < 0:
                score -= 8
                reasons.append("BB lower half + MACD momentum")
        if bb_bw_v and bb_bw_v < 0.02:
            reasons.append(f"BB squeeze (bw={bb_bw_v:.3f}) — breakout imminent")

    # ── Session context ──
    session_info = get_session_info()

    # ── Price Action Phase 1 : Structure ──
    pa = detect_market_structure(high, low, close, volume=df["volume"])
    temp_signal = "BUY" if score >= 20 else ("SELL" if score <= -20 else "NEUTRAL")

    # Session overlap bonus (London/NY = highest probability window)
    if session_info.get("overlap") == "London_New_York" and temp_signal != "NEUTRAL":
        score += 8
        reasons.append("Session: London/NY overlap (+8)")
    elif session_info.get("overlap") and temp_signal != "NEUTRAL":
        score += 3
        reasons.append(f"Session: {session_info['overlap']} (+3)")

    # Low-quality BOS hard block (No Trade Engine)
    if pa.get("bos") and pa.get("bos_dir") == temp_signal and pa.get("bos_score", 0) < 40:
        temp_signal = "NEUTRAL"
        reasons.append(f"PA: BOS quality too low ({pa.get('bos_score')}) → No Trade")
    if temp_signal != "NEUTRAL":
        pa_bonus, pa_reasons = price_action_bonus(pa, temp_signal)
        score += pa_bonus
        _sub_pa += pa_bonus
        reasons += pa_reasons

    # ── Phase 2 : S&R Clustering ──
    sr = get_sr_zones(high, low, close)
    if temp_signal != "NEUTRAL":
        b, r = sr_bonus(sr, temp_signal)
        score += b
        _sub_sr += b
        reasons += r

    # ── Phase 2 : Candlestick Patterns ──
    pats = scan_last_patterns(open_col, high, low, close)
    chart_patterns = detect_chart_patterns(df) if len(df) >= 15 else []
    if chart_patterns:
        reasons.append(f"Pattern chartiste détecté: {chart_patterns[0]['name']} ({chart_patterns[0]['direction']})")
    if temp_signal != "NEUTRAL":
        b, r = patterns_bonus(pats, temp_signal)
        score += b
        _sub_patterns += b
        reasons += r

    # ── Jour 10 : Régime de marché ──
    regime = detect_regime(high, low, close)
    temp_signal2 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal2 != "NEUTRAL":
        b, r = regime_bonus(regime, temp_signal2)
        score += b
        _sub_regime += b
        reasons += r

    # ── Phase 3 : SMC (FVG + Order Blocks + Liquidité) ──
    smc = analyze_smc(open_col, high, low, close, volume=df["volume"])
    temp_signal3 = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")
    if temp_signal3 != "NEUTRAL":
        b, r = smc_bonus(smc["fvg"], smc["ob"], smc["liquidity"], temp_signal3)
        score += b
        _sub_smc += b
        reasons += r

    # ── On-chain (crypto uniquement) : Fear&Greed contrarian + Funding squeeze ──
    advanced_flags = {}
    if onchain and temp_signal3 != "NEUTRAL":
        b, r = onchain_bonus(
            onchain.get("context") or {}, temp_signal3, onchain.get("fear_greed")
        )
        score += b
        _sub_sentiment += b
        reasons += r

        adv_ctx = onchain.get("advanced") or {}
        if adv_ctx:
            b, r, f = advanced_onchain_bonus(adv_ctx, temp_signal3)
            score += b
            reasons += r
            advanced_flags = f

    # ── Tokenomics risk (crypto uniquement) : unlocks + concentration ──
    tokenomics_flags = {}
    if asset_type == "CRYPTO" and tokenomics_context:
        penalty, r, f = tokenomics_penalty(tokenomics_context, temp_signal3)
        if penalty:
            score -= penalty
            reasons += r
        if f.get("danger_flag"):
            tokenomics_flags["danger_flag"] = True
        if f.get("concentration_flag"):
            tokenomics_flags["concentration_flag"] = True

    # ── Social sentiment (crypto uniquement) : LunarCrush momentum ──
    if asset_type == "CRYPTO" and social_context and temp_signal3 != "NEUTRAL":
        b, r = social_bonus(social_context, temp_signal3)
        if b:
            score += b
            reasons += r

    # ── Universal Market Representation (Phase A++) ──
    market_concept_vector = compute_market_concept_vector(
        symbol,
        df,
        asset_type,
        regime=regime,
        htf_regime=htf_regime,
        mtf_regime=mtf_regime,
        pa=pa,
        smc=smc,
        sr=sr,
        onchain_context=onchain if asset_type == "CRYPTO" else None,
        forex_context=forex_context if asset_type == "FOREX" else None,
    )
    market_embedding = build_market_embedding(market_concept_vector, symbol, timeframe)
    feature_vector = build_feature_vector(symbol, timeframe, df)

    # ── Confluence multi-timeframe (3-TF hierarchy) ──
    # Règle : on applique d'abord le TF intermédiaire (MTF, poids fort)
    # puis le TF supérieur (HTF, poids léger car plus éloigné de l'exécution).
    # MTF : même actif, TF juste au-dessus de l'exécution → décision  (+15/-25)
    # HTF : contexte macro → confirme/invalide la tendance générale (+10/-15)
    provisional_dir = "BUY" if score >= 0 else "SELL"
    hierarchy = _TF_HIERARCHY.get(timeframe, ("4h", "1d"))
    mtf_label, htf_label = hierarchy

    if mtf_regime:
        mtf_r = mtf_regime.get("regime", "UNKNOWN")
        if mtf_r == "TRENDING_BULL" and provisional_dir == "BUY":
            score += 15
            _sub_mtf += 15
            reasons.append(f"MTF({mtf_label}): alignement TRENDING_BULL")
        elif mtf_r == "TRENDING_BULL" and provisional_dir == "SELL":
            score -= 25
            _sub_mtf -= 25
            reasons.append(f"MTF({mtf_label}): contre-tendance TRENDING_BULL — pénalité")
        elif mtf_r == "TRENDING_BEAR" and provisional_dir == "SELL":
            score += 15
            _sub_mtf += 15
            reasons.append(f"MTF({mtf_label}): alignement TRENDING_BEAR")
        elif mtf_r == "TRENDING_BEAR" and provisional_dir == "BUY":
            score -= 25
            _sub_mtf -= 25
            reasons.append(f"MTF({mtf_label}): contre-tendance TRENDING_BEAR — pénalité")
        elif mtf_r == "VOLATILE":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"MTF({mtf_label}): VOLATILE — réduction score")

    if htf_regime:
        htf_r = htf_regime.get("regime", "UNKNOWN")
        provisional_dir = "BUY" if score >= 0 else "SELL"  # recalc après MTF
        if htf_r == "TRENDING_BULL" and provisional_dir == "BUY":
            score += 10
            _sub_mtf += 10
            reasons.append(f"HTF({htf_label}): alignement TRENDING_BULL")
        elif htf_r == "TRENDING_BULL" and provisional_dir == "SELL":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"HTF({htf_label}): contre-tendance TRENDING_BULL — pénalité")
        elif htf_r == "TRENDING_BEAR" and provisional_dir == "SELL":
            score += 10
            _sub_mtf += 10
            reasons.append(f"HTF({htf_label}): alignement TRENDING_BEAR")
        elif htf_r == "TRENDING_BEAR" and provisional_dir == "BUY":
            score -= 15
            _sub_mtf -= 15
            reasons.append(f"HTF({htf_label}): contre-tendance TRENDING_BEAR — pénalité")
        elif htf_r == "VOLATILE":
            score -= 10
            _sub_mtf -= 10
            reasons.append(f"HTF({htf_label}): VOLATILE — réduction score")

    # ── Forex macro context : DXY momentum adjustment ──
    if asset_type == "FOREX" and forex_context:
        dxy_adj = forex_context.get("score_adjustment", 0)
        if dxy_adj:
            score += dxy_adj
            reasons.extend(forex_context.get("reasons", []))

    provisional_signal = "BUY" if score >= 40 else ("SELL" if score <= -40 else "NEUTRAL")

    # Appliquer le filtre de régime (hard block) — bloque VOLATILE et contre-tendance confirmée
    allowed, filter_reason = regime_filter(regime, provisional_signal)
    if not allowed and provisional_signal != "NEUTRAL":
        signal = "NEUTRAL"
        confidence = 0
        reasons.append(f"[FILTERED] {filter_reason} | score brut={score}")
    else:
        signal = provisional_signal
        confidence = min(abs(score), 95) if signal != "NEUTRAL" else 0

    # ── Forex macro risk : suspend new signals before high-impact news ──
    if asset_type == "FOREX" and forex_context and forex_context.get("macro_risk"):
        signal = "NEUTRAL"
        confidence = 0
        reasons.append("Macro risk: événement HIGH dans <2h — scan forex suspendu")

    # Tokenomics danger : gros unlock imminent → signal désactivé
    if asset_type == "CRYPTO" and tokenomics_flags.get("danger_flag"):
        signal = "NEUTRAL"
        confidence = 0
        reasons.append("Tokenomics: unlock >20% supply <30j — signal désactivé")

    # Price levels — multiplicateurs ATR adaptés au régime
    # RANGING      : TP serré (objectif souvent irréaliste au-delà de 2×ATR)
    # TRENDING      : TP élargi (tendance peut porter plus loin)
    # VOLATILE      : SL élargi pour absorber le bruit, TP conservateur
    # UNKNOWN/other : valeurs par défaut
    _reg = regime.get("regime", "UNKNOWN")
    if _reg == "RANGING":
        _sl_mult, _tp1_mult, _tp2_mult = 1.2, 1.5, 2.5
    elif _reg in ("TRENDING_BULL", "TRENDING_BEAR"):
        _ts = regime.get("trend_strength", "MODERATE")
        if _ts == "STRONG":
            _sl_mult, _tp1_mult, _tp2_mult = 1.5, 2.5, 4.5
        else:
            _sl_mult, _tp1_mult, _tp2_mult = 1.5, 2.0, 3.5
    elif _reg == "VOLATILE":
        _sl_mult, _tp1_mult, _tp2_mult = 2.0, 2.0, 3.0
    else:
        _sl_mult, _tp1_mult, _tp2_mult = 1.5, 2.0, 3.5

    entry = round(c_val, 6)
    sl  = round(c_val - atr_v * _sl_mult,  6) if atr_v and signal == "BUY"  else (
          round(c_val + atr_v * _sl_mult,  6) if atr_v and signal == "SELL" else None)
    tp1 = round(c_val + atr_v * _tp1_mult, 6) if atr_v and signal == "BUY"  else (
          round(c_val - atr_v * _tp1_mult, 6) if atr_v and signal == "SELL" else None)
    tp2 = round(c_val + atr_v * _tp2_mult, 6) if atr_v and signal == "BUY"  else (
          round(c_val - atr_v * _tp2_mult, 6) if atr_v and signal == "SELL" else None)

    # ── SL liquidity-aware : éviter de poser le SL dans une zone EQL/EQH de stop hunt ──
    if sl is not None and atr_v:
        sl_buffer = atr_v * 0.3
        liq = smc.get("liquidity", {})
        if signal == "BUY":
            eql_zones = [z for z in liq.get("equal_lows", []) if z["price"] <= entry]
            if eql_zones:
                nearest = max(eql_zones, key=lambda z: z["price"])
                cluster_min = nearest["min"]
                if sl >= cluster_min - sl_buffer:
                    sl = round(cluster_min - sl_buffer, 6)
                    reasons.append(f"SL moved below equal-low cluster {cluster_min:.2f}")
        elif signal == "SELL":
            eqh_zones = [z for z in liq.get("equal_highs", []) if z["price"] >= entry]
            if eqh_zones:
                nearest = min(eqh_zones, key=lambda z: z["price"])
                cluster_max = nearest["max"]
                if sl <= cluster_max + sl_buffer:
                    sl = round(cluster_max + sl_buffer, 6)
                    reasons.append(f"SL moved above equal-high cluster {cluster_max:.2f}")

    # ── TP market-adaptive : TP1 = prochaine zone de liquidité (EQH/EQL) ──
    if tp1 is not None and atr_v:
        liq = smc.get("liquidity", {})
        if signal == "BUY":
            eqh_zones = [z for z in liq.get("equal_highs", []) if z["price"] > entry]
            if eqh_zones:
                nearest = min(eqh_zones, key=lambda z: z["price"])
                tp1 = round(nearest["price"], 6)
                reasons.append(f"TP1 set to next equal-high {tp1:.2f}")
        elif signal == "SELL":
            eql_zones = [z for z in liq.get("equal_lows", []) if z["price"] < entry]
            if eql_zones:
                nearest = max(eql_zones, key=lambda z: z["price"])
                tp1 = round(nearest["price"], 6)
                reasons.append(f"TP1 set to next equal-low {tp1:.2f}")

    rr  = round(abs(tp1 - entry) / abs(entry - sl), 2) if sl and tp1 and abs(entry - sl) > 0 else None

    _mtf_tf, _htf_tf = _TF_HIERARCHY.get(timeframe, ("4h", "1d"))
    # default strategy metadata
    strategy_id = None
    strategy_name = None
    profile_suitability = []
    trigger = None
    signal_pending = None
    invalidation = {}
    dps = None
    tps = None
    success_probability = None
    expected_move = None

    if strategy:
        rules = parse_rules(strategy.get("rules", {}))
        rules.analysis_timeframe = strategy.get("analysisTimeframe") or strategy.get("analysis_timeframe")
        rules.entry_timeframe = strategy.get("entryTimeframe") or strategy.get("entry_timeframe")
        rules._name = strategy.get("name", "unknown")
        ev = evaluate_strategy(
            rules,
            indicators={
                "close": c_val, "ema20": e20_v, "ema50": e50_v, "ema200": e200_v,
                "rsi": rsi_v, "atr": atr_v, "volume_ratio": vol_r,
                "macd": macd_v, "macd_signal": macd_sig_v, "macd_hist": macd_hist_v,
                "bb_upper": bb_upper_v, "bb_mid": bb_mid_v, "bb_lower": bb_lower_v, "bb_bw": bb_bw_v,
            },
            pa=pa,
            sr=sr,
            patterns=pats,
            smc=smc,
            regime=regime,
            timeframe=timeframe,
            market={"COMMODITY": "COMMODITIES", "BRVM": "STOCKS"}.get(asset_type, asset_type),
            onchain=onchain,
            entry_context=entry_context,
        )
        signal = ev["signal"]
        confidence = ev["confidence"]
        score = ev["score"]
        dps = ev["dps"]
        tps = ev["tps"]
        success_probability = ev["success_probability"]
        expected_move = ev["expected_move"]
        reasons = ev["reasons"]
        entry = ev["entry_price"] if ev["entry_price"] is not None else entry
        sl = ev["stop_loss"] if ev["stop_loss"] is not None else sl
        tp1 = ev["take_profit_1"] if ev["take_profit_1"] is not None else tp1
        tp2 = ev["take_profit_2"] if ev["take_profit_2"] is not None else tp2
        rr = ev["risk_reward"] if ev["risk_reward"] is not None else rr
        strategy_id = strategy.get("id")
        strategy_name = strategy.get("name")
        profile_suitability = ev["profile_suitability"]
        trigger = ev["trigger"]
        signal_pending = ev["signal_pending"]
        invalidation = ev["invalidation"]

        if signal != "NEUTRAL":
            _strat_regimes = (strategy.get("rules", {}).get("filters", {}) or {}).get("regime")
            _cur_regime = regime.get("regime")
            if _cur_regime == "VOLATILE" and _strat_regimes and "VOLATILE" in _strat_regimes:
                pass  # strategy explicitly allows VOLATILE — skip only that rule
            else:
                allowed, filter_reason = regime_filter(regime, signal)
                if not allowed:
                    signal = "NEUTRAL"
                    confidence = 0
                    reasons.append(f"[FILTERED] {filter_reason}")

        # ── Re-apply risk guards that evaluate_strategy doesn't know about ──
        # evaluate_strategy overwrites signal/confidence/score, so guards applied
        # earlier in the pipeline are silently bypassed. Re-apply them here.

        # Forex macro risk: suspend signals before high-impact news
        if signal != "NEUTRAL" and asset_type == "FOREX" and forex_context and forex_context.get("macro_risk"):
            signal = "NEUTRAL"
            confidence = 0
            reasons.append("Macro risk: événement HIGH dans <2h — scan forex suspendu")

        # Tokenomics danger: big unlock imminent → signal disabled
        if signal != "NEUTRAL" and asset_type == "CRYPTO" and tokenomics_flags.get("danger_flag"):
            signal = "NEUTRAL"
            confidence = 0
            reasons.append("Tokenomics: unlock >20% supply <30j — signal désactivé")

        # DXY momentum adjustment for Forex
        if signal != "NEUTRAL" and asset_type == "FOREX" and forex_context:
            dxy_adj = forex_context.get("score_adjustment", 0)
            if dxy_adj:
                score += dxy_adj
                reasons.extend(forex_context.get("reasons", []))

        # Social sentiment bonus for Crypto
        if signal != "NEUTRAL" and asset_type == "CRYPTO" and social_context:
            _sb, _sr = social_bonus(social_context, signal)
            if _sb:
                score += _sb
                reasons.extend(_sr)

        # MTF confluence score adjustment
        if signal != "NEUTRAL" and htf_regime and mtf_regime:
            _strat_dir = "BUY" if score >= 0 else "SELL"
            if mtf_regime:
                _mtf_r = mtf_regime.get("regime", "UNKNOWN")
                if _mtf_r == "TRENDING_BULL" and signal == "BUY":
                    score += 15; reasons.append(f"MTF({_mtf_tf}): alignement TRENDING_BULL")
                elif _mtf_r == "TRENDING_BULL" and signal == "SELL":
                    score -= 25; reasons.append(f"MTF({_mtf_tf}): contre-tendance TRENDING_BULL")
                elif _mtf_r == "TRENDING_BEAR" and signal == "SELL":
                    score += 15; reasons.append(f"MTF({_mtf_tf}): alignement TRENDING_BEAR")
                elif _mtf_r == "TRENDING_BEAR" and signal == "BUY":
                    score -= 25; reasons.append(f"MTF({_mtf_tf}): contre-tendance TRENDING_BEAR")
                elif _mtf_r == "VOLATILE":
                    score -= 15; reasons.append(f"MTF({_mtf_tf}): VOLATILE — réduction score")
            if htf_regime:
                _htf_r = htf_regime.get("regime", "UNKNOWN")
                if _htf_r == "TRENDING_BULL" and signal == "BUY":
                    score += 10; reasons.append(f"HTF({_htf_tf}): alignement TRENDING_BULL")
                elif _htf_r == "TRENDING_BULL" and signal == "SELL":
                    score -= 15; reasons.append(f"HTF({_htf_tf}): contre-tendance TRENDING_BULL")
                elif _htf_r == "TRENDING_BEAR" and signal == "SELL":
                    score += 10; reasons.append(f"HTF({_htf_tf}): alignement TRENDING_BEAR")
                elif _htf_r == "TRENDING_BEAR" and signal == "BUY":
                    score -= 15; reasons.append(f"HTF({_htf_tf}): contre-tendance TRENDING_BEAR")
                elif _htf_r == "VOLATILE":
                    score -= 10; reasons.append(f"HTF({_htf_tf}): VOLATILE — réduction score")

        # ── Re-apply liquidity-aware SL/TP after strategy merge ──
        # evaluate_strategy returns ATR-based SL/TP which overwrites the
        # liquidity-aware adjustments computed above. Re-apply them here
        # so the final SL/TP respects market structure (EQL/EQH zones).
        if signal != "NEUTRAL" and sl is not None and atr_v:
            sl_buffer = atr_v * 0.3
            _liq = smc.get("liquidity", {})
            if signal == "BUY":
                _eql = [z for z in _liq.get("equal_lows", []) if z["price"] <= entry]
                if _eql:
                    _nearest = max(_eql, key=lambda z: z["price"])
                    _cluster_min = _nearest["min"]
                    if sl >= _cluster_min - sl_buffer:
                        sl = round(_cluster_min - sl_buffer, 6)
                        reasons.append(f"SL moved below equal-low cluster {_cluster_min:.2f}")
            elif signal == "SELL":
                _eqh = [z for z in _liq.get("equal_highs", []) if z["price"] >= entry]
                if _eqh:
                    _nearest = min(_eqh, key=lambda z: z["price"])
                    _cluster_max = _nearest["max"]
                    if sl <= _cluster_max + sl_buffer:
                        sl = round(_cluster_max + sl_buffer, 6)
                        reasons.append(f"SL moved above equal-high cluster {_cluster_max:.2f}")

        if signal != "NEUTRAL" and tp1 is not None and atr_v:
            _liq = smc.get("liquidity", {})
            if signal == "BUY":
                _eqh = [z for z in _liq.get("equal_highs", []) if z["price"] > entry]
                if _eqh:
                    _nearest = min(_eqh, key=lambda z: z["price"])
                    tp1 = round(_nearest["price"], 6)
                    reasons.append(f"TP1 set to next equal-high {tp1:.2f}")
            elif signal == "SELL":
                _eql = [z for z in _liq.get("equal_lows", []) if z["price"] < entry]
                if _eql:
                    _nearest = max(_eql, key=lambda z: z["price"])
                    tp1 = round(_nearest["price"], 6)
                    reasons.append(f"TP1 set to next equal-low {tp1:.2f}")

        # ── Recalculate rr + predictive metrics after liquidity-aware refinement ──
        # sl and tp1 may have changed from ATR-based to liquidity zone-based,
        # so rr, dps, tps, success_probability, expected_move must be recomputed
        # to stay consistent with the final returned values.
        if signal != "NEUTRAL" and sl is not None and tp1 is not None and entry is not None:
            from utils.risk_reward import compute_rr
            if abs(entry - sl) > 0:
                rr = compute_rr(entry, sl, tp1)
            if strategy and dps is not None:
                from utils.predictive import compute_predictive_metrics
                _pred = compute_predictive_metrics(
                    signal, confidence, entry, tp1, sl, rr,
                    indicators={"close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v},
                    pa=pa, regime=regime, smc=smc, mtf_aligned=None, trigger=trigger,
                )
                dps = _pred["dps"]
                tps = _pred["tps"]
                success_probability = _pred["success_probability"]
                expected_move = _pred["expected_move"]

    # ── Synthetic caution filter: reduce confidence on spike risk ──
    # Applied after evaluate_strategy but BEFORE returning — recalculate DPS
    # so it's consistent with the reduced confidence.
    if asset_type == "SYNTHETIC" and synthetic_stats and signal != "NEUTRAL":
        _caution = synthetic_stats.get("caution", False)
        _spike_prob = synthetic_stats.get("spike_probability", 0)
        if _caution or _spike_prob > 70:
            confidence = int(confidence * 0.7)
            reasons.append(f"Synthetic caution: spike_prob={_spike_prob:.1f}% — confidence reduced 30%")
            if confidence < 40:
                signal = "NEUTRAL"
                confidence = 0
                reasons.append("Synthetic spike risk too high — signal neutralised")
            elif strategy and dps is not None:
                # Recalculate DPS on reduced confidence for consistency
                from utils.predictive import compute_predictive_metrics
                _pred = compute_predictive_metrics(
                    signal, confidence, entry, tp1, sl, rr,
                    indicators={"close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v},
                    pa=pa, regime=regime, smc=smc, mtf_aligned=None, trigger=trigger,
                )
                dps = _pred["dps"]
                tps = _pred["tps"]
                success_probability = _pred["success_probability"]
                expected_move = _pred["expected_move"]
                # Re-check min_dps on recalculated value
                _min_dps = float(_rules_raw.get("min_dps", 60))
                if dps < _min_dps:
                    reasons.append(f"DPS {dps}% < seuil {_min_dps}% après caution filter — filtré")
                    signal = "NEUTRAL"
                    confidence = 0

    if not profile_suitability:
        profile_suitability = derive_profile_suitability(
            timeframe,
            rr,
            [],
            signal,
            confidence,
        )

    _mtf_aligned = (
        (mtf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BULL" and signal == "BUY" or
        (mtf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BEAR" and signal == "SELL"
    ) if mtf_regime else None
    _htf_aligned = (
        (htf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BULL" and signal == "BUY" or
        (htf_regime or {}).get("regime", "UNKNOWN") == "TRENDING_BEAR" and signal == "SELL"
    ) if htf_regime else None

    # --- Confluence scoring on detected chart/harmonic patterns ---
    if chart_patterns:
        scored_patterns = []
        mtf_ctx = {"mtf_aligned": _mtf_aligned, "htf_aligned": _htf_aligned}
        for p in chart_patterns:
            conf, tags = score_pattern_confluence(p, pa, smc, mtf_context=mtf_ctx, regime=regime)
            p["confluenceScore"] = conf
            p["confluenceTags"] = tags
            scored_patterns.append(p)
        scored_patterns.sort(key=lambda x: x.get("confluenceScore", 0), reverse=True)
        chart_patterns = scored_patterns

    # --- Predictive metrics for default hardcoded path (Sprint 4) ---
    if not strategy:
        from utils.predictive import compute_predictive_metrics
        predictive = compute_predictive_metrics(
            signal,
            confidence,
            entry,
            tp1,
            sl,
            rr,
            indicators={
                "close": c_val, "volume_ratio": vol_r, "bb_bw": bb_bw_v, "macd_hist": macd_hist_v,
            },
            pa=pa,
            regime=regime,
            smc=smc,
            mtf_aligned=_mtf_aligned,
            trigger=None,
        )
        dps = predictive["dps"]
        tps = predictive["tps"]
        success_probability = predictive["success_probability"]
        expected_move = predictive["expected_move"]

        # --- DPS filter (Sprint 4) — signal directionnel peu fiable → non persisté ---
        if signal != "NEUTRAL" and dps is not None and dps < 60.0:
            reasons.append(f"DPS {dps}% < seuil 60% — filtré")
            signal = "NEUTRAL"
            confidence = 0

    # ── Clean price levels when signal is NEUTRAL ──
    if signal == "NEUTRAL":
        sl = None
        tp1 = None
        tp2 = None
        rr = None

    # ── Risk engine evaluation ──
    risk_assessment = None
    if signal != "NEUTRAL" and entry is not None and sl is not None:
        try:
            _risk = get_risk_engine()
            _direction = "BUY" if signal == "BUY" else "SELL"
            _atr_pct = (atr_v / entry) * 100 if atr_v and entry else 0.0
            _score_norm = min(abs(score) / 100.0, 1.0) if score else 0.5
            _strategy_name = (strategy or {}).get("name", "default").lower().replace(" ", "_") if strategy else "default"
            _regime_name = (regime or {}).get("regime", "UNKNOWN")
            risk_assessment = _risk.evaluate(
                symbol=symbol,
                direction=_direction,
                entry=entry,
                stop_loss=sl,
                atr_pct=_atr_pct,
                signal_score=_score_norm,
                strategy=_strategy_name,
                regime=_regime_name,
            )
            if risk_assessment.decision == TradeDecision.BLOCKED:
                signal = "NEUTRAL"
                confidence = 0
                sl = None
                tp1 = None
                tp2 = None
                rr = None
                reasons.append(f"[RISK BLOCKED] {'; '.join(risk_assessment.reasons)}")
        except Exception as _e:
            logger.warning("risk_engine.evaluate failed", error=str(_e))

    result = {
        "symbol":       symbol,
        "strategy_id":  strategy_id,
        "strategy_name": strategy_name,
        "is_default":   _using_default,
        "analysis_timeframe": (strategy or {}).get("analysisTimeframe") or (strategy or {}).get("analysis_timeframe") or timeframe,
        "entry_timeframe":    (strategy or {}).get("entryTimeframe")    or (strategy or {}).get("entry_timeframe")    or timeframe,
        "score":        score,
        "profile_suitability": profile_suitability,
        "trigger":      trigger,
        "signal_pending": signal_pending,
        "invalidation": invalidation,
        "dps":          dps,
        "tps":          tps,
        "success_probability": success_probability,
        "expected_move": expected_move,
        "timeframe":    timeframe,
        "asset_type":   asset_type,
        "signal":       signal,
        "confidence":   confidence,
        "_confidence_before_sentiment": confidence,  # snapshot avant enrichissement sentiment
        "entry_price":  entry,
        "stop_loss":    sl,
        "take_profit_1": tp1,
        "take_profit_2": tp2,
        "risk_reward":  rr,
        "explanation":  " | ".join(reasons) or "No clear setup",
        "indicators": {
            "close": entry, "ema20": e20_v, "ema50": e50_v, "ema200": e200_v,
            "rsi": rsi_v, "atr": atr_v, "volume_ratio": vol_r,
            "macd": macd_v, "macd_signal": macd_sig_v, "macd_hist": macd_hist_v,
            "bb_upper": bb_upper_v, "bb_mid": bb_mid_v, "bb_lower": bb_lower_v, "bb_bw": bb_bw_v,
            "score_total": score,
            "score_trend": _sub_trend,
            "score_pa": _sub_pa,
            "score_sr": _sub_sr,
            "score_patterns": _sub_patterns,
            "score_regime": _sub_regime,
            "score_smc": _sub_smc,
            "score_mtf": _sub_mtf,
            "score_sentiment": _sub_sentiment,
        },
        "session": {
            "session": session_info.get("session"),
            "overlap": session_info.get("overlap"),
            "minutes_after_session_open": session_info.get("minutes_after_session_open"),
            "hour": session_info.get("hour"),
            "weekday": session_info.get("weekday"),
            "is_weekend": session_info.get("is_weekend"),
        },
        "price_action": {
            "trend":      pa.get("trend"),
            "structure":  pa.get("structure"),
            "bos":        pa.get("bos"),
            "bos_dir":    pa.get("bos_dir"),
            "bos_score":  pa.get("bos_score"),
            "choch":      pa.get("choch"),
            "last_swing_high": pa.get("last_swing_high"),
            "last_swing_low":  pa.get("last_swing_low"),
        },
        "sr_zones": {
            "supports":        sr.get("supports",    [])[:3],
            "resistances":     sr.get("resistances", [])[:3],
            "near_support":    sr.get("near_support"),
            "near_resistance": sr.get("near_resistance"),
        },
        "patterns": pats,
        "detectedPatterns": chart_patterns,
        "prz": chart_patterns[0].get("prz") if chart_patterns else None,
        "fibTargets": chart_patterns[0].get("targets") if chart_patterns else None,
        "confluenceScore": chart_patterns[0].get("confluenceScore") if chart_patterns else None,
        "confluenceTags": chart_patterns[0].get("confluenceTags") if chart_patterns else [],
        "regime":   {
            "regime":         regime.get("regime"),
            "adx":            regime.get("adx"),
            "trend_strength": regime.get("trend_strength"),
            "above_ema200":   regime.get("above_ema200"),
            "description":    regime.get("description"),
        },
        "smc": {
            "fvg": {
                "bullish":         smc["fvg"].get("bullish", [])[:2],
                "bearish":         smc["fvg"].get("bearish", [])[:2],
                "near_bullish_fvg": smc["fvg"].get("near_bullish_fvg"),
                "near_bearish_fvg": smc["fvg"].get("near_bearish_fvg"),
                "total_open":      smc["fvg"].get("total_open", 0),
            },
            "ob": {
                "bullish":       smc["ob"].get("bullish", [])[:2],
                "bearish":       smc["ob"].get("bearish", [])[:2],
                "near_bullish_ob": smc["ob"].get("near_bullish_ob"),
                "near_bearish_ob": smc["ob"].get("near_bearish_ob"),
            },
            "liquidity": {
                "equal_highs": smc["liquidity"].get("equal_highs", [])[:2],
                "equal_lows":  smc["liquidity"].get("equal_lows", [])[:2],
                "near_eqh":   smc["liquidity"].get("near_eqh"),
                "near_eql":   smc["liquidity"].get("near_eql"),
            },
        },
        "synthetic_stats": synthetic_stats if asset_type == "SYNTHETIC" else {},
        "forex_context": forex_context if asset_type == "FOREX" else {},
        "onchain_context": (
            {**(onchain or {}), "flags": advanced_flags}
            if asset_type == "CRYPTO" else {}
        ),
        "tokenomics_context": (
            {"data": tokenomics_context, "flags": tokenomics_flags}
            if asset_type == "CRYPTO" else {}
        ),
        "social_context": social_context if asset_type == "CRYPTO" else {},
        "market_concept_vector": market_concept_vector,
        "market_embedding": market_embedding,
        "feature_vector": feature_vector,
        "mtf_context": {
            "ltf":         timeframe,
            "mtf":         _mtf_tf,
            "htf":         _htf_tf,
            "mtf_regime":  (mtf_regime or {}).get("regime"),
            "htf_regime":  (htf_regime or {}).get("regime"),
            "mtf_adx":     (mtf_regime or {}).get("adx"),
            "htf_adx":     (htf_regime or {}).get("adx"),
            "mtf_aligned": _mtf_aligned,
            "htf_aligned": _htf_aligned,
            "confluence":  (
                "FULL"    if _mtf_aligned and _htf_aligned else
                "PARTIAL" if _mtf_aligned or  _htf_aligned else
                "NONE"    if (_mtf_aligned is False or _htf_aligned is False) else
                "UNKNOWN"
            ),
        },
        "risk": {
            "decision":       risk_assessment.decision.value if risk_assessment else "SKIPPED",
            "size_multiplier": risk_assessment.size_multiplier if risk_assessment else 1.0,
            "risk_pct":        risk_assessment.risk_pct if risk_assessment else 0.0,
            "adjusted_score":  risk_assessment.adjusted_score if risk_assessment else 0.0,
            "reasons":         risk_assessment.reasons if risk_assessment else [],
            "factors":         risk_assessment.factors if risk_assessment else {},
            "kill_switch":     risk_assessment.kill_switch_state if risk_assessment else "",
            "drawdown":        risk_assessment.drawdown_level if risk_assessment else "",
            "crisis_mode":     risk_assessment.crisis_mode if risk_assessment else False,
        } if risk_assessment else None,
        "correlation_id": corr_id,
    }

    logger.info("analyze_candles.end", correlation_id=corr_id, symbol=symbol, signal=signal, confidence=confidence)
    clear_correlation_id()
    return result


async def fetch_and_analyze(symbol: str, timeframe: str, htf_regime: Optional[dict] = None, strategy: Optional[dict] = None) -> dict:
    """Fetch klines et analyse un actif — utilisé par warmup et fallback."""
    tf = TF_MAP.get(timeframe, "1h")
    df = await fetch_binance_klines(symbol, tf)
    if df is None:
        df = await fetch_twelvedata_klines(symbol, tf)
    if df is None or len(df) < 50:
        return {"symbol": symbol, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}

    # Forex macro context (DXY momentum + economic calendar) — computed async before sync analysis
    forex_context = None
    if get_asset_type(symbol) == "FOREX":
        _, forex_context = await should_suspend_forex(symbol)

    # Tokenomics risk (crypto) — computed async before sync analysis
    tokenomics_context = None
    if get_asset_type(symbol) == "CRYPTO":
        try:
            tokenomics_context = await asyncio.wait_for(fetch_tokenomics(symbol), timeout=3.0)
        except Exception as exc:
            logger.warning("tokenomics_context_failed", symbol=symbol, error=str(exc))
            tokenomics_context = None

    # Social sentiment (crypto) — computed async before sync analysis
    social_context = None
    if get_asset_type(symbol) == "CRYPTO":
        try:
            social_context = await asyncio.wait_for(fetch_social_metrics(symbol), timeout=3.0)
        except Exception as exc:
            logger.warning("social_context_failed", symbol=symbol, error=str(exc))
            social_context = None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        lambda: analyze_candles(
            symbol, timeframe, df,
            htf_regime=htf_regime,
            strategy=strategy,
            forex_context=forex_context,
            tokenomics_context=tokenomics_context,
            social_context=social_context,
        ),
    )


async def warmup_fast():
    """Boucle rapide — actifs Binance prioritaires, cycle 60s.
    Binance REST est gratuit et sans limite raisonnable.
    Couvre 15m et 1h pour le day trading.
    """
    logger.info("warmup_fast_start", symbols=len(BINANCE_PRIORITY_SYMBOLS), interval=WARMUP_INTERVAL_FAST)
    while True:
        t0 = time.monotonic()
        strategies = await _load_active_strategies()
        for timeframe in WARMUP_TIMEFRAMES_FAST:
            for sym in BINANCE_PRIORITY_SYMBOLS:
                for strat in strategies or [None]:
                    try:
                        res = await fetch_and_analyze(sym, timeframe, strategy=strat)
                        if res and not isinstance(res, Exception):
                            suffix = f":{strat['id']}" if strat else ""
                            await set_cached(f"scan:{sym}:{timeframe}{suffix}", res, ttl=WARMUP_TTL_FAST)
                            await _persist_scan(res, timeframe)
                    except Exception as e:
                        logger.warning("warmup_fast_failed", symbol=sym, tf=timeframe, error=str(e))
            logger.info("warmup_fast_done", timeframe=timeframe,
                        symbols=len(BINANCE_PRIORITY_SYMBOLS), strategies=len(strategies),
                        elapsed_ms=round((time.monotonic() - t0) * 1000))
        # Attendre le reste du cycle (60s - temps du scan)
        elapsed = time.monotonic() - t0
        wait = max(0, WARMUP_INTERVAL_FAST - elapsed)
        await asyncio.sleep(wait)


async def warmup_medium():
    """Boucle medium — actifs Deriv (synthétiques), cycle 2 min.
    Les indices de volatilité bougent vite et nécessitent un scan plus fréquent.
    """
    logger.info("warmup_medium_start", symbols=len(DERIV_SYMBOLS), interval=WARMUP_INTERVAL_MEDIUM)
    await asyncio.sleep(5)
    while True:
        t0 = time.monotonic()
        strategies = await _load_active_strategies()
        for timeframe in WARMUP_TIMEFRAMES_MEDIUM:
            for sym in DERIV_SYMBOLS:
                for strat in strategies or [None]:
                    try:
                        res = await fetch_and_analyze(sym, timeframe, strategy=strat)
                        if res:
                            suffix = f":{strat['id']}" if strat else ""
                            await set_cached(f"scan:{sym}:{timeframe}{suffix}", res, ttl=WARMUP_TTL_MEDIUM)
                            await _persist_scan(res, timeframe)
                    except Exception as e:
                        logger.warning("warmup_medium_failed", symbol=sym, tf=timeframe, error=str(e))
                await asyncio.sleep(0.3)
            logger.info("warmup_medium_done", timeframe=timeframe, symbols=len(DERIV_SYMBOLS), strategies=len(strategies))
        elapsed = time.monotonic() - t0
        wait = max(0, WARMUP_INTERVAL_MEDIUM - elapsed)
        await asyncio.sleep(wait)


async def warmup_slow():
    """Boucle lente — Forex et Commodités, cycle 5 min.
    Séquentiel avec pause pour respecter les limites yfinance/TwelveData.
    """
    logger.info("warmup_slow_start", symbols=len(FOREX_COMMODITY_SYMBOLS), interval=WARMUP_INTERVAL_SLOW)
    # Décalage initial pour ne pas surcharger au démarrage
    await asyncio.sleep(15)
    while True:
        t0 = time.monotonic()
        strategies = await _load_active_strategies()
        for timeframe in WARMUP_TIMEFRAMES_SLOW:
            for sym in FOREX_COMMODITY_SYMBOLS:
                for strat in strategies or [None]:
                    try:
                        res = await fetch_and_analyze(sym, timeframe, strategy=strat)
                        if res:
                            suffix = f":{strat['id']}" if strat else ""
                            await set_cached(f"scan:{sym}:{timeframe}{suffix}", res, ttl=WARMUP_TTL_SLOW)
                            await _persist_scan(res, timeframe)
                    except Exception as e:
                        logger.warning("warmup_slow_failed", symbol=sym, tf=timeframe, error=str(e))
                await asyncio.sleep(0.5)  # respecter rate limits Twelve Data / yfinance
            logger.info("warmup_slow_done", timeframe=timeframe, symbols=len(FOREX_COMMODITY_SYMBOLS), strategies=len(strategies))
        elapsed = time.monotonic() - t0
        wait = max(0, WARMUP_INTERVAL_SLOW - elapsed)
        await asyncio.sleep(wait)


def _is_brvm_open() -> bool:
    """Check if BRVM market is currently open (Mon-Fri 10:00-14:30 UTC)."""
    now = time.gmtime()
    if now.tm_wday >= 5:  # Saturday=5, Sunday=6
        return False
    hour = now.tm_hour
    minute = now.tm_min
    if hour < BRVM_OPEN_HOUR or hour > BRVM_CLOSE_HOUR:
        return False
    if hour == BRVM_CLOSE_HOUR and minute > BRVM_CLOSE_MIN:
        return False
    return True


async def warmup_brvm():
    """Boucle BRVM — actions BRVM, cycle 5 min, uniquement pendant les heures de marché.
    BRVM: Lundi-Vendredi 10:00-14:30 UTC.
    """
    logger.info("warmup_brvm_start", symbols=len(BRVM_SYMBOLS), interval=WARMUP_INTERVAL_BRVM)
    await asyncio.sleep(30)
    while True:
        if not _is_brvm_open():
            logger.info("warmup_brvm_skipped", reason="market_closed")
            await asyncio.sleep(60)
            continue
        t0 = time.monotonic()
        strategies = await _load_active_strategies()
        for timeframe in WARMUP_TIMEFRAMES_BRVM:
            for sym in BRVM_SYMBOLS:
                for strat in strategies or [None]:
                    try:
                        res = await fetch_and_analyze(sym, timeframe, strategy=strat)
                        if res:
                            suffix = f":{strat['id']}" if strat else ""
                            await set_cached(f"scan:{sym}:{timeframe}{suffix}", res, ttl=WARMUP_TTL_BRVM)
                            await _persist_scan(res, timeframe)
                    except Exception as e:
                        logger.warning("warmup_brvm_failed", symbol=sym, tf=timeframe, error=str(e))
                await asyncio.sleep(0.5)
            logger.info("warmup_brvm_done", timeframe=timeframe, symbols=len(BRVM_SYMBOLS), strategies=len(strategies))
        elapsed = time.monotonic() - t0
        wait = max(0, WARMUP_INTERVAL_BRVM - elapsed)
        await asyncio.sleep(wait)


async def warmup_features():
    """Point d'entrée — lance les 4 boucles de scan + le batch flusher en parallèle."""
    await asyncio.gather(
        warmup_fast(),
        warmup_medium(),
        warmup_slow(),
        warmup_brvm(),
        _scan_batch_flusher(),
    )


@router.post("/multi")
async def scan_multi(req: ScanRequest):
    t0  = time.monotonic()
    tf  = TF_MAP.get(req.timeframe, "1h")
    loop = asyncio.get_event_loop()
    inc("scan:requests_total")

    # 0. Séparer BRVM des autres marchés
    brvm_symbols = [s for s in req.symbols if is_brvm_symbol(s)]
    other_symbols = [s for s in req.symbols if s not in brvm_symbols]

    # 0b. Cache lookup rapide pour les actifs non-BRVM
    cached_results = []
    missing_symbols = []
    provider_failures: dict[str, list[str]] = defaultdict(list)
    if req.strategies:
        missing_symbols = other_symbols
    else:
        for sym in other_symbols:
            cached = await get_cached(f"scan:{sym}:{req.timeframe}")
            if cached:
                cached_results.append({**cached, "cached": True})
            else:
                missing_symbols.append(sym)

    async def _fetch(sym: str) -> Optional[pd.DataFrame]:
        # Essai Binance en premier (crypto)
        df = await fetch_binance_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("binance")
        # Fallback Deriv pour indices synthétiques
        df = await fetch_deriv_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("deriv")
        # Fallback yfinance pour forex/commodities (gratuit, illimité, proxy volume)
        df = await fetch_yfinance_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("yfinance")
        # Fallback Twelve Data (quota free: 8 req/min, 800/jour) — dernier recours
        df = await fetch_twelvedata_klines(sym, tf)
        if df is not None:
            provider_failures.pop(sym, None)
            return df
        provider_failures[sym].append("twelvedata")
        return None

    # 1a. Fetch régimes MTF + HTF en parallèle selon la hiérarchie 3-TF
    # 5m  -> MTF=1h,  HTF=4h
    # 15m -> MTF=1h,  HTF=4h
    # 1h  -> MTF=4h,  HTF=1d
    # 4h  -> MTF=1d,  HTF=1d  (fallback)
    mtf_regimes: dict[str, Optional[dict]] = {}   # TF intermédiaire (décision)
    htf_regimes: dict[str, Optional[dict]] = {}   # TF supérieur (contexte macro)

    if missing_symbols:
        mtf_tf, htf_tf = _TF_HIERARCHY.get(req.timeframe, ("4h", "1d"))

        async def _fetch_regime(sym: str, interval: str) -> tuple[str, str, Optional[dict]]:
            try:
                df_htf = await asyncio.wait_for(
                    fetch_binance_klines(sym, interval, limit=100),
                    timeout=3.0,
                )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_deriv_klines(sym, interval, limit=100),
                        timeout=5.0,
                    )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_yfinance_klines(sym, interval, limit=100),
                        timeout=6.0,
                    )
                if df_htf is None:
                    df_htf = await asyncio.wait_for(
                        fetch_twelvedata_klines(sym, interval, limit=100),
                        timeout=3.0,
                    )
                if df_htf is not None and len(df_htf) >= 50:
                    r = detect_regime(df_htf["high"], df_htf["low"], df_htf["close"])
                    return sym, interval, r
            except Exception as exc:
                logger.warning(
                    "regime_fetch_failed",
                    symbol=sym,
                    interval=interval,
                    error=str(exc),
                )
            return sym, interval, None

        # Fetch MTF et HTF simultanément — si MTF == HTF (cas 4h) on ne déduplique pas
        regime_tasks = (
            [_fetch_regime(sym, mtf_tf) for sym in missing_symbols] +
            ([_fetch_regime(sym, htf_tf) for sym in missing_symbols] if htf_tf != mtf_tf else [])
        )
        regime_results = await asyncio.gather(*regime_tasks, return_exceptions=True)
        for item in regime_results:
            if not isinstance(item, Exception):
                sym, interval, reg = item
                if interval == mtf_tf:
                    mtf_regimes[sym] = reg
                elif interval == htf_tf:
                    htf_regimes[sym] = reg
        # Cas MTF == HTF : copier MTF dans HTF
        if htf_tf == mtf_tf:
            htf_regimes = dict(mtf_regimes)

    # 1b. Fetch toutes les klines LTF en parallèle — Binance + Deriv + yfinance + TwelveData fallback, timeout 15s
    fetch_coros = [asyncio.wait_for(_fetch(sym), timeout=15.0) for sym in missing_symbols]
    dfs_raw = await asyncio.gather(*fetch_coros, return_exceptions=True)
    dfs = [None if isinstance(d, Exception) else d for d in dfs_raw]

    async def _no_data(s: str):
        payload = {"symbol": s, "signal": "NEUTRAL", "confidence": 0, "reason": "no data"}
        if provider_failures.get(s):
            payload["missing_sources"] = provider_failures[s]
        return payload

    # 1c. Contexte on-chain (crypto uniquement) : Fear&Greed partagé + funding/OI par symbole
    onchain_contexts: dict[str, dict] = {}
    tokenomics_contexts: dict[str, dict] = {}
    social_contexts: dict[str, dict] = {}
    crypto_symbols = [s for s in missing_symbols if is_crypto_symbol(s)]
    if crypto_symbols:
        try:
            fg = await asyncio.wait_for(fear_greed(), timeout=3.0)
            fg_value = fg.get("value") if isinstance(fg, dict) else None
        except Exception as exc:
            logger.warning("fear_greed_failed", error=str(exc))
            fg_value = None

        async def _fetch_onchain(sym: str):
            try:
                ctx = await asyncio.wait_for(onchain_context(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("onchain_context_failed", symbol=sym, error=str(exc))
                ctx = {}
            return sym, ctx

        onchain_results = await asyncio.gather(
            *[_fetch_onchain(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in onchain_results:
            if not isinstance(item, Exception):
                sym, ctx = item
                onchain_contexts[sym] = {"context": ctx, "fear_greed": fg_value}

        # 1c-bis. Advanced on-chain context (exchange netflow, MVRV, dev, TVL)
        async def _fetch_advanced(sym: str):
            try:
                adv = await asyncio.wait_for(get_advanced_onchain_context(sym), timeout=4.0)
            except Exception as exc:
                logger.warning("advanced_onchain_failed", symbol=sym, error=str(exc))
                adv = {}
            return sym, adv

        advanced_results = await asyncio.gather(
            *[_fetch_advanced(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in advanced_results:
            if not isinstance(item, Exception):
                sym, adv = item
                onchain_contexts.setdefault(sym, {})
                onchain_contexts[sym]["advanced"] = adv

        # 1c-ter. Tokenomics context (unlock schedule + concentration)
        tokenomics_contexts: dict[str, dict] = {}

        async def _fetch_tokenomics(sym: str):
            try:
                tctx = await asyncio.wait_for(fetch_tokenomics(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("tokenomics_batch_failed", symbol=sym, error=str(exc))
                tctx = {}
            return sym, tctx

        tokenomics_results = await asyncio.gather(
            *[_fetch_tokenomics(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in tokenomics_results:
            if not isinstance(item, Exception):
                sym, tctx = item
                tokenomics_contexts[sym] = tctx

        # 1c-quater. Social sentiment context (LunarCrush)
        social_contexts: dict[str, dict] = {}

        async def _fetch_social(sym: str):
            try:
                sctx = await asyncio.wait_for(fetch_social_metrics(sym), timeout=3.0)
            except Exception as exc:
                logger.warning("social_batch_failed", symbol=sym, error=str(exc))
                sctx = {}
            return sym, sctx

        social_results = await asyncio.gather(
            *[_fetch_social(sym) for sym in crypto_symbols], return_exceptions=True
        )
        for item in social_results:
            if not isinstance(item, Exception):
                sym, sctx = item
                social_contexts[sym] = sctx

    # 1d. Scheduler différencié analysis_timeframe/entry_timeframe (Sprint 3) — dernière
    # clôture sur le(s) entry_timeframe(s) distincts déclarés par les stratégies actives.
    entry_contexts: dict[tuple[str, str], dict] = {}   # (symbol, entry_timeframe) -> {"close": float}
    entry_tfs_needed = {
        strat.get("entryTimeframe") or strat.get("entry_timeframe")
        for strat in (req.strategies or [])
        if (strat.get("entryTimeframe") or strat.get("entry_timeframe"))
        and (strat.get("entryTimeframe") or strat.get("entry_timeframe")) != req.timeframe
    }
    if entry_tfs_needed and missing_symbols:
        async def _fetch_entry_close(sym: str, etf: str):
            etf_mapped = TF_MAP.get(etf, etf)
            try:
                df_e = await fetch_binance_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_deriv_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_yfinance_klines(sym, etf_mapped, limit=5)
                if df_e is None:
                    df_e = await fetch_twelvedata_klines(sym, etf_mapped, limit=5)
                if df_e is not None and len(df_e) > 0:
                    return sym, etf, {"close": float(df_e["close"].iloc[-1])}
            except Exception as exc:
                logger.warning("entry_close_fetch_failed", symbol=sym, entry_tf=etf, error=str(exc))
            return sym, etf, None

        entry_tasks = [
            _fetch_entry_close(sym, etf) for sym in missing_symbols for etf in entry_tfs_needed
        ]
        entry_results = await asyncio.gather(*entry_tasks, return_exceptions=True)
        for item in entry_results:
            if not isinstance(item, Exception) and item[2] is not None:
                sym, etf, ctx = item
                entry_contexts[(sym, etf)] = ctx

    # 2. Analyse CPU dans un thread pool pour ne pas bloquer l'event loop
    analyze_tasks = []
    for sym, df in zip(missing_symbols, dfs):
        if df is None or len(df) < 50:
            analyze_tasks.append(_no_data(sym))
        else:
            htf_r = htf_regimes.get(sym)
            mtf_r = mtf_regimes.get(sym)
            onchain_ctx = onchain_contexts.get(sym)
            tokenomics_ctx = tokenomics_contexts.get(sym)
            social_ctx = social_contexts.get(sym)
            if req.strategies:
                for strat in req.strategies:
                    etf = strat.get("entryTimeframe") or strat.get("entry_timeframe")
                    entry_ctx = entry_contexts.get((sym, etf)) if etf else None
                    analyze_tasks.append(
                        loop.run_in_executor(
                            _executor, analyze_candles, sym, req.timeframe, df,
                            htf_r, mtf_r, strat, onchain_ctx, entry_ctx, None, tokenomics_ctx, social_ctx,
                        )
                    )
            else:
                analyze_tasks.append(
                    loop.run_in_executor(
                        _executor, analyze_candles, sym, req.timeframe, df,
                        htf_r, mtf_r, None, onchain_ctx, None, None, tokenomics_ctx, social_ctx,
                    )
                )

    computed_results = list(await asyncio.gather(*analyze_tasks))
    for r in computed_results:
        cache_key = f"scan:{r['symbol']}:{req.timeframe}"
        if r.get("strategy_id"):
            cache_key = f"{cache_key}:{r['strategy_id']}"
        await set_cached(cache_key, r, ttl=WARMUP_TTL_SECONDS)

    brvm_results = []
    if brvm_symbols:
        brvm_results = await analyze_brvm_symbols(brvm_symbols)

    results = cached_results + computed_results + brvm_results

    # 3. Enrichissement sentiment news (en parallèle, timeout 2s max)
    if config.settings.news_api_key:
        sentiment_tasks = [
            get_news_sentiment(NewsRequest(symbol=r["symbol"], limit=5, analyze=True))
            for r in results if r.get("signal") in ("BUY", "SELL")
        ]
        if sentiment_tasks:
            try:
                sentiments = await asyncio.wait_for(
                    asyncio.gather(*sentiment_tasks, return_exceptions=True),
                    timeout=2.0,
                )
            except asyncio.TimeoutError:
                sentiments = []
                logger.warning("news_sentiment_timeout", symbols=len(sentiment_tasks))
            sent_map = {}
            for s in sentiments:
                if not isinstance(s, Exception):
                    sent_map[s.symbol] = s

            for r in results:
                s = sent_map.get(r["symbol"])
                if s:
                    bonus = s.confidence_bonus
                    # Bonus aligné avec la direction du signal
                    if r.get("signal") == "BUY" and s.sentiment == "bearish":
                        bonus = -abs(bonus)
                    elif r.get("signal") == "SELL" and s.sentiment == "bullish":
                        bonus = -abs(bonus)

                    r["confidence"]     = max(0, min(95, r.get("confidence", 0) + bonus))
                    r["news_sentiment"] = {
                        "label":   s.sentiment,
                        "score":   s.score,
                        "bonus":   bonus,
                        "articles": [
                            {"title": a.title, "source": a.source, "url": a.url, "published_at": a.published_at}
                            for a in s.articles[:3]
                        ],
                    }

    # 4. Enrichissement sentiment scraper propriétaire (RSS + Reddit + Nitter)
    # Stratégie non-bloquante : si cache chaud → enrichit immédiatement,
    # sinon → fire-and-forget (le prochain appel bénéficiera du cache 15min).
    active_signals = [r for r in results if r.get("signal") in ("BUY", "SELL")]
    symbols_missing_cache: list[str] = []

    for r in active_signals:
        from routers.news_scraper import _cache_get as _sc_get
        cached_articles = _sc_get(f"scraper:{r['symbol']}")
        if cached_articles is not None:
            # Cache chaud → enrichissement immédiat sans réseau
            agg = aggregate_sentiment(cached_articles)
            bonus = agg["bonus"]
            if r.get("signal") == "BUY" and agg["label"] == "bearish":
                bonus = -abs(bonus)
            elif r.get("signal") == "SELL" and agg["label"] == "bullish":
                bonus = -abs(bonus)
            r["confidence"] = max(0, min(95, r.get("confidence", 0) + bonus))
            r["scraper_sentiment"] = {
                "label":   agg["label"],
                "score":   agg["score"],
                "bonus":   bonus,
                "bullish": agg["bullish"],
                "bearish": agg["bearish"],
                "sources": list({a.source for a in cached_articles[:5]}),
                "cached":  True,
            }
        else:
            symbols_missing_cache.append(r["symbol"])

    # Fire-and-forget pour les symboles sans cache — le résultat sera dispo au prochain scan
    if symbols_missing_cache:
        async def _warm_scraper_cache(syms: list[str]):
            tasks = [scrape_all_sources(s) for s in syms]
            await asyncio.gather(*tasks, return_exceptions=True)
        asyncio.create_task(_warm_scraper_cache(symbols_missing_cache))

    # 4b. Contexte macro + on-chain pour les signaux actifs
    active_symbols = [r["symbol"] for r in results if r.get("signal") in ("BUY", "SELL")]
    if active_symbols:
        try:
            context_tasks = [get_signal_context(sym) for sym in active_symbols]
            context_results = await asyncio.wait_for(
                asyncio.gather(*context_tasks, return_exceptions=True),
                timeout=3.0,
            )
            context_map = {sym: ctx for sym, ctx in zip(active_symbols, context_results) if not isinstance(ctx, Exception)}
            for r in results:
                if r["symbol"] in context_map and context_map[r["symbol"]]:
                    r["context"] = context_map[r["symbol"]]
        except asyncio.TimeoutError:
            logger.warning("market_context_timeout", symbols=len(active_symbols))

    # 5. Hystérésis flip-flop + persistence_score — évite BUY→NEUTRAL→BUY sur scans successifs
    apply_hysteresis_and_persistence(results, req.timeframe, _signal_state, time.monotonic())

    # 6. Analyse du risque portefeuille — clustering signaux corrélés
    portfolio_risk = analyze_portfolio_risk(results)
    if portfolio_risk["alerts"]:
        logger.warning(
            "portfolio_risk_alert",
            risk_level=portfolio_risk["risk_level"],
            alerts=len(portfolio_risk["alerts"]),
            summary=portfolio_risk["summary"],
        )

    # Annoter chaque résultat avec son cluster
    for r in results:
        r["cluster"] = get_cluster(r["symbol"])

    # Persist scan results to Redis + DB batch queue
    for r in results:
        await _persist_scan(r, req.timeframe)

    ws_module.set_latest_signals(results)

    elapsed_ms = (time.monotonic() - t0) * 1000
    inc("scan:signals_total", len(results))
    inc("scan:buy_signals", sum(1 for r in results if r.get("signal") == "BUY"))
    inc("scan:sell_signals", sum(1 for r in results if r.get("signal") == "SELL"))
    observe("scan:duration_ms", elapsed_ms)

    data_gaps = [
        {"symbol": sym, "providers": providers}
        for sym, providers in provider_failures.items()
        if providers
    ]

    return {
        "scanned":        len(results),
        "timeframe":      req.timeframe,
        "elapsed_ms":     round(elapsed_ms, 2),
        "results":        results,
        "portfolio_risk": portfolio_risk,
        "data_gaps":      data_gaps,
    }


@router.get("/history")
async def scan_history(limit: int = 50, strategy: str | None = None, signal: str | None = None):
    """Retourne les derniers scans depuis Redis (temps réel, TTL 1h)."""
    try:
        r = await cache.client()
        raw_entries = await r.lrange("scan_history:recent", 0, min(limit * 4, 499))
        entries = []
        for raw in raw_entries:
            try:
                entry = json.loads(raw)
            except Exception:
                continue
            if strategy and entry.get("strategy_name") != strategy:
                continue
            if signal and entry.get("signal") != signal:
                continue
            entries.append(entry)
            if len(entries) >= limit:
                break
        return {"count": len(entries), "entries": entries}
    except Exception as e:
        return {"count": 0, "entries": [], "error": str(e)}

