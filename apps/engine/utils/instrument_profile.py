"""
Instrument profile loader — fiche instrument unique pour les coûts, le
contrat et les feeds de prix (cf. docs/instrument_spec.md).

Source : table instrument_profile (PostgreSQL). Cache mémoire 60 s,
pattern identique à utils/asset_config.py. Tout consommateur de coûts
ou de feed DOIT passer par ici — fini les constantes dupliquées.
"""
import asyncio
import time

from utils.logger import get_logger

logger = get_logger(__name__)

_CACHE_TTL = 60  # seconds
_cache: dict[str, dict] = {}
_cache_ts: float = 0.0
_cache_lock = asyncio.Lock()

# Valeurs de repli si la fiche est absente — identiques aux anciennes
# constantes pour ne pas changer le comportement par défaut.
_DEFAULTS_BY_VENUE = {
    "FUTURES": {"spread_rt": 0.0, "taker_rt": 0.0014, "slippage_rt_obs": 0.0,
                "carry_source": "funding", "carry_freq": "8h", "carry_rate": 0.0001},
    "MARGIN":  {"spread_rt": 0.0002, "taker_rt": 0.0, "slippage_rt_obs": 0.0,
                "carry_source": "swap", "carry_freq": "daily", "carry_rate": 0.0000781},
    "SPOT":    {"spread_rt": 0.0, "taker_rt": 0.002, "slippage_rt_obs": 0.0,
                "carry_source": "none", "carry_freq": None, "carry_rate": None},
    "SYNTHETIC": {"spread_rt": 0.0002, "taker_rt": 0.0, "slippage_rt_obs": 0.0,
                  "carry_source": "swap", "carry_freq": "daily", "carry_rate": 0.0000781},
}

_COLUMNS = ("symbol", "venue", "asset_class", "quote_currency", "shortable",
            "multiplier", "tick_size", "lot_min", "notional_min", "max_leverage",
            "spread_rt", "taker_rt", "maker_rt", "slippage_rt_obs",
            "carry_source", "carry_freq", "carry_rate",
            "price_source_scan", "price_source_resolve", "feed_offset_obs",
            "liq_buffer", "tradable", "candles_since",
            "capital_max_exchange", "source", "updated_at")


async def load_instrument_profiles(force: bool = False) -> dict[str, dict]:
    """Load all instrument profiles. Refreshes every 60 s."""
    global _cache, _cache_ts
    if not force and _cache and (time.time() - _cache_ts) < _CACHE_TTL:
        return _cache
    async with _cache_lock:
        if not force and _cache and (time.time() - _cache_ts) < _CACHE_TTL:
            return _cache
        try:
            from utils.db_pool import get_shared_pool
            pool = await get_shared_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    f"SELECT {', '.join(_COLUMNS)} FROM instrument_profile"
                )
            _cache = {r["symbol"]: dict(r) for r in rows}
            _cache_ts = time.time()
        except Exception as e:
            logger.warning("instrument_profile_load_failed", error=str(e))
    return _cache


async def get_instrument_profile(symbol: str) -> dict:
    """Profile d'un instrument — fiche si présente, sinon défauts par venue."""
    profiles = await load_instrument_profiles()
    if symbol in profiles:
        return profiles[symbol]
    venue = infer_venue(symbol)
    base = {"symbol": symbol, "venue": venue, "tradable": True,
            "feed_offset_obs": 0.0, "liq_buffer": 0.015, "source": "fallback"}
    base.update(_DEFAULTS_BY_VENUE.get(venue, _DEFAULTS_BY_VENUE["MARGIN"]))
    return base


_CRYPTO_BASES = {"BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK",
                 "DOT", "MATIC", "NEAR", "DOGE", "LTC", "ATOM", "UNI", "TRX"}


def infer_venue(symbol: str) -> str:
    base = symbol.split("/")[0].upper()
    if base in _CRYPTO_BASES:
        return "FUTURES"
    return "MARGIN"


def costs_for_backtest(profile: dict) -> dict:
    """Coûts au format du backtest : rt_frac (fixe A/R) + per_8h (carry)."""
    carry = profile.get("carry_rate") or 0.0
    if profile.get("carry_freq") == "daily":
        per_8h = carry / 3.0
    else:
        per_8h = carry
    return {
        "rt_frac": (profile.get("spread_rt") or 0) + (profile.get("taker_rt") or 0)
                   + (profile.get("slippage_rt_obs") or 0),
        "per_8h": per_8h,
    }
