"""Liquidity score (0-100) for trading signals.

Components:
  - Order book depth (Binance depth20 for crypto)
  - 24h volume profile (relative to 20-day average)
  - Bid-ask spread

Score < 30 = critical liquidity → SL widened + "Exit difficile" warning
Score < 10 = signal disabled or confidence reduced 50%
"""
import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


async def _fetch_binance_depth(symbol: str) -> Optional[dict]:
    """Fetch Binance order book depth (top 20 levels)."""
    base = symbol.split("/")[0]
    ticker = f"{base}USDT"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://api.binance.com/api/v3/depth",
                params={"symbol": ticker, "limit": 20},
            )
            if resp.status_code == 200:
                return resp.json()
    except (httpx.HTTPError, asyncio.TimeoutError):
        pass
    return None


async def _fetch_binance_ticker(symbol: str) -> Optional[dict]:
    """Fetch Binance 24h ticker stats for spread and volume."""
    base = symbol.split("/")[0]
    ticker = f"{base}USDT"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                "https://api.binance.com/api/v3/ticker/24hr",
                params={"symbol": ticker},
            )
            if resp.status_code == 200:
                return resp.json()
    except (httpx.HTTPError, asyncio.TimeoutError):
        pass
    return None


def _depth_score(depth_data: dict) -> float:
    """Score 0-40 based on order book depth (top 20 levels)."""
    bids = depth_data.get("bids", [])
    asks = depth_data.get("asks", [])
    if not bids or not asks:
        return 0.0

    # Sum USD value of top 20 levels (price * qty)
    bid_value = sum(float(b[0]) * float(b[1]) for b in bids[:20])
    ask_value = sum(float(a[0]) * float(a[1]) for a in asks[:20])
    total_value = bid_value + ask_value

    # Heuristic: $1M+ total depth = 40, $100K = 20, $10K = 8, < $1K = 2
    if total_value >= 1_000_000:
        return 40.0
    if total_value >= 500_000:
        return 35.0
    if total_value >= 100_000:
        return 25.0
    if total_value >= 50_000:
        return 18.0
    if total_value >= 10_000:
        return 10.0
    if total_value >= 1_000:
        return 4.0
    return 2.0


def _spread_score(ticker_data: dict) -> float:
    """Score 0-30 based on bid-ask spread."""
    bid = float(ticker_data.get("bidPrice", 0))
    ask = float(ticker_data.get("askPrice", 0))
    if bid <= 0 or ask <= 0:
        return 0.0

    spread_pct = ((ask - bid) / ask) * 100

    # Spread < 0.01% = 30, < 0.05% = 25, < 0.1% = 20, < 0.5% = 10, < 1% = 5, >= 1% = 0
    if spread_pct < 0.01:
        return 30.0
    if spread_pct < 0.05:
        return 25.0
    if spread_pct < 0.1:
        return 20.0
    if spread_pct < 0.5:
        return 10.0
    if spread_pct < 1.0:
        return 5.0
    return 0.0


def _volume_score(ticker_data: dict) -> float:
    """Score 0-30 based on 24h quote volume."""
    quote_vol = float(ticker_data.get("quoteVolume", 0))

    # $100M+ = 30, $10M = 25, $1M = 20, $100K = 12, $10K = 6, < $10K = 2
    if quote_vol >= 100_000_000:
        return 30.0
    if quote_vol >= 10_000_000:
        return 25.0
    if quote_vol >= 1_000_000:
        return 20.0
    if quote_vol >= 100_000:
        return 12.0
    if quote_vol >= 10_000:
        return 6.0
    return 2.0


async def compute_liquidity_score(symbol: str, asset_type: str) -> dict:
    """Compute liquidity score (0-100) for a symbol.

    Returns:
        {
            "score": float,          # 0-100
            "depth_score": float,    # 0-40
            "spread_score": float,   # 0-30
            "volume_score": float,   # 0-30
            "warning": str | None,   # "Exit difficile" if < 30
        }
    """
    if asset_type != "CRYPTO":
        # Non-crypto: assume decent liquidity for forex/commodity
        # BRVM: low liquidity
        if asset_type == "BRVM":
            return {"score": 25.0, "depth_score": 10.0, "spread_score": 5.0, "volume_score": 10.0, "warning": "Exit difficile — BRVM liquidité limitée"}
        if asset_type == "SYNTHETIC":
            return {"score": 70.0, "depth_score": 30.0, "spread_score": 20.0, "volume_score": 20.0, "warning": None}
        return {"score": 75.0, "depth_score": 30.0, "spread_score": 25.0, "volume_score": 20.0, "warning": None}

    # Fetch depth and ticker in parallel
    depth_task = _fetch_binance_depth(symbol)
    ticker_task = _fetch_binance_ticker(symbol)
    depth_data, ticker_data = await asyncio.gather(depth_task, ticker_task, return_exceptions=True)

    d_score = 0.0
    s_score = 0.0
    v_score = 0.0

    if isinstance(depth_data, dict):
        d_score = _depth_score(depth_data)
    if isinstance(ticker_data, dict):
        s_score = _spread_score(ticker_data)
        v_score = _volume_score(ticker_data)

    total = d_score + s_score + v_score
    warning = None
    if total < 30:
        warning = "Exit difficile — liquidité critique"
    elif total < 10:
        warning = "Liquidité extrêmement faible — signal risqué"

    orderbook = _analyze_orderbook(symbol, depth_data if isinstance(depth_data, dict) else None)

    return {
        "score": round(total, 1),
        "depth_score": d_score,
        "spread_score": s_score,
        "volume_score": v_score,
        "warning": warning,
        "orderbook": orderbook,
    }


_OB_SNAPSHOT_TTL = 900  # garde le snapshot précédent ~15min pour mesurer le churn


def _weighted_side_value(levels: list, mid: float) -> float:
    """USD value pondérée par proximité du mid (1er niveau pèse le plus)."""
    total = 0.0
    for i, lvl in enumerate(levels[:10]):
        price, qty = float(lvl[0]), float(lvl[1])
        if mid > 0:
            dist_pct = abs(price - mid) / mid
            weight = 1.0 / (1.0 + dist_pct * 100.0) / (1.0 + i * 0.15)
        else:
            weight = 1.0
        total += price * qty * weight
    return total


def _slippage_for(levels: list, target_usd: float = 500.0) -> Optional[float]:
    """Slippage % d'un ordre market de `target_usd` exécuté contre les niveaux.

    Marche le carnet niveau par niveau : le prix moyen pondéré obtenu est
    comparé au meilleur prix disponible (impact instantané de l'ordre)."""
    if not levels:
        return None
    best = float(levels[0][0])
    usd_spent = 0.0
    qty_acc = 0.0
    for lvl in levels:
        price, qty = float(lvl[0]), float(lvl[1])
        take_usd = min(price * qty, target_usd - usd_spent)
        if take_usd <= 0:
            break
        qty_acc += take_usd / price
        usd_spent += take_usd
        if usd_spent >= target_usd:
            break
    if qty_acc <= 0 or usd_spent < target_usd * 0.5:
        # Carnet trop fin pour remplir la moitié de l'ordre → mesure non fiable
        return None
    avg_price = usd_spent / qty_acc
    return abs(avg_price - best) / best * 100.0


def _analyze_orderbook(symbol: str, depth_data: Optional[dict]) -> Optional[dict]:
    """Signaux directionnels du carnet Binance (Niveau A) :

    - imbalance : (bids - asks) pondéré proximité → pression acheteur/vendeur
    - microprice : "vrai" prix instantané vs mid → prédicteur du prochain tick
    - slippage estimé pour $500 market buy/sell
    - churn + spoof : comparaison avec le snapshot précédent (cache 15min) —
      un mur qui apparaît/disparaît = spoofing probable, on ne s'y fie pas.
    """
    if not depth_data:
        return None
    bids = depth_data.get("bids") or []
    asks = depth_data.get("asks") or []
    if not bids or not asks:
        return None

    best_bid, best_ask = float(bids[0][0]), float(asks[0][0])
    mid = (best_bid + best_ask) / 2.0

    bid_val = _weighted_side_value(bids, mid)
    ask_val = _weighted_side_value(asks, mid)
    imbalance = (bid_val - ask_val) / (bid_val + ask_val) if (bid_val + ask_val) > 0 else 0.0

    bid_sz, ask_sz = float(bids[0][1]), float(asks[0][1])
    microprice = (best_bid * ask_sz + best_ask * bid_sz) / (bid_sz + ask_sz)
    microprice_bps = (microprice - mid) / mid * 10_000

    slip_buy = _slippage_for(asks, 500.0)
    slip_sell = _slippage_for(bids, 500.0)

    # Churn vs snapshot précédent : % des niveaux top-10 qui ont changé.
    from utils.cache import mem_get, mem_set
    key = f"ob:{symbol.upper()}"
    prev = mem_get(key)
    cur_levels = {
        "bids": [l[0] for l in bids[:10]],
        "asks": [l[0] for l in asks[:10]],
    }
    mem_set(key, cur_levels, _OB_SNAPSHOT_TTL)

    churn = None
    spoof_suspected = False
    if isinstance(prev, dict):
        prev_set = set(prev.get("bids", [])) | set(prev.get("asks", []))
        cur_set = set(cur_levels["bids"]) | set(cur_levels["asks"])
        if prev_set:
            churn = 1.0 - len(prev_set & cur_set) / len(prev_set)
        if churn is not None and churn > 0.8:
            spoof_suspected = True

    # Ajustement de confiance : le carnet confirme (+) ou contredit (-).
    # Le sens est appliqué par l'appelant selon la direction du signal.
    notes = []
    if spoof_suspected:
        notes.append("Churn carnet >80% — spoofing/manipulation probable, imbalance ignorée")
    elif imbalance > 0.3:
        notes.append(f"Pression acheteuse dans le carnet ({imbalance:+.0%})")
    elif imbalance < -0.3:
        notes.append(f"Pression vendeuse dans le carnet ({imbalance:+.0%})")
    if slip_buy is not None and slip_buy > 0.5:
        notes.append(f"Slippage entrée élevé (~{slip_buy:.2f}% pour $500)")

    return {
        "imbalance": round(imbalance, 3),
        "microprice_bps": round(microprice_bps, 1),
        "slippage_buy_pct": round(slip_buy, 3) if slip_buy is not None else None,
        "slippage_sell_pct": round(slip_sell, 3) if slip_sell is not None else None,
        "churn": round(churn, 3) if churn is not None else None,
        "spoof_suspected": spoof_suspected,
        "notes": notes,
    }


def estimate_liquidity_score_sync(symbol: str, asset_type: str, df=None) -> dict:
    """Synchronous fallback using volume from candle data if available."""
    if asset_type != "CRYPTO":
        if asset_type == "BRVM":
            return {"score": 25.0, "depth_score": 10.0, "spread_score": 5.0, "volume_score": 10.0, "warning": "Exit difficile — BRVM liquidité limitée"}
        if asset_type == "SYNTHETIC":
            return {"score": 70.0, "depth_score": 30.0, "spread_score": 20.0, "volume_score": 20.0, "warning": None}
        return {"score": 75.0, "depth_score": 30.0, "spread_score": 25.0, "volume_score": 20.0, "warning": None}

    # Try to estimate from candle volume
    if df is not None and len(df) >= 20:
        try:
            recent_vol = float(df["volume"].iloc[-1])
            avg_vol = float(df["volume"].iloc[-20:].mean())
            vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1.0

            # Rough heuristic: high volume = better liquidity
            if recent_vol >= 10_000:
                v_score = 25.0
            elif recent_vol >= 1_000:
                v_score = 18.0
            elif recent_vol >= 100:
                v_score = 10.0
            else:
                v_score = 4.0

            # Penalize low volume ratio
            if vol_ratio < 0.5:
                v_score *= 0.7

            total = 20.0 + v_score  # Assume moderate depth + spread for known crypto
            warning = None
            if total < 30:
                warning = "Exit difficile — volume faible"
            return {"score": round(total, 1), "depth_score": 20.0, "spread_score": 0.0, "volume_score": v_score, "warning": warning}
        except Exception:
            pass

    # Default for crypto without data
    return {"score": 50.0, "depth_score": 20.0, "spread_score": 15.0, "volume_score": 15.0, "warning": None}
