"""
JSE Scraper — Johannesburg Stock Exchange (South Africa)
Uses yfinance with .JO suffix for real-time quotes and historical OHLCV.
JSE trading hours: 09:00-17:00 SAST (07:00-15:00 UTC, Mon-Fri).
~300+ liquid ordinary shares tracked.
"""
import asyncio
from typing import List

from scrapers.base_africa_scraper import BaseAfricaScraper
from utils.logger import get_logger

logger = get_logger(__name__)

# JSE ordinary shares (liquid, non-pref, non-BEE schemes)
# Sourced from african-markets.com JSE listed companies
JSE_SYMBOLS = [
    # A
    "ABL", "ABG", "ACE", "ACG", "ACS", "ACT", "AEC", "AFH", "AGL", "AHL", "AIL",
    "AIM", "ALH", "ALT", "ANI", "AOA", "APH", "API", "APT", "ART", "ASC", "ASR",
    "ATI", "ATL", "ATT", "AVI", "AVL", "AVR", "AVV", "AWT", "AYO",
    # B
    "BAU", "BAW", "BCF", "BEL", "BID", "BIK", "BIL", "BLU", "BNT", "BRT", "BSR",
    "BSS", "BTI", "BUC", "BVT", "BWN", "BWZ",
    # C
    "CAC", "CAT", "CCO", "CFR", "CGN", "CGR", "CHP", "CIL", "CKS", "CLH", "CLI",
    "CLR", "CLS", "CMA", "CMH", "CML", "CMO", "CND", "COH", "COM", "CPI", "CRD",
    "CRG", "CRP", "CSB", "CSG", "CSP", "CTA", "CTK", "CUL", "CVH", "CZA",
    # D
    "DAW", "DCP", "DGH", "DIA", "DKR", "DLT", "DMC", "DNB", "DRA", "DRD", "DRN",
    "DSY", "DTA", "DTC",
    # E
    "ECS", "EEL", "EFG", "EHS", "ELI", "ELR", "EMH", "EMN", "EMI", "ENX", "EOH",
    "EPE", "EPS", "EQU", "ERN", "ESR", "EUZ", "EXP", "EXX",
    # F
    "FBR", "FCR", "FDP", "FFA", "FFB", "FGL", "FSE", "FSR", "FSR", "FVT",
    # G
    "GAM", "GBG", "GBI", "GDN", "GFI", "GIY", "GLI", "GLN", "GML", "GND", "GPL",
    "GRT", "GSH", "GTC", "GTR",
    # H
    "HAR", "HCI", "HDC", "HET", "HIL", "HLM", "HPA", "HPR", "HSP", "HUG", "HUL",
    "HWA", "HWN", "HYP",
    # I
    "IAP", "IDQ", "IHL", "ILE", "ILU", "IMP", "ING", "INL", "INP", "IPF", "IPL",
    "IPS", "ISA", "ISB", "ITE", "ITU", "IVT", "IWE",
    # J
    "JBL", "JSC", "JSE",
    # K
    "KAL", "KAP", "KBO", "KDV", "KEH", "KIO", "KP2", "KRO", "KST",
    # L
    "L2D", "L4L", "LAB", "LBH", "LBR", "LDO", "LEW", "LHC", "LNF", "LON", "LTE",
    "LUX",
    # M
    "MAP", "MAS", "MCG", "MDI", "MED", "MEI", "MFI", "MFL", "MHB", "MIX", "MLE",
    "MLD", "MND", "MNK", "MNP", "MNY", "MPT", "MRP", "MRI", "MSM", "MSP", "MST",
    "MTA", "MTH", "MTM", "MTN", "MUR", "MZR",
    # N
    "N91", "NCS", "NED", "NFP", "NHM", "NIV", "NPK", "NPN", "NRL", "NT1", "NTC",
    "NUT", "NVE", "NVS", "NWL", "NY1", "NRP",
    # O
    "OAO", "OAS", "OCE", "OCT", "OLG", "OML", "OMN", "OMU", "ORE", "ORN",
    # P
    "PAN", "PBG", "PCT", "PEM", "PET", "PFG", "PGL", "PGR", "PHM", "PIK", "PKT",
    "PMV", "PNC", "PPC", "PPE", "PPH", "PPR", "PRX", "PSG", "PSV", "PWK",
    # Q
    "QFH", "QLT",
    # R
    "RAR", "RAV", "RBP", "RBX", "RCL", "RDF", "RDI", "REB", "REM", "REN", "RES",
    "RFG", "RLF", "RLO", "RMH", "RMI", "RNG", "RPL", "RSG", "RTO",
    # S
    "S32", "SAC", "SAP", "SAR", "SBK", "SBP", "SBV", "SCD", "SCP", "SDO", "SEA",
    "SEP", "SFN", "SGA", "SHF", "SHG", "SHP", "SLM", "SNH", "SNT", "SNU", "SNV",
    "SOH", "SOL", "SPA", "SPG", "SPP", "SRE", "SSK", "SSS", "SSW", "STA", "STP",
    "SUI", "SUR", "SVB", "SYG",
    # T
    "TAS", "TAW", "TBG", "TBS", "TCP", "TCS", "TDH", "TGA", "TFG", "TEX", "THA",
    "TKG", "TLM", "TMT", "TON", "TOR", "TPC", "TPF", "TRE", "TRL", "TRU", "TSG",
    "TSH", "TSX", "TTO", "TWR", "TXT",
    # U
    "UAT", "UPL",
    # V
    "VIS", "VKE", "VLE", "VMK", "VOD", "VUN", "VVO",
    # W
    "WBO", "WCC", "WEA", "WEZ", "WHL", "WIL", "WKF", "WNH", "WSL",
    # Y
    "YRK", "YYLBEE",
    # Z
    "ZCI", "ZCL", "ZED", "ZED", "ZPLP",
    # 4
    "4SI",
]


class JSEScraper(BaseAfricaScraper):
    exchange_code = "JSE"
    exchange_name = "Johannesburg Stock Exchange"
    currency = "ZAR"
    yfinance_suffix = ".JO"
    symbols = JSE_SYMBOLS
    candles_table = "jse_daily_candles"
    # JSE: 09:00-17:00 SAST = 07:00-15:00 UTC (SAST = UTC+2)
    market_open = (7, 0)
    market_close = (15, 0)
    trading_days = (0, 1, 2, 3, 4)

    async def fetch_quotes(self) -> List[dict]:
        """Fetch real-time quotes via yfinance batch API.
        yfinance doesn't have a batch quote endpoint, so we fetch in chunks
        of 20 symbols to avoid rate limits.
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
                            "name": sym,  # yfinance fast_info doesn't include name
                            "price": round(price, 2),
                            "change": chg,
                            "change_pct": chg_pct,
                            "volume": vol,
                            "market": "JSE",
                            "currency": "ZAR",
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
