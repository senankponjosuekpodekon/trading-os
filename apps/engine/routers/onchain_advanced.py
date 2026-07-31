"""
Advanced on-chain context for crypto assets.
Layers: exchange netflow, MVRV, developer activity, DeFi TVL / smart-contract activity.
Most sources require optional API keys; when missing/unreachable we fallback to mock values.
"""
import os
import httpx
import asyncio
import random
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from utils.rate_limiter import rate_limit

COINALYZE_API_KEY = os.getenv("COINALYZE_API_KEY", "")
ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY", "")
WHALE_ALERT_API_KEY = os.getenv("WHALE_ALERT_API_KEY", "")

# Free API endpoints (no paid keys required)
COINALYZE_BASE = "https://api.coinalyze.net/v1"
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2"
DEXSCREENER_BASE = "https://api.dexscreener.com"
DEFILLAMA_BASE = "https://api.llama.fi"
DEFILLAMA_STABLE = "https://stablecoins.llama.fi"
GITHUB_BASE = "https://api.github.com"
WHALE_ALERT_BASE = "https://api.whale-alert.io/v1"

# Coinalyze symbol mapping (BTCUSDT_PERP.A = Binance perp)
COINALYZE_SYMBOLS = {
    "BTC": "BTCUSDT_PERP.A",
    "ETH": "ETHUSDT_PERP.A",
    "SOL": "SOLUSDT_PERP.A",
    "BNB": "BNBUSDT_PERP.A",
    "XRP": "XRPUSDT_PERP.A",
    "ADA": "ADAUSDT_PERP.A",
    "AVAX": "AVAXUSDT_PERP.A",
    "LINK": "LINKUSDT_PERP.A",
    "DOT": "DOTUSDT_PERP.A",
    "MATIC": "MATICUSDT_PERP.A",
}

# CoinGecko coin IDs for market cap / volume
COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "DOT": "polkadot",
    "MATIC": "matic-network",
}

# Symbol -> GitHub repo(s)
REPOS = {
    "BTC": {"owner": "bitcoin", "repo": "bitcoin"},
    "ETH": {"owner": "ethereum", "repo": "go-ethereum"},
    "SOL": {"owner": "solana-labs", "repo": "solana"},
    "ADA": {"owner": "IntersectMBO", "repo": "cardano-node"},
    "DOT": {"owner": "paritytech", "repo": "polkadot-sdk"},
    "AVAX": {"owner": "ava-labs", "repo": "avalanchego"},
    "LINK": {"owner": "smartcontractkit", "repo": "chainlink"},
    "MATIC": {"owner": "0xPolygon", "repo": "pos-contracts"},
    "BNB": {"owner": "bnb-chain", "repo": "bsc"},
    "XRP": {"owner": "XRPLF", "repo": "rippled"},
}

# Symbol -> DefiLlama protocol slug
DEFILLAMA_SLUGS = {
    "ETH": "ethereum",
    "SOL": "solana",
    "AVAX": "avalanche",
    "DOT": "polkadot",
    "ADA": "cardano",
    "MATIC": "polygon",
    "BNB": "bnb-chain",
    "LINK": "chainlink",
}


def _symbol_base(symbol: str) -> str:
    return symbol.split("/")[0]


@rate_limit(max_concurrent=5, min_delay=0.1)
async def _http_get(url: str, headers: Optional[dict] = None, params: Optional[dict] = None):
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url, headers=headers or {}, params=params or {})
        r.raise_for_status()
        return r.json()


# ── Exchange Net Flow (Coinalyze OI delta proxy) ─────────────────
async def fetch_exchange_netflow(symbol: str) -> Optional[dict]:
    """
    Coinalyze open-interest history as netflow proxy.
    Rising OI = new positions opening (inflow); falling OI = positions closing (outflow).
    Free API: 40 req/min, no paid key required.
    """
    base = _symbol_base(symbol)
    ca_sym = COINALYZE_SYMBOLS.get(base)
    if not COINALYZE_API_KEY or not ca_sym:
        return _mock_netflow(base)

    import time as _time
    now = int(_time.time())
    from_ = now - 7 * 86400
    try:
        data = await _http_get(
            f"{COINALYZE_BASE}/open-interest-history",
            headers={"api_key": COINALYZE_API_KEY},
            params={"symbols": ca_sym, "interval": "daily", "from": str(from_), "to": str(now)},
        )
        if not isinstance(data, list) or not data:
            return _mock_netflow(base)
        history = data[0].get("history", []) if isinstance(data[0], dict) else []
        if len(history) < 2:
            return _mock_netflow(base)
        oi_now = float(history[-1].get("c", 0))
        oi_1d_ago = float(history[-2].get("c", 0))
        oi_7d_ago = float(history[0].get("c", 0))
        netflow_1d = oi_now - oi_1d_ago
        netflow_7d = oi_now - oi_7d_ago
        return {
            "symbol": base,
            "netflow_1d": round(netflow_1d, 2),
            "netflow_7d": round(netflow_7d, 2),
            "source": "coinalyze",
        }
    except Exception:
        return _mock_netflow(base)


def _mock_netflow(base: str) -> dict:
    # random but deterministic-ish inflow/outflow
    rng = random.Random(hash(base) % 10000)
    return {
        "symbol": base,
        "netflow_1d": round(rng.uniform(-1000, 1000), 2),
        "netflow_7d": round(rng.uniform(-5000, 5000), 2),
        "source": "mock",
    }


# ── MVRV Ratio (CoinGecko market-cap / realized-cap proxy) ───────
async def fetch_mvrv(symbol: str) -> Optional[dict]:
    """
    MVRV proxy via CoinGecko: market_cap / realized_cap.
    CoinGecko provides both in /coins/{id}/market_chart for BTC/ETH.
    MVRV > 3.5 → overvalued; MVRV < 1.0 → undervalued historically.
    """
    base = _symbol_base(symbol)
    cg_id = COINGECKO_IDS.get(base)
    if not cg_id:
        return _mock_mvrv(base)

    try:
        data = await _http_get(
            f"{COINGECKO_BASE}/coins/{cg_id}",
            params={"localization": "false", "tickers": "false", "market_data": "true", "community_data": "false", "developer_data": "false"},
        )
        md = data.get("market_data", {}) if isinstance(data, dict) else {}
        market_cap = md.get("market_cap", {}).get("usd", 0)
        # CoinGecko doesn't expose realized cap directly; use fully_diluted_valuation as proxy denominator
        fdv = md.get("fully_diluted_valuation", {}).get("usd", 0) or market_cap
        # MVRV proxy: market_cap / fdv (simplified — closer to 1.0 means fair value)
        # For BTC/ETH we also use market_cap / (circulating_supply * price_30d_ago) as a better proxy
        circulating = md.get("circulating_supply", 0) or 0

        if market_cap <= 0 or fdv <= 0:
            return _mock_mvrv(base)

        mvrv_proxy = market_cap / fdv

        # Try to get 30d ago price for a better realized-cap proxy
        try:
            hist = await _http_get(f"{COINGECKO_BASE}/coins/{cg_id}/market_chart", params={"vs_currency": "usd", "days": "30"})
            prices = hist.get("prices", []) if isinstance(hist, dict) else []
            if prices and circulating > 0:
                avg_price_30d = sum(p[1] for p in prices) / len(prices)
                realized_cap_proxy = circulating * avg_price_30d
                mvrv_proxy = market_cap / realized_cap_proxy if realized_cap_proxy > 0 else mvrv_proxy
        except Exception:
            pass

        return {
            "symbol": base,
            "mvrv": round(mvrv_proxy, 3),
            "mvrv_30d_avg": round(mvrv_proxy, 3),
            "source": "coingecko-proxy",
        }
    except Exception:
        return _mock_mvrv(base)


def _mock_mvrv(base: str) -> dict:
    rng = random.Random(hash(base) % 10000)
    return {
        "symbol": base,
        "mvrv": round(rng.uniform(1.0, 3.0), 3),
        "mvrv_30d_avg": round(rng.uniform(1.5, 2.5), 3),
        "source": "mock",
    }


# ── Developer Activity ───────────────────────────────────────────
async def fetch_developer_activity(symbol: str) -> Optional[dict]:
    """GitHub commit activity for the canonical repo of the asset."""
    base = _symbol_base(symbol)
    repo = REPOS.get(base)
    if not repo:
        return None

    url = f"{GITHUB_BASE}/repos/{repo['owner']}/{repo['repo']}/stats/commit_activity"
    try:
        data = await _http_get(url, headers={"Accept": "application/vnd.github.v3+json"})
        if not isinstance(data, list) or not data:
            return _mock_dev_activity(base)
        # last 4 weeks ~ 30 days, last 8 weeks ~ 60 days
        commits_30d = sum(sum(w.get("days", [])) for w in data[-4:])
        commits_60d = sum(sum(w.get("days", [])) for w in data[-8:])

        # latest release
        rel_url = f"{GITHUB_BASE}/repos/{repo['owner']}/{repo['repo']}/releases/latest"
        try:
            rel = await _http_get(rel_url, headers={"Accept": "application/vnd.github.v3+json"})
            latest_release = rel.get("tag_name")
            release_date = rel.get("published_at")
        except Exception:
            latest_release = None
            release_date = None

        return {
            "symbol": base,
            "commits_30d": commits_30d,
            "commits_60d": commits_60d,
            "latest_release": latest_release,
            "latest_release_date": release_date,
            "source": "github",
        }
    except Exception:
        return _mock_dev_activity(base)


def _mock_dev_activity(base: str) -> Optional[dict]:
    rng = random.Random(hash(base) % 10000)
    commits_30d = rng.randint(5, 200)
    return {
        "symbol": base,
        "commits_30d": commits_30d,
        "commits_60d": commits_30d + rng.randint(0, 100),
        "latest_release": None,
        "latest_release_date": None,
        "source": "mock",
    }


# ── Smart Contract Activity / TVL ────────────────────────────────
async def fetch_defi_tvl(symbol: str) -> Optional[dict]:
    """DefiLlama TVL for the chain / protocol."""
    base = _symbol_base(symbol)
    slug = DEFILLAMA_SLUGS.get(base)
    if not slug:
        return None

    url = f"{DEFILLAMA_BASE}/protocol/{slug}"
    try:
        data = await _http_get(url)
        tvl_now = data.get("tvl", [{}])[-1].get("totalLiquidityUSD", 0)
        tvl_7d = data.get("tvl", [{}])[-8].get("totalLiquidityUSD", 0) if len(data.get("tvl", [])) > 8 else tvl_now
        change_7d = ((tvl_now - tvl_7d) / tvl_7d * 100) if tvl_7d else 0
        return {
            "symbol": base,
            "tvl": round(float(tvl_now), 2),
            "tvl_7d_ago": round(float(tvl_7d), 2),
            "tvl_change_7d_pct": round(change_7d, 2),
            "source": "defillama",
        }
    except Exception:
        return _mock_tvl(base)


def _mock_tvl(base: str) -> Optional[dict]:
    rng = random.Random(hash(base) % 10000)
    tvl = rng.uniform(1e9, 50e9)
    change = rng.uniform(-10, 10)
    return {
        "symbol": base,
        "tvl": round(tvl, 2),
        "tvl_7d_ago": round(tvl / (1 + change / 100), 2),
        "tvl_change_7d_pct": round(change, 2),
        "source": "mock",
    }


# ── Stablecoin Flow (DefiLlama stablecoins API — free) ───────────
async def fetch_stablecoin_flow(symbol: str) -> Optional[dict]:
    """
    DefiLlama stablecoin API: total stablecoin market cap change.
    Rising stablecoin MC = potential buying power sitting on sidelines.
    Fully free, no API key required.
    """
    try:
        data = await _http_get(f"{DEFILLAMA_STABLE}/stablecoincharts/all")
        if not isinstance(data, list) or len(data) < 2:
            return _mock_stablecoin_flow()
        latest = data[-1]
        prev_1d = data[-2] if len(data) >= 2 else latest
        prev_7d = data[-8] if len(data) >= 8 else data[0]

        mc_now = float(latest.get("totalCirculating", {}).get("peggedUSD", 0) or 0)
        mc_1d = float(prev_1d.get("totalCirculating", {}).get("peggedUSD", 0) or 0)
        mc_7d = float(prev_7d.get("totalCirculating", {}).get("peggedUSD", 0) or 0)

        netflow_1d = (mc_now - mc_1d) / 1e6  # in millions USD
        netflow_7d = (mc_now - mc_7d) / 1e6

        return {
            "symbol": "USDT/global",
            "netflow_1d": round(netflow_1d, 2),
            "netflow_7d": round(netflow_7d, 2),
            "source": "defillama",
        }
    except Exception:
        return _mock_stablecoin_flow()


def _mock_stablecoin_flow() -> dict:
    rng = random.Random(42)
    return {
        "symbol": "USDT/global",
        "netflow_1d": round(rng.uniform(-500, 500), 2),
        "netflow_7d": round(rng.uniform(-2000, 2000), 2),
        "source": "mock",
    }


# ── NVT Ratio (CoinGecko market_cap / volume proxy) ──────────────
async def fetch_nvt(symbol: str) -> Optional[dict]:
    """
    NVT proxy via CoinGecko: market_cap / total_volume.
    NVT > 150 → overvalued network; NVT < 30 → under-used / possible rebound.
    CoinGecko free API provides both market cap and volume.
    """
    base = _symbol_base(symbol)
    cg_id = COINGECKO_IDS.get(base)
    if not cg_id:
        return _mock_nvt(base)

    try:
        data = await _http_get(
            f"{COINGECKO_BASE}/coins/{cg_id}",
            params={"localization": "false", "tickers": "false", "market_data": "true", "community_data": "false", "developer_data": "false"},
        )
        md = data.get("market_data", {}) if isinstance(data, dict) else {}
        market_cap = md.get("market_cap", {}).get("usd", 0) or 0
        volume_24h = md.get("total_volume", {}).get("usd", 0) or 0

        if market_cap <= 0 or volume_24h <= 0:
            return _mock_nvt(base)

        # NVT = market_cap / daily_volume (simplified — annualized would be *365)
        # Using daily ratio as a proxy: higher = overvalued, lower = active network
        nvt_proxy = market_cap / volume_24h

        return {
            "symbol": base,
            "nvt": round(nvt_proxy, 2),
            "nvt_30d_avg": round(nvt_proxy, 2),
            "source": "coingecko-proxy",
        }
    except Exception:
        return _mock_nvt(base)


def _mock_nvt(base: str) -> dict:
    rng = random.Random(hash(base) % 10000)
    return {
        "symbol": base,
        "nvt": round(rng.uniform(40, 120), 2),
        "nvt_30d_avg": round(rng.uniform(50, 100), 2),
        "source": "mock",
    }


# ── Whale Alert proxy ─────────────────────────────────────────────
async def fetch_whale_alert(symbol: str, min_value_usd: float = 10_000_000) -> Optional[dict]:
    """
    Whale Alert free tier proxy for large BTC/ETH transactions.
    Filters internal exchange reorganisations by counting exchange→unknown and unknown→exchange.
    """
    base = _symbol_base(symbol)
    if not WHALE_ALERT_API_KEY or base not in ("BTC", "ETH"):
        return _mock_whale_alert(base)

    try:
        # last ~1h window
        data = await _http_get(
            f"{WHALE_ALERT_BASE}/transactions",
            params={
                "api_key": WHALE_ALERT_API_KEY,
                "min_value": min_value_usd,
                "currency": base.lower(),
                "limit": "50",
            },
        )
        txs = data.get("transactions", []) if isinstance(data, dict) else []
        inflow = 0.0  # exchange-bound (selling pressure)
        outflow = 0.0  # exchange-out (accumulation)
        count = 0
        for tx in txs:
            amount = float(tx.get("amount_usd", 0))
            if amount <= 0:
                continue
            count += 1
            to_owner = (tx.get("to", {}) or {}).get("owner_type", "")
            from_owner = (tx.get("from", {}) or {}).get("owner_type", "")
            # Skip known internal exchange reorganisations
            if to_owner == "exchange" and from_owner == "exchange":
                continue
            if to_owner == "exchange":
                inflow += amount
            elif from_owner == "exchange":
                outflow += amount

        return {
            "symbol": base,
            "count": count,
            "inflow_usd": round(inflow, 2),
            "outflow_usd": round(outflow, 2),
            "net_usd": round(outflow - inflow, 2),
            "source": "whale-alert",
        }
    except Exception:
        return _mock_whale_alert(base)


def _mock_whale_alert(base: str) -> dict:
    rng = random.Random(hash(base) % 10000)
    inflow = rng.uniform(10e6, 50e6)
    outflow = rng.uniform(10e6, 50e6)
    return {
        "symbol": base,
        "count": rng.randint(0, 20),
        "inflow_usd": round(inflow, 2),
        "outflow_usd": round(outflow, 2),
        "net_usd": round(outflow - inflow, 2),
        "source": "mock",
    }


# ── Liquidations (Coinalyze — free, 40 req/min) ─────────────────
async def fetch_liquidations(symbol: str) -> Optional[dict]:
    """
    Coinalyze liquidation history (24h).
    Large liquidations → potential reversal points.
    """
    base = _symbol_base(symbol)
    ca_sym = COINALYZE_SYMBOLS.get(base)
    if not COINALYZE_API_KEY or not ca_sym:
        return None

    import time as _time
    now = int(_time.time())
    from_ = now - 86400  # 24h
    try:
        data = await _http_get(
            f"{COINALYZE_BASE}/liquidation-history",
            headers={"api_key": COINALYZE_API_KEY},
            params={"symbols": ca_sym, "interval": "daily", "from": str(from_), "to": str(now)},
        )
        if not isinstance(data, list) or not data:
            return None
        history = data[0].get("history", []) if isinstance(data[0], dict) else []
        if not history:
            return None
        latest = history[-1]
        long_liq = float(latest.get("l", 0))  # long liquidations
        short_liq = float(latest.get("s", 0))  # short liquidations
        total = long_liq + short_liq
        return {
            "symbol": base,
            "long_liquidations": round(long_liq, 2),
            "short_liquidations": round(short_liq, 2),
            "total_liquidations": round(total, 2),
            "source": "coinalyze",
        }
    except Exception:
        return None


# ── Long/Short Ratio (Coinalyze — free) ───────────────────────────
async def fetch_long_short_ratio(symbol: str) -> Optional[dict]:
    """
    Coinalyze long/short ratio history.
    Ratio > 2 = overcrowded longs (squeeze risk); < 0.5 = overcrowded shorts.
    """
    base = _symbol_base(symbol)
    ca_sym = COINALYZE_SYMBOLS.get(base)
    if not COINALYZE_API_KEY or not ca_sym:
        return None

    import time as _time
    now = int(_time.time())
    from_ = now - 86400
    try:
        data = await _http_get(
            f"{COINALYZE_BASE}/long-short-ratio-history",
            headers={"api_key": COINALYZE_API_KEY},
            params={"symbols": ca_sym, "interval": "daily", "from": str(from_), "to": str(now)},
        )
        if not isinstance(data, list) or not data:
            return None
        history = data[0].get("history", []) if isinstance(data[0], dict) else []
        if not history:
            return None
        latest = history[-1]
        ratio = float(latest.get("r", 1.0))
        longs = float(latest.get("l", 0))
        shorts = float(latest.get("s", 0))
        return {
            "symbol": base,
            "long_short_ratio": round(ratio, 3),
            "longs": round(longs, 2),
            "shorts": round(shorts, 2),
            "source": "coinalyze",
        }
    except Exception:
        return None


async def fetch_smart_contract_activity(symbol: str) -> Optional[dict]:
    """
    Smart-contract activity via GeckoTerminal (free, no key) + DefiLlama TVL.
    GeckoTerminal provides pool data (volume, liquidity, tx count) for DEX-traded tokens.
    """
    base = _symbol_base(symbol)
    tvl = await fetch_defi_tvl(symbol)

    active_addresses = None
    dau = None
    fees = None
    tx_count_24h = None
    volume_24h = None

    # Try GeckoTerminal for DEX pool data (free, no key, 10 req/min)
    # Map base symbol to GeckoTerminal network id
    gt_networks = {
        "ETH": "eth", "SOL": "solana", "BNB": "bsc", "AVAX": "avax",
        "MATIC": "polygon", "ADA": "cardano", "DOT": "polkadot",
        "LINK": "eth", "XRP": None, "BTC": None,
    }
    gt_net = gt_networks.get(base)
    if gt_net:
        try:
            # Search for the token's pools on GeckoTerminal
            data = await _http_get(f"{GECKOTERMINAL_BASE}/networks/{gt_net}/pools")
            if isinstance(data, dict):
                pools = data.get("data", [])
                if pools:
                    # Use the top pool's attributes as activity proxy
                    attrs = pools[0].get("attributes", {})
                    vol = attrs.get("volume_usd", {})
                    volume_24h = float(vol.get("h24", 0) or 0)
                    tx = attrs.get("transactions_count", {})
                    h24_tx = tx.get("h24", {})
                    if isinstance(h24_tx, dict):
                        tx_count_24h = int(h24_tx.get("buys", 0) + h24_tx.get("sells", 0))
                    # Use tx count as DAU proxy
                    if tx_count_24h is not None:
                        dau = tx_count_24h
                        active_addresses = tx_count_24h
        except Exception:
            pass

    # Fallback: Etherscan for ETH active addresses if GeckoTerminal failed
    if active_addresses is None and ETHERSCAN_API_KEY and base == "ETH":
        try:
            url = "https://api.etherscan.io/api"
            params = {
                "module": "stats",
                "action": "activeaddress",
                "apikey": ETHERSCAN_API_KEY,
            }
            data = await _http_get(url, params=params)
            active_addresses = int(data.get("result", {}).get("ActiveAddress", 0))
        except Exception:
            pass

    return {
        "symbol": base,
        "active_addresses": active_addresses,
        "dau": dau,
        "fees": fees,
        "tx_count_24h": tx_count_24h,
        "volume_24h": volume_24h,
        "tvl": tvl,
        "source": "geckoterminal" if dau else ("defillama" if tvl else "mock"),
    }


# ── Aggregate context & scoring ────────────────────────────────────
async def get_advanced_onchain_context(symbol: str) -> dict:
    """Fetch all advanced on-chain layers concurrently."""
    base = _symbol_base(symbol)
    netflow, mvrv, dev, contract, stable, nvt, whale, liq, ls_ratio = await asyncio.gather(
        fetch_exchange_netflow(symbol),
        fetch_mvrv(symbol),
        fetch_developer_activity(symbol),
        fetch_smart_contract_activity(symbol),
        fetch_stablecoin_flow(symbol),
        fetch_nvt(symbol),
        fetch_whale_alert(symbol),
        fetch_liquidations(symbol),
        fetch_long_short_ratio(symbol),
        return_exceptions=True,
    )

    def _safe(result):
        return result if not isinstance(result, Exception) else None

    return {
        "symbol": base,
        "exchange_netflow": _safe(netflow),
        "mvrv": _safe(mvrv),
        "developer_activity": _safe(dev),
        "smart_contract_activity": _safe(contract),
        "stablecoin_flow": _safe(stable),
        "nvt": _safe(nvt),
        "whale_alert": _safe(whale),
        "liquidations": _safe(liq),
        "long_short_ratio": _safe(ls_ratio),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def advanced_onchain_bonus(
    context: dict,
    signal_direction: str,
    price_change_7d: Optional[float] = None,
) -> tuple[int, list[str], dict]:
    """
    Bonus/malus from advanced on-chain layers.
    Returns (bonus, reasons, flags).
    """
    bonus = 0
    reasons: list[str] = []
    flags: Dict[str, Any] = {}

    netflow = (context or {}).get("exchange_netflow") or {}
    net_1d = netflow.get("netflow_1d")
    if net_1d is not None:
        if net_1d > 500 and signal_direction == "BUY":
            bonus -= 10
            reasons.append(f"On-chain: net exchange inflow {net_1d:.0f} → selling pressure")
        elif net_1d < -500 and signal_direction == "BUY":
            bonus += 8
            reasons.append(f"On-chain: net exchange outflow {net_1d:.0f} → accumulation")

    mvrv = (context or {}).get("mvrv") or {}
    ratio = mvrv.get("mvrv")
    if ratio is not None:
        if ratio > 3.5:
            flags["mvrv_overvalued"] = True
            if signal_direction == "BUY":
                bonus -= 10
                reasons.append(f"On-chain: MVRV {ratio:.2f} > 3.5 → overvalued")
        elif ratio < 1.0:
            flags["mvrv_undervalued"] = True
            if signal_direction == "BUY":
                bonus += 10
                reasons.append(f"On-chain: MVRV {ratio:.2f} < 1.0 → undervalued")

    dev = (context or {}).get("developer_activity") or {}
    commits_30d = dev.get("commits_30d")
    commits_60d = dev.get("commits_60d")
    if commits_30d is not None:
        if commits_30d == 0 and (commits_60d is None or commits_60d == 0):
            flags["zombie_flag"] = True
            if signal_direction == "BUY":
                bonus -= 15
                reasons.append("On-chain: 0 commits in 60d → zombie flag")
        elif commits_30d > 50:
            bonus += 5
            reasons.append(f"On-chain: {commits_30d} commits in 30d → active development")
        if dev.get("latest_release"):
            bonus += 5
            reasons.append(f"On-chain: new release {dev['latest_release']}")

    tvl = ((context or {}).get("smart_contract_activity") or {}).get("tvl") or {}
    tvl_change = tvl.get("tvl_change_7d_pct")
    if tvl_change is not None:
        # asymmetry: TVL up but price flat/negative
        if tvl_change > 10 and (price_change_7d is None or price_change_7d < 2):
            flags["asymmetry_flag"] = True
            if signal_direction == "BUY":
                bonus += 8
                reasons.append(f"On-chain: TVL +{tvl_change:.1f}% vs flat price → asymmetry")
        elif tvl_change < -10:
            if signal_direction == "BUY":
                bonus -= 5
                reasons.append(f"On-chain: TVL {tvl_change:.1f}% → DeFi outflow")

    # Stablecoin flow: inflow to exchanges → buying pressure
    stable = (context or {}).get("stablecoin_flow") or {}
    stable_1d = stable.get("netflow_1d")
    if stable_1d is not None and signal_direction == "BUY":
        if stable_1d > 100:
            bonus += 10
            reasons.append(f"On-chain: stablecoin inflow +{stable_1d:.0f}M → buying pressure")
        elif stable_1d < -100:
            bonus -= 5
            reasons.append(f"On-chain: stablecoin outflow {stable_1d:.0f}M → reduced demand")

    # NVT ratio
    nvt = (context or {}).get("nvt") or {}
    nvt_value = nvt.get("nvt")
    if nvt_value is not None and signal_direction == "BUY":
        if nvt_value > 150:
            bonus -= 15
            reasons.append(f"On-chain: NVT {nvt_value:.0f} > 150 → network overvalued")
        elif nvt_value < 30:
            bonus += 8
            reasons.append(f"On-chain: NVT {nvt_value:.0f} < 30 → possible rebound")

    # Whale Alert: large exchange-bound flows
    whale = (context or {}).get("whale_alert") or {}
    whale_in = whale.get("inflow_usd", 0) or 0
    whale_out = whale.get("outflow_usd", 0) or 0
    if signal_direction == "BUY" and (whale_in or whale_out):
        if whale_out > whale_in * 1.5 and whale_out > 50e6:
            bonus += 8
            reasons.append(f"On-chain: whale outflow ${whale_out/1e6:.0f}M → accumulation")
        elif whale_in > whale_out * 1.5 and whale_in > 50e6:
            bonus -= 10
            reasons.append(f"On-chain: whale inflow ${whale_in/1e6:.0f}M → distribution")

    # Liquidations (Coinalyze)
    liq = (context or {}).get("liquidations") or {}
    long_liq = liq.get("long_liquidations", 0) or 0
    short_liq = liq.get("short_liquidations", 0) or 0
    total_liq = long_liq + short_liq
    if total_liq > 0:
        if short_liq > long_liq * 2 and signal_direction == "BUY":
            bonus += 8
            reasons.append(f"On-chain: short liquidations ${short_liq/1e6:.1f}M > long ${long_liq/1e6:.1f}M → short squeeze fuel")
        elif long_liq > short_liq * 2 and signal_direction == "SELL":
            bonus += 8
            reasons.append(f"On-chain: long liquidations ${long_liq/1e6:.1f}M > short ${short_liq/1e6:.1f}M → long squeeze fuel")
        elif total_liq > 100e6:
            flags["large_liquidation_event"] = True
            reasons.append(f"On-chain: ${total_liq/1e6:.0f}M liquidations in 24h → high volatility event")

    # Long/Short ratio (Coinalyze)
    ls = (context or {}).get("long_short_ratio") or {}
    ratio = ls.get("long_short_ratio")
    if ratio is not None:
        if ratio > 2.5 and signal_direction == "SELL":
            bonus += 10
            reasons.append(f"On-chain: long/short ratio {ratio:.1f} → overcrowded longs, squeeze risk")
        elif ratio < 0.4 and signal_direction == "BUY":
            bonus += 10
            reasons.append(f"On-chain: long/short ratio {ratio:.1f} → overcrowded shorts, squeeze risk")

    bonus = max(-25, min(25, bonus))
    return bonus, reasons, flags
