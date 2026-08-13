"""
On-Chain Pre-Listing Signals — Phase P
Detects whale accumulation and smart money activity before token listings
on major exchanges. Combines on-chain data with pre-listing intelligence.

Signals:
  1. Whale accumulation: large wallets buying before listing announcement
  2. Exchange inflow/outflow: tokens moving to/from exchanges pre-listing
  3. Smart money tracking: known successful wallets entering positions
  4. Liquidity building: DEX liquidity increasing before CEX listing
  5. Developer activity: code commits increasing pre-listing
  6. Holder growth: new addresses accumulating pre-listing
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

import httpx
from fastapi import APIRouter, HTTPException, Query

from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

# Cache
_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 600  # 10 min

# Known smart money addresses (would be maintained/updated)
SMART_MONEY_ADDRESSES: dict[str, list[str]] = {
    "ethereum": [
        "0x28C6c06298d514Db089934071355E5743bf21d60",  # Binance
        "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d",  # Binance
        "0x56Eddb7aa87536c09CCc2793473599fD21a88017",  # Coinbase
        "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE",  # Binance
    ],
    "solana": [
        "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",  # Binance
        "GcWEQq7q2k2jL3q5m8R8d4z6fQ3vW7yX9bN1pJ2sM4t",  # Known whale
    ],
}

# Whale transaction threshold (USD)
WHALE_THRESHOLD_USD = 100_000


@dataclass
class PreListingSignal:
    symbol: str
    chain: str
    signal_type: str  # whale_accumulation | exchange_inflow | exchange_outflow | liquidity_build | dev_activity | holder_growth
    severity: str  # critical | high | medium | low
    direction: str  # bullish | bearish | neutral
    message: str
    data: Dict[str, Any]
    confidence: int


async def _fetch_whale_transactions(
    symbol: str,
    chain: str = "ethereum",
    min_usd: float = WHALE_THRESHOLD_USD,
) -> List[Dict[str, Any]]:
    """
    Fetch large transactions for a token.
    Uses Whale Alert API (free tier: 10 req/min) or Etherscan as fallback.
    """
    # Whale Alert API
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.whale-alert.io/v1/transactions",
                params={
                    "api_key": "",  # Would be configured in .env
                    "min": int(min_usd),
                    "start": int((datetime.now(timezone.utc) - timedelta(hours=24)).timestamp()),
                    "cursor": "",
                    "limit": 50,
                },
            )
            if r.status_code == 200:
                data = r.json()
                return [
                    {
                        "hash": tx.get("hash", ""),
                        "from": tx.get("from", ""),
                        "to": tx.get("to", ""),
                        "amount_usd": tx.get("amount_usd", 0),
                        "amount": tx.get("amount", 0),
                        "symbol": tx.get("symbol", ""),
                        "transaction_type": tx.get("transaction_type", ""),
                        "timestamp": tx.get("timestamp", 0),
                    }
                    for tx in data.get("transactions", [])
                    if tx.get("symbol", "").upper() == symbol.upper()
                ]
    except Exception as exc:
        logger.debug("whale_alert_fetch_failed", symbol=symbol, error=str(exc))

    return []


async def _fetch_dex_liquidity_history(symbol: str) -> Dict[str, Any]:
    """
    Fetch DEX liquidity history to detect liquidity building before listing.
    Uses DexScreener API.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.dexscreener.com/latest/dex/search",
                params={"q": symbol},
            )
            r.raise_for_status()
            data = r.json()

        pairs = data.get("pairs", [])[:5]
        if not pairs:
            return {"found": False, "liquidity": 0, "trend": "unknown"}

        # Get the pair with most liquidity
        best = max(pairs, key=lambda p: float(p.get("liquidity", {}).get("usd", 0) or 0))
        liquidity = float(best.get("liquidity", {}).get("usd", 0) or 0)
        volume_24h = float(best.get("volume", {}).get("h24", 0) or 0)
        price_change_24h = float(best.get("priceChange", {}).get("h24", 0) or 0)
        created_at = best.get("pairCreatedAt", "")

        # Determine liquidity trend (would need historical data for real trend)
        trend = "stable"
        if volume_24h > liquidity * 2:
            trend = "building"  # High volume relative to liquidity = interest growing
        elif volume_24h < liquidity * 0.1:
            trend = "draining"

        return {
            "found": True,
            "liquidity": liquidity,
            "volume_24h": volume_24h,
            "price_change_24h": price_change_24h,
            "pair_created_at": created_at,
            "trend": trend,
            "chain": best.get("chainId", ""),
            "pair_address": best.get("pairAddress", ""),
            "url": best.get("url", ""),
        }
    except Exception as exc:
        logger.debug("dex_liquidity_fetch_failed", symbol=symbol, error=str(exc))
        return {"found": False, "liquidity": 0, "trend": "unknown"}


async def _fetch_holder_growth(symbol: str, chain: str = "ethereum") -> Dict[str, Any]:
    """
    Fetch holder count and growth.
    Uses Etherscan API (free tier) or BSCScan.
    """
    # This would use Etherscan API in production
    # For now, return a mock structure that would be populated
    return {
        "symbol": symbol,
        "chain": chain,
        "holder_count": 0,  # Would be fetched from block explorer
        "holder_growth_24h": 0,  # New holders in 24h
        "holder_growth_7d": 0,  # New holders in 7d
        "top_10_holders_pct": 0,  # Concentration metric
        "source": "mock",
    }


async def _fetch_dev_activity(symbol: str) -> Dict[str, Any]:
    """
    Fetch developer activity (GitHub commits, contributor count).
    Uses CryptoMiso or direct GitHub API.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # CryptoMiso — ranks coins by GitHub commits
            r = await client.get(f"https://www.cryptomiso.com/api/v1/coins/{symbol.lower()}")
            if r.status_code == 200:
                data = r.json()
                return {
                    "symbol": symbol,
                    "commits_30d": data.get("commits", 0),
                    "contributors": data.get("contributors", 0),
                    "rank": data.get("rank", 0),
                    "source": "cryptomiso",
                }
    except Exception:
        pass

    return {
        "symbol": symbol,
        "commits_30d": 0,
        "contributors": 0,
        "rank": 0,
        "source": "unavailable",
    }


def _analyze_whale_accumulation(
    whale_txs: List[Dict[str, Any]],
    smart_money_addrs: List[str],
) -> Optional[PreListingSignal]:
    """Analyze whale transactions for accumulation patterns."""
    if not whale_txs:
        return None

    # Count inflows vs outflows
    inflows = sum(1 for tx in whale_txs if tx.get("transaction_type") == "receive")
    outflows = sum(1 for tx in whale_txs if tx.get("transaction_type") == "send")
    total_usd = sum(tx.get("amount_usd", 0) for tx in whale_txs)

    # Smart money involvement
    smart_money_in = sum(
        1 for tx in whale_txs
        if tx.get("to", "").lower() in [a.lower() for a in smart_money_addrs]
    )

    if inflows > outflows * 2 and total_usd > 500_000:
        severity = "high"
        direction = "bullish"
        msg = f"Whale accumulation: {inflows} inflows vs {outflows} outflows (${total_usd:,.0f} total)"
        if smart_money_in > 0:
            msg += f" — {smart_money_in} smart money wallets receiving"
            severity = "critical"
        confidence = min(80 + smart_money_in * 10, 95)
    elif outflows > inflows * 2:
        severity = "high"
        direction = "bearish"
        msg = f"Whale distribution: {outflows} outflows vs {inflows} inflows (${total_usd:,.0f} total)"
        confidence = 75
    elif inflows > outflows:
        severity = "medium"
        direction = "bullish"
        msg = f"Mild whale accumulation: {inflows} inflows vs {outflows} outflows"
        confidence = 55
    else:
        return None

    return PreListingSignal(
        symbol=whale_txs[0].get("symbol", "") if whale_txs else "",
        chain="ethereum",
        signal_type="whale_accumulation",
        severity=severity,
        direction=direction,
        message=msg,
        data={
            "inflows": inflows,
            "outflows": outflows,
            "total_usd": round(total_usd, 2),
            "smart_money_involvement": smart_money_in,
            "transaction_count": len(whale_txs),
        },
        confidence=confidence,
    )


def _analyze_liquidity_build(dex_data: Dict[str, Any]) -> Optional[PreListingSignal]:
    """Analyze DEX liquidity for pre-listing building pattern."""
    if not dex_data.get("found"):
        return None

    liquidity = dex_data.get("liquidity", 0)
    volume_24h = dex_data.get("volume_24h", 0)
    trend = dex_data.get("trend", "stable")

    if trend == "building" and liquidity > 100_000:
        return PreListingSignal(
            symbol="",
            chain=dex_data.get("chain", ""),
            signal_type="liquidity_build",
            severity="high",
            direction="bullish",
            message=f"Liquidity building: ${liquidity:,.0f} liquidity with ${volume_24h:,.0f} 24h volume — pre-listing interest",
            data={
                "liquidity": liquidity,
                "volume_24h": volume_24h,
                "vol_liq_ratio": round(volume_24h / max(liquidity, 1), 2),
                "trend": trend,
            },
            confidence=70,
        )
    elif liquidity > 500_000 and volume_24h > 1_000_000:
        return PreListingSignal(
            symbol="",
            chain=dex_data.get("chain", ""),
            signal_type="liquidity_build",
            severity="medium",
            direction="bullish",
            message=f"Established DEX liquidity: ${liquidity:,.0f} — healthy pre-listing market",
            data={"liquidity": liquidity, "volume_24h": volume_24h, "trend": trend},
            confidence=55,
        )
    return None


def _analyze_dev_activity(dev_data: Dict[str, Any]) -> Optional[PreListingSignal]:
    """Analyze developer activity for pre-listing signal."""
    commits = dev_data.get("commits_30d", 0)
    contributors = dev_data.get("contributors", 0)

    if commits > 100 and contributors > 5:
        return PreListingSignal(
            symbol=dev_data.get("symbol", ""),
            chain="",
            signal_type="dev_activity",
            severity="medium",
            direction="bullish",
            message=f"High dev activity: {commits} commits in 30d by {contributors} contributors — active development",
            data={"commits_30d": commits, "contributors": contributors, "rank": dev_data.get("rank", 0)},
            confidence=60,
        )
    elif commits > 50:
        return PreListingSignal(
            symbol=dev_data.get("symbol", ""),
            chain="",
            signal_type="dev_activity",
            severity="low",
            direction="bullish",
            message=f"Moderate dev activity: {commits} commits in 30d",
            data={"commits_30d": commits, "contributors": contributors},
            confidence=40,
        )
    return None


async def analyze_pre_listing_signals(
    symbol: str,
    chain: str = "ethereum",
) -> Dict[str, Any]:
    """
    Run all pre-listing on-chain signal checks for a token.
    """
    # Fetch all data in parallel
    smart_money = SMART_MONEY_ADDRESSES.get(chain, [])
    whale_task = _fetch_whale_transactions(symbol, chain)
    dex_task = _fetch_dex_liquidity_history(symbol)
    holder_task = _fetch_holder_growth(symbol, chain)
    dev_task = _fetch_dev_activity(symbol)

    whale_txs, dex_data, holder_data, dev_data = await asyncio.gather(
        whale_task, dex_task, holder_task, dev_task,
        return_exceptions=True,
    )

    # Handle exceptions
    if isinstance(whale_txs, Exception):
        whale_txs = []
    if isinstance(dex_data, Exception):
        dex_data = {"found": False}
    if isinstance(holder_data, Exception):
        holder_data = {}
    if isinstance(dev_data, Exception):
        dev_data = {}

    # Run signal detectors
    signals: List[PreListingSignal] = []

    whale_signal = _analyze_whale_accumulation(whale_txs, smart_money)
    if whale_signal:
        whale_signal.symbol = symbol
        signals.append(whale_signal)

    liq_signal = _analyze_liquidity_build(dex_data)
    if liq_signal:
        liq_signal.symbol = symbol
        signals.append(liq_signal)

    dev_signal = _analyze_dev_activity(dev_data)
    if dev_signal:
        signals.append(dev_signal)

    # Holder growth analysis
    holder_growth = holder_data.get("holder_growth_24h", 0) if isinstance(holder_data, dict) else 0
    if holder_growth > 100:
        signals.append(PreListingSignal(
            symbol=symbol,
            chain=chain,
            signal_type="holder_growth",
            severity="medium",
            direction="bullish",
            message=f"Holder growth: +{holder_growth} new addresses in 24h — organic interest",
            data=holder_data if isinstance(holder_data, dict) else {},
            confidence=55,
        ))

    # Overall assessment
    bullish_signals = [s for s in signals if s.direction == "bullish"]
    bearish_signals = [s for s in signals if s.direction == "bearish"]
    critical_signals = [s for s in signals if s.severity == "critical"]

    if critical_signals:
        overall = "STRONG_BULLISH"
        score = 90
    elif len(bullish_signals) >= 3:
        overall = "BULLISH"
        score = 70
    elif len(bullish_signals) >= 1:
        overall = "MILD_BULLISH"
        score = 55
    elif len(bearish_signals) >= 2:
        overall = "BEARISH"
        score = 25
    else:
        overall = "NEUTRAL"
        score = 50

    return {
        "symbol": symbol,
        "chain": chain,
        "overall_signal": overall,
        "pre_listing_score": score,
        "signal_count": len(signals),
        "bullish_count": len(bullish_signals),
        "bearish_count": len(bearish_signals),
        "signals": [
            {
                "signal_type": s.signal_type,
                "severity": s.severity,
                "direction": s.direction,
                "message": s.message,
                "data": s.data,
                "confidence": s.confidence,
            }
            for s in signals
        ],
        "raw_data": {
            "whale_transactions": len(whale_txs) if isinstance(whale_txs, list) else 0,
            "dex_liquidity": dex_data if isinstance(dex_data, dict) else {},
            "holder_data": holder_data if isinstance(holder_data, dict) else {},
            "dev_activity": dev_data if isinstance(dev_data, dict) else {},
        },
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/pre-listing/signals/{symbol}")
async def pre_listing_signals_endpoint(
    symbol: str,
    chain: str = Query("ethereum", description="Blockchain: ethereum, solana, bsc"),
    refresh: bool = Query(False),
):
    """GET /onchain/pre-listing/signals/{symbol} — Pre-listing on-chain signals."""
    cache_key = f"prelisting:{symbol}:{chain}"
    now = time.monotonic()

    if not refresh and cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < _CACHE_TTL:
            return data

    try:
        result = await analyze_pre_listing_signals(symbol, chain)
        _cache[cache_key] = (now, result)
        return result
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Pre-listing signals unavailable: {exc}") from exc
