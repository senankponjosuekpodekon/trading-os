"""
NSE Scraper — Nairobi Securities Exchange (Kenya)
Uses yfinance with .NR suffix for real-time quotes and historical OHLCV.
NSE trading hours: 09:00-15:00 EAT (06:00-12:00 UTC, Mon-Fri).
~60 listed equities.
"""
import asyncio
from typing import List

from scrapers.base_africa_scraper import BaseAfricaScraper
from utils.logger import get_logger

logger = get_logger(__name__)

# NSE Kenya listed companies (sourced from african-markets.com)
NSE_SYMBOLS = [
    # A
    "ABSA", "ARM",
    # B
    "BATK", "BAMB", "BOC", "BRIT", "BKG",
    # C
    "CABL", "CARB", "CGEN", "CHQ", "CIC", "COOP", "CRWN", "CTUM",
    # D
    "DCON", "DTK",
    # E
    "EABL", "EAPC", "EGAD", "EQTY", "EVRD",
    # F
    "FMLY", "FTGH",
    # H
    "HAFR", "HEL", "HFCK",
    # I
    "IMH",
    # J
    "JUB",
    # K
    "KAPC", "KCB", "KEGN", "KNRE", "KPC", "KPLC", "KQ", "KUKZ", "KURV",
    # L
    "LAPR", "LBTY", "LIMT", "LKL",
    # M
    "MSC",
    # N
    "NBV", "NCBA", "NMG", "NSE",
    # O
    "OCH", "ORCH",
    # S
    "SBIC", "SCAN", "SCBK", "SCOM", "SGL", "SKL", "SLAM", "SMER", "SMWF",
    "SASN",
    # T
    "TCL", "TOTL", "TPSE", "TRFC",
    # U
    "UCHM", "UMME", "UNGA",
    # W
    "WTK",
    # X
    "XPRS",
]


class NSEScraper(BaseAfricaScraper):
    exchange_code = "NSE"
    exchange_name = "Nairobi Securities Exchange"
    currency = "KES"
    yfinance_suffix = ".NR"
    symbols = NSE_SYMBOLS
    candles_table = "nse_daily_candles"
    # NSE: 09:00-15:00 EAT = 06:00-12:00 UTC (EAT = UTC+3)
    market_open = (6, 0)
    market_close = (12, 0)
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
                            "market": "NSE",
                            "currency": "KES",
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
