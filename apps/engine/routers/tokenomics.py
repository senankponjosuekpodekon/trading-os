"""
Tokenomics pre-signal analysis.
Detects dangerous unlock schedules and concentration risk.
External APIs are optional; when missing/unreachable we fallback to a mock table.
"""
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException

from utils.rate_limiter import rate_limit
from utils.http import retry_async

router = APIRouter()

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
TOKENUNLOCKS_BASE = "https://api.token.unlocks.app"

COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "ADA": "cardano",
    "DOT": "polkadot",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "MATIC": "matic-network",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "UNI": "uniswap",
    "AAVE": "aave",
    "LDO": "lido-dao",
    "ARB": "arbitrum",
    "OP": "optimism",
    "SUI": "sui",
    "APT": "aptos",
    "NEAR": "near",
    "FTM": "fantom",
    "ALGO": "algorand",
    "FLOW": "flow",
    "AXS": "axie-infinity",
    "SAND": "the-sandbox",
    "MANA": "decentraland",
}

# Mock tokenomics data for demo / API-fail fallback
_TOKENOMICS_MOCK = {
    "BTC": {"next_unlock_pct": 0.0, "next_unlock_date": None, "top10_holders_pct": 5.5},
    "ETH": {"next_unlock_pct": 0.0, "next_unlock_date": None, "top10_holders_pct": 28.0},
    "SOL": {"next_unlock_pct": 4.5, "next_unlock_date": "2026-08-01", "top10_holders_pct": 35.0},
    "ADA": {"next_unlock_pct": 2.1, "next_unlock_date": "2026-07-25", "top10_holders_pct": 42.0},
    "DOT": {"next_unlock_pct": 8.0, "next_unlock_date": "2026-07-20", "top10_holders_pct": 60.0},
    "AVAX": {"next_unlock_pct": 12.0, "next_unlock_date": "2026-07-28", "top10_holders_pct": 55.0},
    "LINK": {"next_unlock_pct": 1.2, "next_unlock_date": "2026-08-05", "top10_holders_pct": 48.0},
    "MATIC": {"next_unlock_pct": 22.0, "next_unlock_date": "2026-07-22", "top10_holders_pct": 78.0},
    "BNB": {"next_unlock_pct": 0.0, "next_unlock_date": None, "top10_holders_pct": 45.0},
    "XRP": {"next_unlock_pct": 1.5, "next_unlock_date": "2026-08-10", "top10_holders_pct": 65.0},
    "DOGE": {"next_unlock_pct": 0.0, "next_unlock_date": None, "top10_holders_pct": 52.0},
    "UNI": {"next_unlock_pct": 16.0, "next_unlock_date": "2026-07-30", "top10_holders_pct": 58.0},
    "AAVE": {"next_unlock_pct": 3.0, "next_unlock_date": "2026-09-01", "top10_holders_pct": 48.0},
    "LDO": {"next_unlock_pct": 25.0, "next_unlock_date": "2026-07-18", "top10_holders_pct": 72.0},
    "ARB": {"next_unlock_pct": 11.0, "next_unlock_date": "2026-08-12", "top10_holders_pct": 66.0},
    "OP": {"next_unlock_pct": 9.5, "next_unlock_date": "2026-08-02", "top10_holders_pct": 62.0},
}


def _symbol_base(symbol: str) -> str:
    return symbol.split("/")[0]


@rate_limit(max_concurrent=5, min_delay=0.1)
async def _http_get(url: str, params: Optional[dict] = None, source: str = "coingecko"):
    async def _do():
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params or {})
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, max_retries=1, base_delay=0.5, source=source)


async def _fetch_coingecko_coin(base: str) -> Optional[dict]:
    coin_id = COINGECKO_IDS.get(base)
    if not coin_id:
        return None
    try:
        return await _http_get(f"{COINGECKO_BASE}/coins/{coin_id}")
    except Exception:
        return None


async def _fetch_token_unlocks(base: str) -> List[dict]:
    """Try TokenUnlocks-like endpoint; fallback to empty list."""
    try:
        data = await _http_get(f"{TOKENUNLOCKS_BASE}/api/coins/{base.lower()}/unlocks")
        if isinstance(data, list):
            return data
        return data.get("data", []) or []
    except Exception:
        return []


def _parse_unlock_pct(unlocks: List[dict]) -> tuple[Optional[float], Optional[datetime]]:
    """Sum unlocks scheduled in the next 30 days and return pct + nearest date."""
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=30)
    total = 0.0
    nearest = None
    for u in unlocks:
        try:
            dt = datetime.fromisoformat(str(u.get("date", "")).replace("Z", "+00:00"))
        except Exception:
            continue
        if now <= dt <= horizon:
            pct = float(u.get("unlock_percent", 0) or 0)
            total += pct
            if nearest is None or dt < nearest:
                nearest = dt
    if total == 0:
        return 0.0, None
    return total, nearest


def _mock_tokenomics(base: str) -> dict:
    data = _TOKENOMICS_MOCK.get(base, {
        "next_unlock_pct": 0.0,
        "next_unlock_date": None,
        "top10_holders_pct": 50.0,
    })
    return {
        "symbol": base,
        "next_unlock_pct": data["next_unlock_pct"],
        "next_unlock_date": data["next_unlock_date"],
        "top10_holders_pct": data["top10_holders_pct"],
        "source": "mock",
    }


async def fetch_tokenomics(symbol: str) -> dict:
    """Fetch tokenomics data for a symbol; fallback to mock table if APIs fail."""
    base = _symbol_base(symbol)

    # Token unlocks attempt
    unlocks = await _fetch_token_unlocks(base)
    next_unlock_pct, next_unlock_date = _parse_unlock_pct(unlocks)

    # CoinGecko coin page for extra metadata; if fails we keep whatever we have
    cg_data = await _fetch_coingecko_coin(base)

    # Holder concentration: we don't have a free public source for most assets;
    # use mock fallback when not available.
    top10 = None
    if cg_data and isinstance(cg_data, dict):
        # Some coins expose supply metrics; not holders.
        top10 = None

    if next_unlock_pct is None and top10 is None:
        return _mock_tokenomics(base)

    return {
        "symbol": base,
        "next_unlock_pct": round(next_unlock_pct or 0.0, 3),
        "next_unlock_date": next_unlock_date.isoformat() if next_unlock_date else None,
        "top10_holders_pct": round(top10 or _TOKENOMICS_MOCK.get(base, {}).get("top10_holders_pct", 50.0), 2),
        "source": "api" if unlocks else "mock",
    }


@router.get("/{symbol}")
async def tokenomics_endpoint(symbol: str):
    """Endpoint: GET /tokenomics/{symbol} → unlock calendar + concentration score."""
    try:
        data = await fetch_tokenomics(symbol)
        return data
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Tokenomics unavailable: {e}") from e


def tokenomics_penalty(tokenomics: dict, signal: str) -> tuple[int, list[str], dict]:
    """
    Returns (confidence_penalty, reasons, flags).
    - upcoming unlock >20% in 30d → danger_flag, confidence should be zeroed by caller
    - top10 holders >80% → concentration flag
    """
    penalty = 0
    reasons = []
    flags = {}

    next_pct = tokenomics.get("next_unlock_pct", 0) or 0
    if next_pct > 20:
        flags["danger_flag"] = True
        reasons.append(f"Tokenomics: unlock {next_pct:.1f}% supply <30j → danger")

    top10 = tokenomics.get("top10_holders_pct", 0) or 0
    if top10 > 80:
        flags["concentration_flag"] = True
        penalty += 20
        reasons.append(f"Tokenomics: top10 holders {top10:.1f}% → concentration risk")
    elif top10 > 60:
        penalty += 10
        reasons.append(f"Tokenomics: top10 holders {top10:.1f}% → moderate concentration")

    return penalty, reasons, flags
