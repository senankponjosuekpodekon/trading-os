"""
GSE Scraper — Ghana Stock Exchange (Ghana)
Uses yfinance with .GH suffix for real-time quotes and historical OHLCV.
GSE trading hours: 10:00-15:00 GMT (10:00-15:00 UTC, Mon-Fri).
~39 listed equities.
"""
import asyncio
from typing import List

from scrapers.base_africa_scraper import BaseAfricaScraper
from utils.logger import get_logger

logger = get_logger(__name__)

# GSE listed companies (sourced from gse.com.gh + mansamarkets.com)
GSE_SYMBOLS = [
    # A
    "AADS", "ACCESS", "ADB", "AGA", "ALW", "ALLGH", "ASG",
    # B
    "BOPP",
    # C
    "CAL", "CLYD", "CMLT", "CPC",
    # D
    "DASPHARMA", "DIGICUT",
    # E
    "EGL", "EGH", "ETI",
    # F
    "FAB", "FML",
    # G
    "GCB", "GGBL", "GLD", "GOIL",
    # H
    "HORDS",
    # I
    "IIL",
    # K
    "KASA",
    # M
    "MAC", "MMH", "MTNGH",
    # R
    "RBGH",
    # S
    "SAMBA", "SCB", "SCBPREF", "SIC", "SOGEGH",
    # T
    "TBL", "TLW", "TOTAL",
    # U
    "UNIL",
    # Z
    "ZEN",
]


class GSEScraper(BaseAfricaScraper):
    exchange_code = "GSE"
    exchange_name = "Ghana Stock Exchange"
    currency = "GHS"
    yfinance_suffix = ".GH"
    symbols = GSE_SYMBOLS
    candles_table = "gse_daily_candles"
    # GSE: 10:00-15:00 GMT = 10:00-15:00 UTC (GMT = UTC+0)
    market_open = (10, 0)
    market_close = (15, 0)
    trading_days = (0, 1, 2, 3, 4)

    async def fetch_quotes(self) -> List[dict]:
        """Fetch real-time quotes via yfinance batch API.
        Fetch in chunks of 20 symbols to avoid rate limits.
        """
        import yfinance as yf

        quotes = []
        batch_size = 20
        batches = [self.symbols[i:i+batch_size] for i in range(0, len(self.symbols), batch_size)]

        async def _fetch_batch(batch: list[str]) -> List[dict]:
            loop = asyncio.get_event_loop()
            def _sync_fetch():
                results = []
                for sym in batch:
                    try:
                        ticker = yf.Ticker(f"{sym}{self.yfinance_suffix}")
                        info = ticker.fast_info
                        price = float(info.last_price or 0)
                        prev = float(info.previous_close or 0)
                        if price <= 0:
                            continue
                        chg = round(price - prev, 2)
                        chg_pct = round((chg / prev * 100) if prev > 0 else 0, 2)
                        vol = int(info.last_volume or 0)
                        results.append({
                            "symbol": sym,
                            "name": sym,
                            "price": round(price, 2),
                            "change": chg,
                            "change_pct": chg_pct,
                            "volume": vol,
                            "market": "GSE",
                            "currency": "GHS",
                        })
                    except Exception:
                        continue
                return results
            return await loop.run_in_executor(None, _sync_fetch)

        tasks = [_fetch_batch(b) for b in batches]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, list):
                quotes.extend(res)

        if quotes:
            await self.persist_daily_candles(quotes)

        return quotes
