"""
Unified Africa Market Router — single entry point for all African exchanges.
Dispatches to per-exchange scrapers: JSE, NGX, NSE, GSE, EGX, BRVM.

Endpoints:
  GET  /africa/quotes?exchange=JSE       — real-time quotes
  GET  /africa/quotes/all                — all exchanges in one call
  POST /africa/scan                      — scan with optional exchange filter
  GET  /africa/top-movers?exchange=JSE   — top gainers/losers
  GET  /africa/health                    — status of all exchanges
  GET  /africa/history/{symbol}          — historical OHLCV
"""
from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import asyncio

from utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()

# Registry of exchange scrapers (populated lazily)
_scrapers: dict[str, object] = {}


def _get_scraper(exchange: str) -> Optional[object]:
    """Get a scraper by exchange code. Lazily instantiated."""
    exchange = exchange.upper()
    if exchange in _scrapers:
        return _scrapers[exchange]

    if exchange == "BRVM":
        _scrapers["BRVM"] = _BrvmAdapter()
        return _scrapers["BRVM"]

    if exchange == "JSE":
        try:
            from scrapers.jse_scraper import JSEScraper
            _scrapers["JSE"] = JSEScraper()
            return _scrapers["JSE"]
        except ImportError:
            logger.warning("jse_scraper_not_available")
            return None

    if exchange == "NGX":
        try:
            from scrapers.ngx_scraper import NGXScraper
            _scrapers["NGX"] = NGXScraper()
            return _scrapers["NGX"]
        except ImportError:
            logger.warning("ngx_scraper_not_available")
            return None

    if exchange == "NSE":
        try:
            from scrapers.nse_scraper import NSEScraper
            _scrapers["NSE"] = NSEScraper()
            return _scrapers["NSE"]
        except ImportError:
            logger.warning("nse_scraper_not_available")
            return None

    if exchange == "GSE":
        try:
            from scrapers.gse_scraper import GSEScraper
            _scrapers["GSE"] = GSEScraper()
            return _scrapers["GSE"]
        except ImportError:
            logger.warning("gse_scraper_not_available")
            return None

    logger.warning(f"unknown_exchange {exchange}")
    return None


def get_available_exchanges() -> list[str]:
    """Return list of exchange codes that have scrapers available."""
    available = []
    for code in ("BRVM", "JSE", "NGX", "NSE", "GSE"):
        if _get_scraper(code) is not None:
            available.append(code)
    return available


class _BrvmAdapter:
    """Adapter to make the existing BRVM scraper conform to BaseAfricaScraper interface."""
    exchange_code = "BRVM"
    exchange_name = "Bourse Regionale des Valeurs Mobilieres"
    currency = "XOF"
    yfinance_suffix = ""
    symbols: list[str] = []
    candles_table = "brvm_daily_candles"
    market_open = (10, 0)
    market_close = (14, 30)
    trading_days = (0, 1, 2, 3, 4)

    def __init__(self):
        from scrapers.brvm_scraper import BRVM_SYMBOLS
        self.symbols = BRVM_SYMBOLS

    async def fetch_quotes(self):
        from scrapers.brvm_scraper import fetch_brvm_quotes
        return await fetch_brvm_quotes()

    def mock_quotes(self):
        from scrapers.brvm_scraper import _mock_brvm_quotes
        return _mock_brvm_quotes()

    def is_market_open(self) -> bool:
        import time
        now = time.gmtime()
        if now.tm_wday >= 5:
            return False
        current_min = now.tm_hour * 60 + now.tm_min
        return 600 <= current_min < 870

    def is_symbol(self, symbol: str) -> bool:
        from scrapers.brvm_scraper import is_brvm_symbol
        return is_brvm_symbol(symbol)

    async def fetch_history(self, symbol: str, period: str = "2y"):
        from scrapers.brvm_scraper import fetch_brvm_history
        return await fetch_brvm_history(symbol, period)

    async def batch_fetch_history(self, symbols: list[str], period: str = "2y"):
        from scrapers.brvm_scraper import batch_fetch_brvm_history
        return await batch_fetch_brvm_history(symbols, period)


class AfricaScanRequest(BaseModel):
    exchange: Optional[str] = None
    symbols: Optional[List[str]] = None


@router.get("/africa/quotes")
async def get_africa_quotes(
    exchange: str = Query(..., description="Exchange code: BRVM, JSE, NGX, NSE, GSE"),
):
    """Real-time quotes for a single African exchange."""
    scraper = _get_scraper(exchange)
    if not scraper:
        return {"error": f"Exchange {exchange} not supported", "available": get_available_exchanges()}

    quotes = await scraper.fetch_quotes()
    if not quotes:
        quotes = scraper.mock_quotes()
        source = "mock"
    else:
        source = "live"

    return {
        "quotes": quotes,
        "count": len(quotes),
        "exchange": exchange.upper(),
        "source": source,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/africa/quotes/all")
async def get_all_africa_quotes():
    """Quotes from all available African exchanges in one call."""
    exchanges = get_available_exchanges()
    tasks = []
    for code in exchanges:
        scraper = _get_scraper(code)
        tasks.append(scraper.fetch_quotes())

    results = await asyncio.gather(*tasks, return_exceptions=True)
    all_quotes = []
    statuses = {}
    for code, res in zip(exchanges, results):
        if isinstance(res, Exception):
            statuses[code] = {"status": "error", "error": str(res)}
            scraper = _get_scraper(code)
            if scraper:
                all_quotes.extend(scraper.mock_quotes())
        elif res:
            statuses[code] = {"status": "live", "count": len(res)}
            all_quotes.extend(res)
        else:
            scraper = _get_scraper(code)
            if scraper:
                mock = scraper.mock_quotes()
                all_quotes.extend(mock)
                statuses[code] = {"status": "mock", "count": len(mock)}

    return {
        "quotes": all_quotes,
        "total": len(all_quotes),
        "exchanges": statuses,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.post("/africa/scan")
async def scan_africa(req: AfricaScanRequest):
    """Scan one or all African exchanges for signals."""
    if req.exchange:
        exchanges = [req.exchange.upper()]
    else:
        exchanges = get_available_exchanges()

    all_signals = []
    for code in exchanges:
        scraper = _get_scraper(code)
        if not scraper:
            continue

        quotes = await scraper.fetch_quotes()
        if not quotes:
            quotes = scraper.mock_quotes()

        if req.symbols:
            quotes = [q for q in quotes if q["symbol"] in req.symbols]

        for q in quotes:
            chg = q.get("change_pct", 0)
            vol = q.get("volume", 0)
            score = 0
            reasons = []

            if chg > 5:
                score += 40
                reasons.append(f"Strong move +{chg}%")
            elif chg > 3:
                score += 25
                reasons.append(f"Up move +{chg}%")
            elif chg < -5:
                score -= 40
                reasons.append(f"Sharp drop {chg}%")
            elif chg < -3:
                score -= 25
                reasons.append(f"Down move {chg}%")

            if vol > 10000:
                score += 20 if score > 0 else -20
                reasons.append(f"High volume ({vol:,})")

            if score >= 25:
                signal = "BUY"
            elif score <= -25:
                signal = "SELL"
            else:
                signal = "WATCH"

            confidence = min(95, round(abs(score) / 75 * 95))

            all_signals.append({
                **q,
                "signal": signal,
                "score": score,
                "confidence": confidence,
                "reasons": " | ".join(reasons) or "Neutral",
                "exchange": code,
            })

    all_signals.sort(key=lambda x: abs(x.get("score", 0)), reverse=True)

    return {
        "results": all_signals,
        "total": len(all_signals),
        "exchanges_scanned": exchanges,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/africa/top-movers")
async def get_africa_top_movers(
    exchange: str = Query(..., description="Exchange code"),
):
    """Top gainers and losers for a given exchange."""
    scraper = _get_scraper(exchange)
    if not scraper:
        return {"error": f"Exchange {exchange} not supported"}

    quotes = await scraper.fetch_quotes()
    if not quotes:
        quotes = scraper.mock_quotes()
        source = "mock"
    else:
        source = "live"

    sorted_q = sorted(quotes, key=lambda x: x.get("change_pct", 0), reverse=True)
    return {
        "top_gainers": sorted_q[:5],
        "top_losers": sorted_q[-5:],
        "exchange": exchange.upper(),
        "source": source,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/africa/health")
async def africa_health():
    """Health status of all African exchange scrapers."""
    exchanges = get_available_exchanges()
    statuses = []
    for code in exchanges:
        scraper = _get_scraper(code)
        statuses.append({
            "exchange": code,
            "name": scraper.exchange_name if scraper else "Unknown",
            "symbols_tracked": len(scraper.symbols) if scraper else 0,
            "market_open": scraper.is_market_open() if scraper else False,
            "currency": scraper.currency if scraper else "",
        })
    return {"status": "ok", "exchanges": statuses, "total": len(statuses)}


@router.get("/africa/history/{symbol}")
async def get_africa_history(
    symbol: str,
    exchange: str = Query(..., description="Exchange code"),
    period: str = Query("2y", description="Period: 1y, 2y, 5y"),
):
    """Historical OHLCV for a symbol on a given exchange."""
    scraper = _get_scraper(exchange)
    if not scraper:
        return {"error": f"Exchange {exchange} not supported"}

    history = await scraper.fetch_history(symbol, period)
    return {
        "symbol": symbol,
        "exchange": exchange.upper(),
        "history": history,
        "count": len(history),
    }
