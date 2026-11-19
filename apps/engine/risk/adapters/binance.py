"""Adapter Binance USDⓈ-M Futures (testnet par défaut).

Env :
  BINANCE_API_KEY / BINANCE_API_SECRET — requis pour s'enregistrer
  BINANCE_TESTNET=1 (défaut) → testnet-futures ; 0 → prod RÉELLE
  BINANCE_BASE_URL — hôte démo autorisé uniquement en mode testnet
  (ex: https://demo-fapi.binance.com). Les ordres conditionnels passent
  par /fapi/v1/algoOrder depuis la migration Binance du 09/12/2025.

L'adapter place des ordres LIMIT au prix demandé (pas de market order
aveugle — le slippage se mesure via requested vs fill).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Optional
from urllib.parse import urlencode

import httpx

from utils.logger import get_logger
from .base import VenueAdapter

logger = get_logger(__name__)

_BASE_PROD = "https://fapi.binance.com"
_BASE_TEST = "https://testnet.binancefuture.com"
# Hôtes hors production acceptés : ancien testnet et Futures Demo actuel.
_DEMO_HOSTS = {"testnet.binancefuture.com", "demo-fapi.binance.com"}


class BinanceAdapter(VenueAdapter):
    venue = "FUTURES"

    @staticmethod
    def is_demo_base(base: str) -> bool:
        from urllib.parse import urlsplit
        parsed = urlsplit(base)
        return parsed.scheme == "https" and parsed.netloc in _DEMO_HOSTS

    def __init__(self, key: str, secret: str, base: str):
        self._key, self._secret, self._base = key, secret, base
        self._leverage = int(os.getenv("BINANCE_LEVERAGE", "3") or "3")
        # ISOLATED par défaut : une position liquidée n'emporte que sa marge,
        # pas tout le compte (fail-safe). CROSS via BINANCE_MARGIN_TYPE=CROSS.
        self._margin_type = os.getenv("BINANCE_MARGIN_TYPE", "ISOLATED").upper()
        self._filters_cache: dict[str, dict] = {}
        self._filters_ts: float = 0.0

    @classmethod
    def from_env(cls) -> Optional["BinanceAdapter"]:
        key = os.getenv("BINANCE_API_KEY")
        secret = os.getenv("BINANCE_API_SECRET")
        if not key or not secret:
            return None
        testnet = os.getenv("BINANCE_TESTNET", "1") != "0"
        if not testnet:
            logger.warning("binance_adapter_LIVE_MODE")
        base = _BASE_TEST if testnet else _BASE_PROD
        override = os.getenv("BINANCE_BASE_URL", "")
        if override:
            if not testnet or not cls.is_demo_base(override):
                logger.warning("binance_adapter_base_refused", base=override)
            else:
                base = override
        return cls(key, secret, base)

    def _sign(self, params: dict) -> str:
        q = urlencode(params)
        return hmac.new(self._secret.encode(), q.encode(),
                        hashlib.sha256).hexdigest()

    async def _post(self, path: str, params: dict) -> dict:
        params = {**params, "timestamp": int(time.time() * 1000),
                  "recvWindow": 5000}
        params["signature"] = self._sign(params)
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.post(path, params=params,
                             headers={"X-MBX-APIKEY": self._key})
            r.raise_for_status()
            return r.json()

    # ── Filtres exchange (LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL) ────
    @staticmethod
    def _round_step(value: float, step: float) -> float:
        if step <= 0:
            return value
        import math
        return math.floor(value / step) * step

    async def _filters(self) -> dict[str, dict]:
        """Cache 1h de /fapi/v1/exchangeInfo (endpoint public)."""
        if self._filters_cache and (time.monotonic() - self._filters_ts) < 3600:
            return self._filters_cache
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.get("/fapi/v1/exchangeInfo")
            r.raise_for_status()
        out: dict[str, dict] = {}
        for s in r.json().get("symbols", []):
            f = {fl["filterType"]: fl for fl in s.get("filters", [])}
            lot = f.get("LOT_SIZE") or {}
            prc = f.get("PRICE_FILTER") or {}
            notl = f.get("MIN_NOTIONAL") or f.get("NOTIONAL") or {}
            out[s["symbol"]] = {
                "step_size": float(lot.get("stepSize") or 0),
                "min_qty": float(lot.get("minQty") or 0),
                "tick_size": float(prc.get("tickSize") or 0),
                "min_notional": float(notl.get("notional") or notl.get("minNotional") or 0),
            }
        self._filters_cache, self._filters_ts = out, time.monotonic()
        return out

    @staticmethod
    def _fmt(value: float, step: float) -> str:
        """Formate selon la précision du step/tick."""
        if step >= 1:
            return str(int(round(value)))
        decimals = 0
        s = step
        while s < 1 and decimals < 10:
            s *= 10
            decimals += 1
        return f"{value:.{decimals}f}"

    async def _setup_symbol(self, sym: str) -> None:
        """Levier + marginType explicites — best-effort, ignoré si déjà OK."""
        try:
            await self._post("/fapi/v1/leverage",
                             {"symbol": sym, "leverage": self._leverage})
        except Exception as e:
            logger.warning("binance_leverage_failed", symbol=sym, error=str(e))
        try:
            await self._post("/fapi/v1/marginType",
                             {"symbol": sym, "marginType": self._margin_type})
        except Exception:
            pass  # -4059 "no need to change" ou position ouverte → ignorer

    async def place_order(self, symbol: str, direction: str,
                          qty: float, price: float | None,
                          stop_loss: float | None = None,
                          take_profit: float | None = None) -> dict:
        sym = symbol.replace("/", "")
        f = (await self._filters()).get(sym, {})

        # Respect des filtres exchange : qty arrondie au step, prix au tick
        qty_r = self._round_step(qty, f.get("step_size") or 0)
        if f.get("min_qty") and qty_r < f["min_qty"]:
            raise ValueError(
                f"qty {qty_r} < minQty {f['min_qty']} pour {sym}")
        ref_price = float(price or 0)
        if f.get("min_notional") and qty_r * ref_price < f["min_notional"]:
            raise ValueError(
                f"notional {qty_r * ref_price:.2f} < minNotional "
                f"{f['min_notional']} pour {sym}")
        price_r = (self._round_step(ref_price, f["tick_size"])
                   if price and f.get("tick_size") else price)

        await self._setup_symbol(sym)

        params = {
            "symbol": sym, "side": "BUY" if direction == "BUY" else "SELL",
            "type": "LIMIT", "timeInForce": "GTC",
            "quantity": self._fmt(qty_r, f.get("step_size") or 1e-6),
            "price": self._fmt(price_r or 0, f.get("tick_size") or 1e-8),
        }
        res = await self._post("/fapi/v1/order", params)
        fill_price = float(res.get("avgPrice") or price or 0)

        # Protection côté broker : SL/TP natifs Binance — survivent à un
        # crash de notre système (closePosition, trigger sur mark price).
        # Depuis le 09/12/2025, les ordres conditionnels passent par
        # POST /fapi/v1/algoOrder (algoType=CONDITIONAL, triggerPrice) ;
        # /fapi/v1/order renvoie -4120 pour ces types.
        close_side = "SELL" if direction == "BUY" else "BUY"
        if stop_loss:
            try:
                await self._post("/fapi/v1/algoOrder", {
                    "algoType": "CONDITIONAL",
                    "symbol": sym, "side": close_side,
                    "type": "STOP_MARKET", "closePosition": "true",
                    "triggerPrice": self._fmt(stop_loss, f.get("tick_size") or 1e-8),
                    "workingType": "MARK_PRICE",
                })
            except Exception as e:
                logger.error("binance_stop_failed", symbol=sym, error=str(e))
        if take_profit:
            try:
                await self._post("/fapi/v1/algoOrder", {
                    "algoType": "CONDITIONAL",
                    "symbol": sym, "side": close_side,
                    "type": "TAKE_PROFIT_MARKET", "closePosition": "true",
                    "triggerPrice": self._fmt(take_profit, f.get("tick_size") or 1e-8),
                    "workingType": "MARK_PRICE",
                })
            except Exception as e:
                logger.error("binance_tp_failed", symbol=sym, error=str(e))

        return {"price": fill_price,
                "order_id": res.get("orderId"), "raw_status": res.get("status")}

    async def _get(self, path: str, params: dict) -> dict | list:
        params = {**params, "timestamp": int(time.time() * 1000),
                  "recvWindow": 5000}
        params["signature"] = self._sign(params)
        async with httpx.AsyncClient(base_url=self._base, timeout=10) as c:
            r = await c.get(path, params=params,
                            headers={"X-MBX-APIKEY": self._key})
            r.raise_for_status()
            return r.json()

    async def close_position(self, symbol: str) -> dict:
        """Lit la position réelle (positionRisk) puis envoie un ordre
        MARKET reduceOnly de la quantité exacte."""
        sym = symbol.replace("/", "")
        rows = await self._get("/fapi/v2/positionRisk", {"symbol": sym})
        pos = next((r for r in rows
                    if float(r.get("positionAmt", 0)) != 0), None)
        if not pos:
            return {"closed": False, "reason": "no open position"}
        amt = float(pos["positionAmt"])
        f = (await self._filters()).get(sym, {})
        qty_r = self._round_step(abs(amt), f.get("step_size") or 0) or abs(amt)
        res = await self._post("/fapi/v1/order", {
            "symbol": sym,
            "side": "SELL" if amt > 0 else "BUY",
            "type": "MARKET", "reduceOnly": "true",
            "quantity": self._fmt(qty_r, f.get("step_size") or 1e-6),
        })
        return {"closed": True, "qty": abs(amt),
                "price": float(res.get("avgPrice") or 0),
                "order_id": res.get("orderId")}
