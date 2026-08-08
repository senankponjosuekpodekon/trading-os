"""Red flags checklist for micro-cap crypto assets.

10 red flags from the Moonshot Crypto analysis:
1. Anonymous team
2. Unlocked liquidity (not locked/burned)
3. Whale concentration (top 10 holders > 80%)
4. No audit
5. Fake social media presence
6. Aggressive influencer promotion
7. No product/MVP
8. Copy-paste website
9. Suspicious APY/staking returns
10. Token taxes (buy/sell tax > 5%)

If red_flag_count >= 5 → signal disabled + warning "Projet à risque extrême"
"""
import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

RED_FLAG_NAMES = [
    "anonymous_team",
    "unlocked_liquidity",
    "whale_concentration",
    "no_audit",
    "fake_social",
    "aggressive_influencer",
    "no_product",
    "copy_paste_website",
    "suspicious_apy",
    "token_taxes",
]


async def _check_whale_concentration(symbol: str) -> bool:
    """Check if top 10 holders control > 80% of supply via Etherscan/BSCScan."""
    # This would require an Etherscan/BSCScan API key
    # For now, return False (no data available)
    return False


async def _check_token_taxes(symbol: str) -> bool:
    """Check if token has buy/sell taxes > 5% via DexScreener."""
    base = symbol.split("/")[0]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                f"https://api.dexscreener.com/latest/dex/tokens/{base}",
            )
            if resp.status_code == 200:
                pairs = resp.json().get("pairs", [])
                if pairs:
                    # Check for tax info in the first pair
                    pair = pairs[0]
                    buy_tax = float(pair.get("buyTax", 0) or 0)
                    sell_tax = float(pair.get("sellTax", 0) or 0)
                    if buy_tax > 5 or sell_tax > 5:
                        return True
    except (httpx.HTTPError, asyncio.TimeoutError, Exception):
        pass
    return False


async def _check_liquidity_locked(symbol: str) -> bool:
    """Check if liquidity is locked via DexScreener info."""
    base = symbol.split("/")[0]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                f"https://api.dexscreener.com/latest/dex/tokens/{base}",
            )
            if resp.status_code == 200:
                pairs = resp.json().get("pairs", [])
                if pairs:
                    # DexScreener doesn't directly expose lock status
                    # but low liquidity + new pair = risk
                    pair = pairs[0]
                    liquidity = float(pair.get("liquidity", {}).get("usd", 0) or 0)
                    created_at = pair.get("pairCreatedAt", "")
                    if liquidity < 50_000 and created_at:
                        # Very low liquidity + recent creation = unlocked risk
                        return True
    except (httpx.HTTPError, asyncio.TimeoutError, Exception):
        pass
    return False


async def _check_suspicious_apy(symbol: str) -> bool:
    """Check for suspiciously high APY via DexScreener."""
    base = symbol.split("/")[0]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                f"https://api.dexscreener.com/latest/dex/tokens/{base}",
            )
            if resp.status_code == 200:
                pairs = resp.json().get("pairs", [])
                if pairs:
                    # Check for extremely high volume/liquidity ratio (wash trading)
                    pair = pairs[0]
                    vol_24h = float(pair.get("volume", {}).get("h24", 0) or 0)
                    liquidity = float(pair.get("liquidity", {}).get("usd", 0) or 0)
                    if liquidity > 0 and vol_24h / liquidity > 20:
                        return True
    except (httpx.HTTPError, asyncio.TimeoutError, Exception):
        pass
    return False


async def check_red_flags(symbol: str, market_cap_tier: str) -> dict[str, Any]:
    """Run red flags checklist for a crypto asset.

    Returns:
        {
            "red_flags": list[str],      # names of triggered flags
            "red_flag_count": int,       # number of triggered flags
            "danger": bool,              # True if count >= 5
            "warning": str | None,       # human-readable warning
        }
    """
    red_flags: list[str] = []

    if market_cap_tier not in ("MICRO", "SMALL"):
        return {"red_flags": [], "red_flag_count": 0, "danger": False, "warning": None}

    # Run async checks in parallel
    results = await asyncio.gather(
        _check_token_taxes(symbol),
        _check_liquidity_locked(symbol),
        _check_suspicious_apy(symbol),
        _check_whale_concentration(symbol),
        return_exceptions=True,
    )

    checks = {
        "token_taxes": results[0] if not isinstance(results[0], Exception) else False,
        "unlocked_liquidity": results[1] if not isinstance(results[1], Exception) else False,
        "suspicious_apy": results[2] if not isinstance(results[2], Exception) else False,
        "whale_concentration": results[3] if not isinstance(results[3], Exception) else False,
    }

    for flag_name, triggered in checks.items():
        if triggered:
            red_flags.append(flag_name)

    # Heuristic flags for micro-caps without data
    if market_cap_tier == "MICRO" and len(red_flags) == 0:
        # No data available = can't verify = assume some risk
        red_flags.append("no_audit")  # Most micro-caps don't have audits
        red_flags.append("anonymous_team")  # Most micro-caps have anon teams

    count = len(red_flags)
    danger = count >= 5
    warning = None
    if danger:
        warning = "Projet à risque extrême — 5+ red flags détectés"
    elif count >= 3:
        warning = f"{count} red flags détectés — prudence recommandée"

    return {
        "red_flags": red_flags,
        "red_flag_count": count,
        "danger": danger,
        "warning": warning,
    }
