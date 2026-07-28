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

CRYPTOQUANT_API_KEY = os.getenv("CRYPTOQUANT_API_KEY", "")
GLASSNODE_API_KEY = os.getenv("GLASSNODE_API_KEY", "")
ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY", "")
WHALE_ALERT_API_KEY = os.getenv("WHALE_ALERT_API_KEY", "")

# Public-ish endpoints
CRYPTOQUANT_BASE = "https://api.cryptoquant.com/v1"
GLASSNODE_BASE = "https://api.glassnode.com/v1"
DEFILLAMA_BASE = "https://api.llama.fi"
GITHUB_BASE = "https://api.github.com"
WHALE_ALERT_BASE = "https://api.whale-alert.io/v1"

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


# ── Exchange Net Flow ─────────────────────────────────────────────
async def fetch_exchange_netflow(symbol: str) -> Optional[dict]:
    """
    CryptoQuant exchange netflow (BTC/ETH only on free plan).
    Positive = inflow to exchanges (selling pressure).
    """
    base = _symbol_base(symbol)
    if not CRYPTOQUANT_API_KEY or base not in ("BTC", "ETH"):
        return _mock_netflow(base)

    url = f"{CRYPTOQUANT_BASE}/{base.lower()}/exchange-flows/netflow"
    try:
        data = await _http_get(url, headers={"X-API-KEY": CRYPTOQUANT_API_KEY}, params={"window": "day", "limit": "7"})
        values = data.get("result", {}).get("data", []) if isinstance(data, dict) else []
        if not values:
            return _mock_netflow(base)
        netflow_1d = float(values[-1].get("netflow", 0))
        netflow_7d = sum(float(v.get("netflow", 0)) for v in values[-7:])
        return {
            "symbol": base,
            "netflow_1d": round(netflow_1d, 2),
            "netflow_7d": round(netflow_7d, 2),
            "source": "cryptoquant",
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


# ── MVRV Ratio ───────────────────────────────────────────────────
async def fetch_mvrv(symbol: str) -> Optional[dict]:
    """
    Glassnode MVRV ratio (BTC/ETH).
    MVRV > 3.5 → overvalued; MVRV < 1.0 → undervalued historically.
    """
    base = _symbol_base(symbol)
    if not GLASSNODE_API_KEY or base not in ("BTC", "ETH"):
        return _mock_mvrv(base)

    asset_map = {"BTC": "btc", "ETH": "eth"}
    url = f"{GLASSNODE_BASE}/market/mvrv"
    try:
        data = await _http_get(url, params={"a": asset_map[base], "api_key": GLASSNODE_API_KEY, "i": "24h", "limit": 30})
        if not data or not isinstance(data, list):
            return _mock_mvrv(base)
        mvrv = float(data[-1].get("v", 0))
        mvrv_30d_avg = float(sum(d.get("v", 0) for d in data[-30:]) / len(data[-30:]))
        return {
            "symbol": base,
            "mvrv": round(mvrv, 3),
            "mvrv_30d_avg": round(mvrv_30d_avg, 3),
            "source": "glassnode",
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


# ── Stablecoin Flow ───────────────────────────────────────────────
async def fetch_stablecoin_flow(symbol: str) -> Optional[dict]:
    """
    CryptoQuant stablecoin exchange netflow (global indicator, symbol ignored).
    Positive = inflow to exchanges → potential buying pressure.
    """
    if not CRYPTOQUANT_API_KEY:
        return _mock_stablecoin_flow()

    # Generic stablecoin netflow endpoint; fallback to mock if shape differs
    url = f"{CRYPTOQUANT_BASE}/btc/stablecoin-exchange-flows/netflow"
    try:
        data = await _http_get(url, headers={"X-API-KEY": CRYPTOQUANT_API_KEY}, params={"window": "day", "limit": "7"})
        values = data.get("result", {}).get("data", []) if isinstance(data, dict) else []
        if not values:
            return _mock_stablecoin_flow()
        netflow_1d = float(values[-1].get("netflow", 0))
        netflow_7d = sum(float(v.get("netflow", 0)) for v in values[-7:])
        return {
            "symbol": "USDT/global",
            "netflow_1d": round(netflow_1d, 2),
            "netflow_7d": round(netflow_7d, 2),
            "source": "cryptoquant",
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


# ── NVT Ratio ────────────────────────────────────────────────────
async def fetch_nvt(symbol: str) -> Optional[dict]:
    """
    Network Value to Transactions ratio (BTC/ETH via CryptoQuant/Glassnode proxy).
    NVT > 150 → overvalued network; NVT < 30 → under-used / possible rebound.
    """
    base = _symbol_base(symbol)
    if not (CRYPTOQUANT_API_KEY or GLASSNODE_API_KEY) or base not in ("BTC", "ETH"):
        return _mock_nvt(base)

    # Try Glassnode NVT if key present, else CryptoQuant generic proxy
    try:
        if GLASSNODE_API_KEY:
            asset_map = {"BTC": "btc", "ETH": "eth"}
            data = await _http_get(
                f"{GLASSNODE_BASE}/indicators/nvt",
                params={"a": asset_map[base], "api_key": GLASSNODE_API_KEY, "i": "24h", "limit": 30},
            )
        else:
            data = await _http_get(
                f"{CRYPTOQUANT_BASE}/{base.lower()}/network-indicator/nvt",
                headers={"X-API-KEY": CRYPTOQUANT_API_KEY},
                params={"window": "day", "limit": "30"},
            )
            data = data.get("result", {}).get("data", []) if isinstance(data, dict) else []

        if not data or not isinstance(data, list):
            return _mock_nvt(base)
        nvt = float(data[-1].get("v", data[-1].get("nvt", 0)))
        nvt_avg = sum(float(d.get("v", d.get("nvt", 0))) for d in data[-30:]) / len(data[-30:])
        return {
            "symbol": base,
            "nvt": round(nvt, 2),
            "nvt_30d_avg": round(nvt_avg, 2),
            "source": "glassnode" if GLASSNODE_API_KEY else "cryptoquant",
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


async def fetch_smart_contract_activity(symbol: str) -> Optional[dict]:
    """
    Proxy for smart-contract activity.
    For chains where DefiLlama has data we use TVL change as a proxy.
    Etherscan active addresses could be added if ETHERSCAN_API_KEY is set.
    """
    base = _symbol_base(symbol)
    tvl = await fetch_defi_tvl(symbol)

    active_addresses = None
    if ETHERSCAN_API_KEY and base == "ETH":
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
        "tvl": tvl,
        "source": "defillama" if tvl else "mock",
    }


# ── Aggregate context & scoring ────────────────────────────────────
async def get_advanced_onchain_context(symbol: str) -> dict:
    """Fetch all advanced on-chain layers concurrently."""
    base = _symbol_base(symbol)
    netflow, mvrv, dev, contract, stable, nvt, whale = await asyncio.gather(
        fetch_exchange_netflow(symbol),
        fetch_mvrv(symbol),
        fetch_developer_activity(symbol),
        fetch_smart_contract_activity(symbol),
        fetch_stablecoin_flow(symbol),
        fetch_nvt(symbol),
        fetch_whale_alert(symbol),
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

    bonus = max(-25, min(25, bonus))
    return bonus, reasons, flags
