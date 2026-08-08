"""Macro rotation signal — BTC → ETH → altcoins → memecoins.

Detects the current capital rotation phase in crypto markets by comparing:
- BTC dominance trend (rising = BTC phase, falling = altcoin phase)
- ETH/BTC ratio (rising = ETH phase)
- Top altcoin performance vs BTC
- Fear & Greed index (extreme greed = late rotation, memecoin phase)

Phases:
  1. BTC          — BTC dominance rising, BTC leads
  2. ETH          — BTC dominance stabilizing/falling, ETH outperforms BTC
  3. ALTCOINS     — BTC dominance falling, altcoins outperform
  4. MEMECOINS    — Extreme greed, memecoins pumping (late cycle, high risk)
  0. RISK_OFF     — Everything bleeding, capital exiting crypto
"""

import asyncio
import httpx

from utils.cache import cache
from utils.logger import get_logger
from utils.http import retry_async

logger = get_logger(__name__)

CACHE_TTL = 600  # 10 min

# Thresholds
BTC_DOM_RISING = 0.5      # BTC dominance change > 0.5% = rising
BTC_DOM_FALLING = -0.5    # BTC dominance change < -0.5% = falling
ETH_OUTPERFORM = 2.0      # ETH/BTC 24h change > 2% = ETH outperforming
ALT_OUTPERFORM = 5.0      # Top altcoins 24h change > 5% above BTC
EXTREME_GREED = 75        # F&G >= 75 = extreme greed (memecoin territory)
RISK_OFF_THRESHOLD = -5   # BTC 24h change < -5% = risk-off


async def _fetch_btc_dominance() -> dict | None:
    """Fetch BTC dominance + 24h change from CoinGecko global."""
    cached = await cache.get("macro:btc_dominance")
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.coingecko.com/api/v3/global")
                r.raise_for_status()
                return r.json()

        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        mcp = data.get("data", {}).get("market_cap_percentage", {})
        btc_dom = float(mcp.get("btc", 0))
        eth_dom = float(mcp.get("eth", 0))

        mcap_change_24h = data.get("data", {}).get("market_cap_change_percentage_24h_usd", 0)

        result = {
            "btc_dominance": round(btc_dom, 2),
            "eth_dominance": round(eth_dom, 2),
            "total_mcap_change_24h": round(float(mcap_change_24h), 2),
        }
        await cache.set("macro:btc_dominance", result, ttl=CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("macro_btc_dominance_failed", error=str(e))
        return None


async def _fetch_eth_btc_ratio() -> dict | None:
    """Fetch ETH/BTC price and 24h change from Binance."""
    cached = await cache.get("macro:eth_btc")
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.binance.com/api/v3/ticker/24hr?symbol=ETHBTC")
                r.raise_for_status()
                return r.json()

        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="binance")
        result = {
            "price": float(data.get("lastPrice", 0)),
            "change_24h": float(data.get("priceChangePercent", 0)),
        }
        await cache.set("macro:eth_btc", result, ttl=CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("macro_eth_btc_failed", error=str(e))
        return None


async def _fetch_btc_24h() -> dict | None:
    """Fetch BTC 24h price change from Binance."""
    cached = await cache.get("macro:btc_24h")
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")
                r.raise_for_status()
                return r.json()

        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="binance")
        result = {
            "price": float(data.get("lastPrice", 0)),
            "change_24h": float(data.get("priceChangePercent", 0)),
        }
        await cache.set("macro:btc_24h", result, ttl=CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("macro_btc_24h_failed", error=str(e))
        return None


async def _fetch_top_altcoins_performance() -> dict | None:
    """Fetch top altcoins 24h performance from Binance."""
    cached = await cache.get("macro:altcoins")
    if cached:
        return cached
    try:
        symbols = [
            "SOLUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
            "ADAUSDT", "NEARUSDT", "ARBUSDT", "OPUSDT",
        ]
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                # Fetch multiple tickers at once
                symbols_param = "%5B" + "%2C".join(f'"{s}"' for s in symbols) + "%5D"
                r = await client.get(
                    f"https://api.binance.com/api/v3/ticker/24hr?symbols={symbols_param}"
                )
                r.raise_for_status()
                return r.json()

        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="binance")
        changes = []
        for ticker in data:
            changes.append(float(ticker.get("priceChangePercent", 0)))

        avg_change = sum(changes) / len(changes) if changes else 0
        max_change = max(changes) if changes else 0
        result = {
            "avg_24h": round(avg_change, 2),
            "max_24h": round(max_change, 2),
            "count": len(changes),
        }
        await cache.set("macro:altcoins", result, ttl=CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("macro_altcoins_failed", error=str(e))
        return None


async def _fetch_fear_greed() -> int | None:
    """Fetch Fear & Greed index value."""
    cached = await cache.get("macro:fear_greed")
    if cached is not None:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get("https://api.alternative.me/fng/")
                r.raise_for_status()
                return r.json()

        data = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        value = int(data.get("data", [{}])[0].get("value", 50))
        await cache.set("macro:fear_greed", value, ttl=CACHE_TTL)
        return value
    except Exception as e:
        logger.warning("macro_fear_greed_failed", error=str(e))
        return None


async def compute_macro_rotation() -> dict:
    """Compute the current macro rotation phase.

    Returns:
        {
            "phase": "BTC" | "ETH" | "ALTCOINS" | "MEMECOINS" | "RISK_OFF",
            "phase_label": str,
            "phase_description": str,
            "confidence": int (0-100),
            "data": { ... raw metrics ... },
            "implication": str,  # what this means for trading
            "warning": str | None,
        }
    """
    # Fetch all data in parallel
    btc_dom, eth_btc, btc_24h, altcoins, fg = await asyncio.gather(
        _fetch_btc_dominance(),
        _fetch_eth_btc_ratio(),
        _fetch_btc_24h(),
        _fetch_top_altcoins_performance(),
        _fetch_fear_greed(),
        return_exceptions=True,
    )

    # Handle exceptions
    btc_dom = btc_dom if not isinstance(btc_dom, Exception) else None
    eth_btc = eth_btc if not isinstance(eth_btc, Exception) else None
    btc_24h = btc_24h if not isinstance(btc_24h, Exception) else None
    altcoins = altcoins if not isinstance(altcoins, Exception) else None
    fg = fg if not isinstance(fg, Exception) else None

    # If we can't get BTC data, return unknown
    if btc_24h is None and btc_dom is None:
        return {
            "phase": "UNKNOWN",
            "phase_label": "Données insuffisantes",
            "phase_description": "Impossible de déterminer la phase de rotation",
            "confidence": 0,
            "data": {},
            "implication": "Surveiller manuellement",
            "warning": None,
        }

    btc_change = btc_24h.get("change_24h", 0) if btc_24h else 0
    btc_dom_val = btc_dom.get("btc_dominance", 50) if btc_dom else 50
    total_mcap_change = btc_dom.get("total_mcap_change_24h", 0) if btc_dom else 0
    eth_btc_change = eth_btc.get("change_24h", 0) if eth_btc else 0
    alt_avg = altcoins.get("avg_24h", 0) if altcoins else 0
    alt_max = altcoins.get("max_24h", 0) if altcoins else 0
    fg_value = fg if fg is not None else 50

    # ── Determine phase ──

    # Phase 0: RISK_OFF — everything bleeding
    if btc_change < RISK_OFF_THRESHOLD and total_mcap_change < RISK_OFF_THRESHOLD:
        phase = "RISK_OFF"
        confidence = min(100, abs(btc_change) * 10)
        implication = "Réduire l'exposition, attendre une stabilisation"
        warning = "Marché en vente massive — éviter les nouvelles positions"
        description = "Le capital sort du crypto. BTC chute de plus de 5% en 24h."
        label = "Risk-Off"

    # Phase 4: MEMECOINS — extreme greed + altcoins pumping hard
    elif fg_value >= EXTREME_GREED and alt_max > 15:
        phase = "MEMECOINS"
        confidence = min(100, fg_value)
        implication = "Fin de cycle probable — sécuriser les gains, éviter d'entrer"
        warning = "Greed extrême + pumps altcoins — rotation en fin de course, prudence maximale"
        description = "Greed extrême et pumps généralisés. Les memecoins mènent la danse — c'est typiquement la fin du cycle de rotation."
        label = "Memecoins (Fin de cycle)"

    # Phase 1: BTC — BTC dominance rising, BTC outperforming
    elif btc_change > 0 and eth_btc_change < 0 and btc_dom_val >= 50:
        phase = "BTC"
        confidence = min(100, int(abs(btc_change) * 10 + (btc_dom_val - 50)))
        implication = "Capital concentré sur BTC — privilégier BTC ou attendre la rotation"
        warning = None
        description = "BTC domine et attire le capital. La dominance BTC monte, ETH sous-performe."
        label = "BTC (Rotation début)"

    # Phase 2: ETH — ETH outperforming BTC
    elif eth_btc_change > ETH_OUTPERFORM and btc_change > 0:
        phase = "ETH"
        confidence = min(100, int(eth_btc_change * 10))
        implication = "Rotation vers ETH — ETH et L2s (ARB, OP) à surveiller"
        warning = None
        description = "ETH outperforme BTC. Le capital rotate vers Ethereum et son écosystème."
        label = "ETH (Rotation en cours)"

    # Phase 3: ALTCOINS — altcoins outperforming BTC
    elif alt_avg > btc_change + ALT_OUTPERFORM / 2 and btc_dom_val < 55:
        phase = "ALTCOINS"
        confidence = min(100, int((alt_avg - btc_change) * 10))
        implication = "Altseason — diversifier vers les altcoins de qualité (mid/large cap)"
        warning = "Surveiller le F&G — si > 75, la rotation approche de sa fin"
        description = "Les altcoins outperforment BTC. La dominance BTC baisse, capital rotate vers les altcoins."
        label = "Altcoins (Altseason)"

    # Default: neutral / transitioning
    else:
        phase = "TRANSITION"
        confidence = 30
        implication = "Marché en transition — surveiller BTC dominance et ETH/BTC"
        warning = None
        description = "Aucune rotation claire détectée. Marché en phase de transition."
        label = "Transition"

    return {
        "phase": phase,
        "phase_label": label,
        "phase_description": description,
        "confidence": confidence,
        "data": {
            "btc_dominance": btc_dom_val,
            "btc_change_24h": round(btc_change, 2),
            "eth_btc_change_24h": round(eth_btc_change, 2),
            "altcoins_avg_24h": round(alt_avg, 2),
            "altcoins_max_24h": round(alt_max, 2),
            "total_mcap_change_24h": round(total_mcap_change, 2),
            "fear_greed": fg_value,
        },
        "implication": implication,
        "warning": warning,
    }
