"""Asset type classification for the scanner."""
from routers.synthetic_engine import SYMBOL_TO_DERIV as SYNTHETIC_SYMBOLS
from routers.symbol_mappings import SYMBOL_TO_BINANCE, US_STOCK_SYMBOLS, FOREX_SYMBOLS, COMMODITY_SYMBOLS
from routers.brvm import is_brvm_symbol


def get_asset_type(symbol: str) -> str:
    """Classify an internal symbol into CRYPTO | FOREX | SYNTHETIC | BRVM | COMMODITY | US_STOCK | UNKNOWN."""
    if symbol in SYMBOL_TO_BINANCE or symbol.endswith("/USDT"):
        return "CRYPTO"
    if symbol in SYNTHETIC_SYMBOLS:
        return "SYNTHETIC"
    if symbol in US_STOCK_SYMBOLS:
        return "US_STOCK"
    if is_brvm_symbol(symbol):
        return "BRVM"
    if symbol in COMMODITY_SYMBOLS:
        return "COMMODITY"
    if symbol in FOREX_SYMBOLS or ("/" in symbol and len(symbol.split("/")) == 2):
        return "FOREX"
    return "UNKNOWN"
