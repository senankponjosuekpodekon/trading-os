"""
Base scraper for African stock exchanges.
Each exchange (JSE, NGX, NSE, GSE, EGX, etc.) extends BaseAfricaScraper
and implements fetch_quotes() + fetch_history().

Common patterns:
- Market hours check (each exchange has different trading hours)
- DB persistence of daily candles (OHLCV accumulation)
- yfinance fallback for exchanges with .JO/.LG/.NR suffixes
- Mock data generation when scraping fails
"""
import asyncio
from abc import ABC, abstractmethod
from datetime import date as _date
from typing import List

from utils.logger import get_logger

logger = get_logger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/json",
}


class BaseAfricaScraper(ABC):
    """Abstract base for African exchange scrapers.

    Subclasses must define:
    - exchange_code: short code (e.g. "JSE", "NGX", "NSE", "GSE")
    - exchange_name: full name
    - currency: trading currency
    - yfinance_suffix: yfinance market suffix (e.g. ".JO" for JSE, ".LG" for NGX)
    - symbols: list of ticker symbols
    - market_open / market_close: UTC hours (tuple (hour, minute))
    - trading_days: range of weekdays (0=Mon .. 6=Sun)
    """

    exchange_code: str = ""
    exchange_name: str = ""
    currency: str = ""
    yfinance_suffix: str = ""
    symbols: list[str] = []
    market_open: tuple[int, int] = (0, 0)   # (hour, minute) UTC
    market_close: tuple[int, int] = (0, 0)  # (hour, minute) UTC
    trading_days: tuple[int, ...] = (0, 1, 2, 3, 4)  # Mon-Fri

    # DB table name for daily candles (must match Prisma schema)
    candles_table: str = ""

    @abstractmethod
    async def fetch_quotes(self) -> List[dict]:
        """Fetch real-time quotes for all symbols.
        Returns list of dicts: {symbol, name, price, change, change_pct, volume, market, currency}
        """
        ...

    async def fetch_history(self, symbol: str, period: str = "2y") -> list[dict]:
        """Fetch historical OHLCV. Default: yfinance + DB fallback.
        Override for exchanges that need custom scraping.
        """
        # 1. Try DB first (accumulated local history)
        db_rows = await self._fetch_db_history(symbol)
        if len(db_rows) >= 20:
            return db_rows

        # 2. Try yfinance
        yf_rows = await self._fetch_yfinance_history(symbol, period)
        if yf_rows and len(yf_rows) >= 10:
            await self._persist_yfinance_candles(symbol, yf_rows)
            return yf_rows

        # 3. Return whatever DB has
        return db_rows

    async def batch_fetch_history(self, symbols: list[str], period: str = "2y") -> dict[str, list[dict]]:
        """Batch fetch history for multiple symbols. Override for optimized batch queries."""
        result: dict[str, list[dict]] = {}
        tasks = [self.fetch_history(s, period) for s in symbols]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for sym, res in zip(symbols, results):
            if isinstance(res, Exception):
                result[sym] = []
            else:
                result[sym] = res
        return result

    def is_market_open(self) -> bool:
        """Check if the exchange is currently in trading hours."""
        import time
        now = time.gmtime()
        if now.tm_wday not in self.trading_days:
            return False
        current_min = now.tm_hour * 60 + now.tm_min
        open_min = self.market_open[0] * 60 + self.market_open[1]
        close_min = self.market_close[0] * 60 + self.market_close[1]
        return open_min <= current_min < close_min

    def is_symbol(self, symbol: str) -> bool:
        return symbol in self.symbols

    def mock_quotes(self) -> List[dict]:
        """Generate deterministic mock data when scraping fails."""
        import random
        random.seed(hash(self.exchange_code) % 2**32)
        mock = []
        for sym in self.symbols:
            base_price = random.uniform(100, 10000)
            chg_pct = round(random.uniform(-3.5, 4.5), 2)
            mock.append({
                "symbol": sym,
                "name": f"{sym} ({self.exchange_name})",
                "price": round(base_price, 2),
                "change": round(base_price * chg_pct / 100, 2),
                "change_pct": chg_pct,
                "volume": random.randint(100, 50000),
                "market": self.exchange_code,
                "currency": self.currency,
            })
        return mock

    async def _fetch_yfinance_history(self, symbol: str, period: str) -> list[dict]:
        """Fetch OHLCV from yfinance using the exchange's suffix."""
        try:
            import yfinance as yf
            ticker_sym = f"{symbol}{self.yfinance_suffix}" if self.yfinance_suffix else symbol
            ticker = yf.Ticker(ticker_sym)
            df = ticker.history(period=period)
            if df is None or df.empty:
                return []
            df.columns = [c.lower() for c in df.columns]
            records = []
            for idx, row in df.iterrows():
                records.append({
                    "date": idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx),
                    "open": float(row.get("open", 0)),
                    "high": float(row.get("high", 0)),
                    "low": float(row.get("low", 0)),
                    "close": float(row.get("close", 0)),
                    "volume": int(row.get("volume", 0) or 0),
                })
            return records
        except Exception as e:
            logger.debug(f"yfinance_history_failed {self.exchange_code} {symbol}", error=str(e))
            return []

    async def _persist_yfinance_candles(self, symbol: str, candles: list[dict]) -> None:
        """Persist yfinance history to DB for future use."""
        if not self.candles_table or not candles:
            return
        try:
            from utils.db_pool import get_shared_pool
            pool = await get_shared_pool()
            async with pool.acquire() as conn:
                for c in candles:
                    await conn.execute(
                        f"""INSERT INTO {self.candles_table} (symbol, date, open, high, low, close, volume)
                            VALUES ($1, $2, $3, $4, $5, $6, $7)
                            ON CONFLICT (symbol, date) DO UPDATE SET
                              high = GREATEST({self.candles_table}.high, EXCLUDED.high),
                              low  = LEAST({self.candles_table}.low, EXCLUDED.low),
                              close = EXCLUDED.close""",
                        symbol, c["date"], c["open"], c["high"], c["low"], c["close"], c["volume"],
                    )
        except Exception as e:
            logger.debug(f"persist_candles_failed {self.exchange_code} {symbol}", error=str(e))

    async def _fetch_db_history(self, symbol: str, limit: int = 500) -> list[dict]:
        """Fetch accumulated daily candles from DB."""
        if not self.candles_table:
            return []
        try:
            from utils.db_pool import get_shared_pool
            pool = await get_shared_pool()
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    f"""SELECT date, open, high, low, close, volume
                        FROM {self.candles_table}
                        WHERE symbol = $1
                        ORDER BY date ASC
                        LIMIT $2""",
                    symbol, limit,
                )
            return [
                {
                    "date": r["date"].isoformat(),
                    "open": float(r["open"] or r["close"]),
                    "high": float(r["high"] or r["close"]),
                    "low": float(r["low"] or r["close"]),
                    "close": float(r["close"]),
                    "volume": int(r["volume"] or 0),
                }
                for r in rows
            ]
        except Exception:
            return []

    async def persist_daily_candles(self, quotes: List[dict]) -> None:
        """Upsert today's quotes into DB."""
        if not self.candles_table:
            return
        from utils.db_pool import get_shared_pool
        today = _date.today()
        try:
            pool = await get_shared_pool()
            async with pool.acquire() as conn:
                for q in quotes:
                    sym = q.get("symbol", "")
                    price = float(q.get("price", 0) or 0)
                    if not sym or price <= 0:
                        continue
                    vol = int(q.get("volume", 0) or 0)
                    await conn.execute(
                        f"""INSERT INTO {self.candles_table} (symbol, date, open, high, low, close, volume)
                            VALUES ($1, $2, $3, $3, $3, $3, $4)
                            ON CONFLICT (symbol, date) DO UPDATE SET
                              high   = GREATEST({self.candles_table}.high, EXCLUDED.high),
                              low    = LEAST({self.candles_table}.low, EXCLUDED.low),
                              close  = EXCLUDED.close,
                              volume = {self.candles_table}.volume + EXCLUDED.volume""",
                        sym, today, price, vol,
                    )
        except Exception as e:
            logger.debug(f"persist_daily_candles_failed {self.exchange_code}", error=str(e))
