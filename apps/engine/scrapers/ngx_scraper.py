"""
NGX Scraper — Nigerian Exchange Group (Nigeria)
Uses yfinance with .LG suffix for real-time quotes and historical OHLCV.
NGX trading hours: 10:00-14:30 WAT (09:00-13:30 UTC, Mon-Fri).
~142 listed equities.
"""
import asyncio
from typing import List

from scrapers.base_africa_scraper import BaseAfricaScraper
from utils.logger import get_logger

logger = get_logger(__name__)

# NGX listed companies (sourced from stockanalysis.com + NGXGroup)
NGX_SYMBOLS = [
    # A
    "ABBEYBANK", "ABCTRANS", "ACADEMY", "ACCESSCORP", "AFRINSURE", "AFRIPRUD",
    "AFROMEDIA", "AIICO", "AIRTELAFRI", "ALEX", "ARADEL", "ARBICO",
    "AUSTINLAZ", "AVAIF", "AVACAP",
    # B
    "BAPLC", "BERGER", "BETAGLAS", "BUACEMENT", "BUAFOODS",
    # C
    "CADBURY", "CAP", "CAPHOTEL", "CAVERTON", "CHAMPION", "CHAMS",
    "CHELLARAM", "CHIPLC", "CILEASING", "CMFC", "CONHALLPLC", "CONOIL",
    "CORNERST", "CUSTODIAN", "CUTIX", "CWG",
    # D
    "DAARCOMM", "DANGCEM", "DANGSUGAR",
    # E
    "EKOCORP", "ELLAHLAKES", "ENAMELWA", "ETERNA", "ETI", "ETRANZACT",
    "EUNISELL",
    # F
    "FCMB", "FIDELITYBK", "FIDSON", "FIRSTHOLDCO", "FTGINSURE", "FTNCOCOA",
    # G
    "GEREGU", "GOLDBREW", "GTCO", "GUINEAINS", "GUINNESS",
    # H
    "HBMNG", "HMCALL", "HONYFLOUR",
    # I
    "IKEJAHOTEL", "IMG", "INFINITY", "INTBREW", "INTENEGINS",
    # J
    "JAIZBANK", "JAPAULGOLD", "JBERGER", "JOHNHOLT", "JULI",
    # L
    "LASACO", "LEARNAFRCA", "LEGENDINT", "LINKASSURE", "LIVESTOCK",
    "LIVINGTRUST",
    # M
    "MANSARD", "MAYBAKER", "MBENEFIT", "MCNICHOLS", "MECURE", "MEYER",
    "MORISON", "MULTITREX", "MULTIVERSE",
    # N
    "NAHCO", "NASCON", "NB", "NCR", "NEIMETH", "NEM", "NESTLE",
    "NNFM", "NPFMCRFBK", "NSLTECH",
    # O
    "OANDO", "OKOMUOIL", "OMATEK",
    # P
    "PHARMDEKO", "PREMPAINTS", "PRESCO", "PRESTIGE", "PZ",
    # R
    "REDSTAREX", "REGALINS", "RONCHESS", "ROYALEX", "RTBRISCOE",
    # S
    "SCOA", "SEPLAT", "SFSREIT", "SKYAVN", "SOVRENINS", "STACO",
    "STANBIC", "STERLINGNG", "SUNUASSUR",
    # T
    "TANTALIZER", "THOMASWY", "TIP", "TOTAL", "TRANSCORP", "TRANSCOHOT",
    "TRANSEXPR", "TRANSPOWER", "TRIPPLEG",
    # U
    "UACN", "UBA", "UCAP", "UHOMREIT", "UNITYBNK", "UNIONDICON",
    "UNIVINSURE", "UNILEVER", "UPDC", "UPDCREIT", "UPL",
    # V
    "VERITASKAP", "VFDGROUP", "VITAFOAM",
    # Z
    "ZENITHBANK", "ZICHIS",
    # NGX itself
    "NGXGROUP",
]


class NGXScraper(BaseAfricaScraper):
    exchange_code = "NGX"
    exchange_name = "Nigerian Exchange Group"
    currency = "NGN"
    yfinance_suffix = ".LG"
    symbols = NGX_SYMBOLS
    candles_table = "ngx_daily_candles"
    # NGX: 10:00-14:30 WAT = 09:00-13:30 UTC (WAT = UTC+1)
    market_open = (9, 0)
    market_close = (13, 30)
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
                            "market": "NGX",
                            "currency": "NGN",
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
