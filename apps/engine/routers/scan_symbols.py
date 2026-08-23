"""Symbol lists and related constants used by the scanner."""

# Actifs Binance prioritaires → scan rapide (Binance = gratuit, sans limite)
BINANCE_PRIORITY_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT",
    "XRP/USDT",  # 5 symbols (was 10) to reduce CPU load
]

# Actifs Deriv (synthétiques) → scan medium (2 min)
DERIV_SYMBOLS = [
    "V75", "V25", "V10", "V50", "V100",
    "BOOM1000", "CRASH1000",  # 7 symbols (was 13) to reduce CPU load
]

# Actifs BRVM → scan pendant heures de marché uniquement
BRVM_SYMBOLS = [
    "ONTBF", "SGBF", "BOABF", "ETIT", "SIVC",
    "PALC", "SOGC", "SNTS", "CIEC", "NSIC",
    "ORGT", "BICC", "CBIBF", "ABJC", "STAC",
]

# Actifs Forex/Commodités → scan lent (5 min)
FOREX_COMMODITY_SYMBOLS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
    "XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD",
]

# Actifs précalculés en background
ACTIVE_SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "AVAX/USDT",
    "ADA/USDT", "XRP/USDT", "LINK/USDT", "DOT/USDT", "MATIC/USDT",
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
    "XAU/USD", "XAG/USD", "WTI/USD", "BRENT/USD",
    "V75", "V25", "V10",
    "BOOM1000", "CRASH1000",
]
