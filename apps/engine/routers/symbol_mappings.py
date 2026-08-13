"""
Symbol mappings and timeframe conversions for the trading engine.

All symbol-to-API mappings (Binance, TwelveData, yfinance, Deriv) and
timeframe conversion tables live here to avoid circular imports between
scan.py and scan_fetchers.py.
"""
import config
from utils.deriv_symbols import to_wire_symbol

# ── Binance ──
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

# ── Twelve Data (Forex, métaux, énergie) ──
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

# ── yfinance (fallback gratuit, sans clé API) ──
SYMBOL_TO_YFINANCE = {
    "EUR/USD":   "EURUSD=X",
    "GBP/USD":   "GBPUSD=X",
    "USD/JPY":   "JPY=X",
    "AUD/USD":   "AUDUSD=X",
    "USD/CHF":   "CHF=X",
    "USD/CAD":   "CAD=X",
    "NZD/USD":   "NZDUSD=X",
    "XAU/USD":   "GC=F",
    "XAG/USD":   "SI=F",
    "WTI/USD":   "CL=F",
    "BRENT/USD": "BZ=F",
    # US Stocks & Indices
    "AAPL/USD":  "AAPL",
    "TSLA/USD":  "TSLA",
    "MSFT/USD":  "MSFT",
    "NVDA/USD":  "NVDA",
    "AMZN/USD":  "AMZN",
    "META/USD":  "META",
    "GOOGL/USD": "GOOGL",
    "NFLX/USD":  "NFLX",
    "AMD/USD":   "AMD",
    "INTC/USD":  "INTC",
    "JPM/USD":   "JPM",
    "BAC/USD":   "BAC",
    "SP500/USD": "^GSPC",
    "NASDAQ/USD": "^IXIC",
    "DOW/USD":   "^DJI",
    "VIX/USD":   "^VIX",
}

US_STOCK_SYMBOLS = {
    "AAPL/USD", "TSLA/USD", "MSFT/USD", "NVDA/USD", "AMZN/USD",
    "META/USD", "GOOGL/USD", "NFLX/USD", "AMD/USD", "INTC/USD",
    "JPM/USD", "BAC/USD", "SP500/USD", "NASDAQ/USD", "DOW/USD", "VIX/USD",
}

# ── Deriv (indices synthétiques) ──
SYMBOL_TO_DERIV = {
    "V10":   "R_10",   "VIX10/USD":   "R_10",
    "V25":   "R_25",   "VIX25/USD":   "R_25",
    "V50":   "R_50",   "VIX50/USD":   "R_50",
    "V75":   "R_75",   "VIX75/USD":   "R_75",
    "V100":  "R_100",  "VIX100/USD":  "R_100",
    "BOOM300":   to_wire_symbol("BOOM300"), "BOOM300/USD":   to_wire_symbol("BOOM300"),
    "BOOM500":   "BOOM500",  "BOOM500/USD":   "BOOM500",
    "BOOM1000":  "BOOM1000", "BOOM1000/USD":  "BOOM1000",
    "CRASH300":  to_wire_symbol("CRASH300"),"CRASH300/USD":  to_wire_symbol("CRASH300"),
    "CRASH500":  "CRASH500", "CRASH500/USD":  "CRASH500",
    "CRASH1000": "CRASH1000","CRASH1000/USD": "CRASH1000",
    "JUMP10":  "JD10", "JUMP10/USD":  "JD10",
    "JUMP25":  "JD25", "JUMP25/USD":  "JD25",
    "JUMP50":  "JD50", "JUMP50/USD":  "JD50",
    "JUMP75":  "JD75", "JUMP75/USD":  "JD75",
    "JUMP100": "JD100","JUMP100/USD": "JD100",
}

# ── Timeframe conversions ──
TF_TO_YF: dict = {
    "1m": "1m",  "5m": "5m",  "15m": "15m",
    "1h": "1h",  "4h": "1h",   "1d": "1d",
}

TF_TO_YF_PERIOD: dict = {
    "1m": "7d", "5m": "60d", "15m": "60d",
    "1h": "730d", "4h": "730d", "1d": "5y",
}

TF_TO_TD: dict = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1h": "1h",   "4h": "4h",   "1d": "1day",
}

TF_TO_DERIV_GRANULARITY: dict = {
    "1m": 60, "5m": 300, "15m": 900,
    "1h": 3600, "4h": 14400, "1d": 86400,
}

TF_TO_MS: dict[str, int] = {
    "1m":    60_000,
    "5m":   300_000,
    "15m":  900_000,
    "1h":  3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

TF_MAP = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}

# ── API keys ──
TWELVE_DATA_API_KEY = config.settings.twelve_data_api_key
DERIV_API_TOKEN     = config.settings.deriv_api_token

# ── Asset type classification sets ──
FOREX_SYMBOLS = set(SYMBOL_TO_TWELVEDATA.keys()) | (set(SYMBOL_TO_YFINANCE.keys()) - US_STOCK_SYMBOLS)
COMMODITY_SYMBOLS = {"XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD"}
