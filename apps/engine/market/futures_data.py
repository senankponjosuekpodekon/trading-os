"""Données dérivés Binance USDⓈ-M (fapi) — lecture seule, endpoints publics.

Ce que le spot ne voit pas : le POSITIONNEMENT des traders.
  - funding rate   : qui paie pour rester positionné (crowding)
  - open interest  : combien de positions ouvertes (positionnement réel)
  - long/short acc : sentiment retail aux extrêmes (contrarian)
  - taker ratio    : pression agressive acheteur/vendeur (order flow réel)

Chaque métrique est interprétée en ajustement direction-aware :
  - aligned   → le dérivé CONFIRME le sens du signal (bonus)
  - adverse   → le dérivé CONTREDIT (malus / flag)
Le sens est résolu par l'appelant (BUY vs SELL).
"""

import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_FAPI = "https://fapi.binance.com"
_TIMEOUT = 4.0

# Seuils empiriques funding (% par 8h)
_FUNDING_EXTREME = 0.075    # > 0.075%/8h ≈ +80%/an — longs surchargés
_FUNDING_EXTREME_NEG = -0.05
_LS_EXTREME = 2.5           # globalLongShortAccountRatio (longs/shorts)
_OI_SIGNIFICANT = 5.0       # % de variation OI sur 24h notable


async def _get(client: httpx.AsyncClient, path: str, params: dict) -> Optional[Any]:
    try:
        r = await client.get(f"{_FAPI}{path}", params=params)
        if r.status_code == 200:
            return r.json()
    except (httpx.HTTPError, ValueError):
        pass
    return None


async def fetch_derivatives_context(symbol: str) -> Optional[Dict[str, Any]]:
    """Contexte dérivés pour un symbole crypto (ex. "BTC/USDT" → "BTCUSDT").

    Retourne None si le symbole n'a pas de perp Binance (petits alts) —
    l'appelant tag alors le signal SPOT au lieu de FUTURES."""
    base = symbol.split("/")[0].replace("USD", "").upper()
    ticker = f"{base}USDT"

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        import asyncio
        premium, funding_hist, oi_hist, ls_ratio, taker = await asyncio.gather(
            _get(client, "/fapi/v1/premiumIndex", {"symbol": ticker}),
            _get(client, "/fapi/v1/fundingRate", {"symbol": ticker, "limit": 8}),
            _get(client, "/futures/data/openInterestHist",
                 {"symbol": ticker, "period": "4h", "limit": 6}),
            _get(client, "/futures/data/globalLongShortAccountRatio",
                 {"symbol": ticker, "period": "4h", "limit": 1}),
            _get(client, "/futures/data/takerlongshortRatio",
                 {"symbol": ticker, "period": "4h", "limit": 1}),
            return_exceptions=True,
        )

    if not isinstance(premium, dict):
        return None  # pas de perp pour ce symbole

    ctx: Dict[str, Any] = {"market_type": "FUTURES", "ticker": ticker}

    # ── Funding rate actuel + tendance ──
    try:
        funding = float(premium.get("lastFundingRate", 0)) * 100  # % /8h
        ctx["funding_rate"] = round(funding, 4)
        if isinstance(funding_hist, list) and funding_hist:
            hist = [float(f.get("fundingRate", 0)) * 100 for f in funding_hist[-4:]]
            ctx["funding_avg_24h"] = round(sum(hist) / len(hist), 4)
    except (TypeError, ValueError):
        pass

    # ── Open interest : variation sur la fenêtre (≈24h en pas de 4h) ──
    try:
        if isinstance(oi_hist, list) and len(oi_hist) >= 2:
            oi_first = float(oi_hist[0].get("sumOpenInterest", 0))
            oi_last = float(oi_hist[-1].get("sumOpenInterest", 0))
            if oi_first > 0:
                ctx["oi_change_pct"] = round((oi_last - oi_first) / oi_first * 100, 2)
        # valeur en USD pour pondération (gros OI = signal plus fiable)
        if isinstance(oi_hist, list) and oi_hist:
            ctx["oi_usd"] = float(oi_hist[-1].get("sumOpenInterestValue", 0) or 0)
    except (TypeError, ValueError, IndexError):
        pass

    # ── Long/Short account ratio (retail crowding) ──
    try:
        if isinstance(ls_ratio, list) and ls_ratio:
            ctx["long_short_ratio"] = float(ls_ratio[0].get("longShortRatio", 0))
    except (TypeError, ValueError, IndexError):
        pass

    # ── Taker buy/sell volume (pression agressive) ──
    try:
        if isinstance(taker, list) and taker:
            t0 = taker[0]
            buy_vol = float(t0.get("buySellRatio", t0.get("buyVol", 0)) or 0)
            if "buySellRatio" in t0:
                ctx["taker_buy_sell"] = round(buy_vol, 3)
            else:
                b, s = float(t0.get("buyVol", 0)), float(t0.get("sellVol", 1))
                ctx["taker_buy_sell"] = round(b / max(s, 1e-9), 3)
    except (TypeError, ValueError, IndexError):
        pass

    ctx["interpretation"] = _interpret(ctx)
    return ctx


def _interpret(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Traduit les métriques en lecture direction-aware.

    bias_long  : le contexte favorise les LONG (ex. shorts surchargés)
    bias_short : le contexte favorise les SHORT (longs piégés)
    flags      : explications lisibles"""
    flags = []
    bias_long = 0.0
    bias_short = 0.0

    funding = ctx.get("funding_rate")
    if funding is not None:
        if funding >= _FUNDING_EXTREME:
            bias_short += 1
            flags.append(f"Funding {funding:+.3f}%/8h — longs surchargés, risque de squeeze baissier")
        elif funding <= _FUNDING_EXTREME_NEG:
            bias_long += 1
            flags.append(f"Funding {funding:+.3f}%/8h — shorts surchargés, carburant haussier")

    oi = ctx.get("oi_change_pct")
    if oi is not None:
        if oi >= _OI_SIGNIFICANT:
            flags.append(f"OI {oi:+.1f}%/24h — accumulation de positions, breakout probable")
        elif oi <= -_OI_SIGNIFICANT:
            flags.append(f"OI {oi:+.1f}%/24h — positions fermées, mouvement en épuisement")

    ls = ctx.get("long_short_ratio")
    if ls is not None:
        if ls >= _LS_EXTREME:
            bias_short += 1
            flags.append(f"Retail {ls:.1f}x longs — extrême contrarian baissier")
        elif ls <= 1 / _LS_EXTREME:
            bias_long += 1
            flags.append(f"Retail {ls:.1f}x shorts — extrême contrarian haussier")

    taker = ctx.get("taker_buy_sell")
    if taker is not None:
        if taker >= 1.15:
            bias_long += 0.5
            flags.append(f"Order flow acheteur agressif (taker ×{taker:.2f})")
        elif taker <= 0.85:
            bias_short += 0.5
            flags.append(f"Order flow vendeur agressif (taker ×{taker:.2f})")

    return {
        "bias_long": bias_long,
        "bias_short": bias_short,
        "flags": flags,
    }


def derivatives_adjustment(ctx: Optional[Dict[str, Any]], signal: str) -> float:
    """Ajustement de confiance (fraction) selon l'alignement signal↔dérivés.

    +0.05 confirmation forte / -0.10 contradiction / 0 neutre ou absent."""
    if not ctx or signal not in ("BUY", "SELL"):
        return 0.0
    interp = ctx.get("interpretation") or {}
    bias_long = interp.get("bias_long", 0)
    bias_short = interp.get("bias_short", 0)
    aligned = (signal == "BUY" and bias_long > bias_short) or \
              (signal == "SELL" and bias_short > bias_long)
    opposed = (signal == "BUY" and bias_short > bias_long) or \
              (signal == "SELL" and bias_long > bias_short)
    if aligned:
        return +0.05
    if opposed:
        return -0.10
    return 0.0
