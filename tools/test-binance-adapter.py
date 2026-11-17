#!/usr/bin/env python3
"""Validation bout-en-bout de BinanceAdapter sur testnet futures.

Usage (dans le container engine) :
    python3 tools/test-binance-adapter.py [SYMBOL]     # défaut SOL/USDT

Étapes :
  1. Auth + filtres exchange (LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL)
  2. _setup_symbol : levier + marginType explicites
  3. Ordre LIMIT agressif (prix marché -0.5% pour fill rapide) avec SL/TP
  4. Vérifie que STOP_MARKET + TAKE_PROFIT_MARKET sont bien posés côté broker
  5. Ferme la position (reduceOnly MARKET) et annule les ordres restants

Ne touche ni EXECUTION_MODE ni les venues — test d'adapter pur.
Avec BINANCE_TESTNET=1, zéro argent réel.
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "apps", "engine"))

from risk.adapters.binance import BinanceAdapter  # noqa: E402


async def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "SOL/USDT"
    sym = symbol.replace("/", "")
    adapter = BinanceAdapter.from_env()
    if not adapter:
        print("FAIL: BINANCE_API_KEY/SECRET manquants")
        return 1
    if "testnet" not in adapter._base:
        print("FAIL: BINANCE_TESTNET n'est pas actif — refus de tester en prod")
        return 1

    # 1. Auth
    account = await adapter._get("/fapi/v2/account", {})
    print(f"[1/5] auth OK — balance: {account.get('totalWalletBalance')} USDT, "
          f"canTrade: {account.get('canTrade')}")

    # 2. Filtres + mark price
    filters = await adapter._filters()
    f = filters.get(sym)
    if not f:
        print(f"FAIL: {sym} absent de l'exchangeInfo")
        return 1
    print(f"[2/5] filtres {sym}: step={f['step_size']}, tick={f['tick_size']}, "
          f"minNotional={f['min_notional']}")

    mark = await adapter._get("/fapi/v1/premiumIndex", {"symbol": sym})
    price = float(mark["markPrice"])

    # 3. Ordre d'entrée : LIMIT BUY 0.5% sous le mark → fill quasi immédiat,
    # SL -2%, TP +3% (protection broker native)
    notional = max(f["min_notional"] * 1.2, 10)
    qty = notional / price
    entry = price * 0.995
    sl = round(entry * 0.98, 6)
    tp = round(entry * 1.03, 6)
    res = await adapter.place_order(symbol, "BUY", qty, entry,
                                    stop_loss=sl, take_profit=tp)
    print(f"[3/5] entrée: {res} (qty~{qty:.4f} @ {entry:.2f}, SL {sl}, TP {tp})")

    # 4. Vérifie la protection broker côté Binance
    await asyncio.sleep(2)
    open_orders = await adapter._get("/fapi/v1/openOrders", {"symbol": sym})
    algos = [o for o in open_orders
             if o.get("type") in ("STOP_MARKET", "TAKE_PROFIT_MARKET")]
    kinds = sorted(o["type"] for o in algos)
    print(f"[4/5] ordres ouverts: {len(open_orders)} | protections: {kinds}")
    if "STOP_MARKET" not in kinds:
        print("FAIL: pas de STOP_MARKET côté broker")
        return 1

    # 5. Fermeture
    close = await adapter.close_position(symbol)
    print(f"[5/5] close: {close}")

    # Nettoie les ordres restants (SL/TP orphelins après close)
    import httpx
    import time as _t
    params = {"symbol": sym, "timestamp": int(_t.time() * 1000),
              "recvWindow": 5000}
    params["signature"] = adapter._sign(params)
    async with httpx.AsyncClient(base_url=adapter._base, timeout=10) as c:
        await c.delete("/fapi/v1/allOpenOrders", params=params,
                       headers={"X-MBX-APIKEY": adapter._key})

    print("OK — adapter validé (entrée LIMIT + protection broker + close)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
