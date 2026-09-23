"""Copilot tools — function calling pour le chat LLM.

Donne au copilot un accès en LECTURE aux données live de la plateforme
(signaux, prix, régime, stats) au lieu du seul dernier signal figé.
Chaque tool retourne un dict sérialisable injecté comme message 'tool'.
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional

from utils.logger import get_logger
from utils.db_pool import get_shared_pool

logger = get_logger(__name__)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_market_price",
            "description": "Prix actuel d'un actif et sa variation sur 24h. Symboles au format 'BTC/USDT', 'XAU/USD', 'EUR/USD'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Symbole, ex: BTC/USDT"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_latest_signals",
            "description": "Les derniers signaux de trading générés (direction, confiance, entry, SL, TP, statut).",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Nombre max de signaux (défaut 5, max 20)"},
                    "symbol": {"type": "string", "description": "Filtrer par symbole, ex: BTC/USDT (optionnel)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_signal_details",
            "description": "Détail complet d'un signal par son ID : niveaux, événements d'exécution (ENTRY_HIT, TP_HIT, SL_HIT), PnL final.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_id": {"type": "string", "description": "ID du signal"},
                },
                "required": ["signal_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_market_regime",
            "description": "Régime de volatilité actuel du marché (LOW/NORMAL/HIGH) calculé par le classifieur HMM.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Symbole (défaut BTC/USDT)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_signal_stats",
            "description": "Statistiques de performance des signaux : wins, losses, expirations, winrate.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_portfolio",
            "description": "Portfolio de l'utilisateur connecté : capital, positions ouvertes (symbole, direction, entry, qty, PnL).",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


async def run_tool(name: str, arguments_json: str, ctx: Optional[Dict[str, Any]] = None) -> str:
    """Exécute un tool et retourne le résultat sérialisé (string) pour le LLM."""
    try:
        args = json.loads(arguments_json) if arguments_json else {}
    except json.JSONDecodeError:
        args = {}
    try:
        if name == "get_market_price":
            result = await _get_market_price(args.get("symbol", ""))
        elif name == "get_latest_signals":
            result = await _get_latest_signals(args.get("limit", 5), args.get("symbol"))
        elif name == "get_signal_details":
            result = await _get_signal_details(args.get("signal_id", ""))
        elif name == "get_market_regime":
            result = await _get_market_regime(args.get("symbol", "BTC/USDT"))
        elif name == "get_signal_stats":
            result = await _get_signal_stats()
        elif name == "get_portfolio":
            # user_id vient du ctx injecté serveur-side — jamais des args LLM
            uid = (ctx or {}).get("user_id")
            if not uid:
                result = {"error": "utilisateur non identifié"}
            else:
                result = await _get_portfolio(uid)
        else:
            result = {"error": f"unknown tool {name}"}
    except Exception as exc:
        logger.warning("llm_tool_failed", tool=name, error=str(exc))
        result = {"error": str(exc)}
    return json.dumps(result, default=str, ensure_ascii=False)


async def _get_market_price(symbol: str) -> Dict[str, Any]:
    # Crypto → Binance 24hr ticker (live, inclut la variation 24h)
    if "/" in symbol:
        base, quote = symbol.split("/", 1)
        if quote.upper() in ("USDT", "USD", "BTC", "ETH"):
            try:
                import httpx
                async with httpx.AsyncClient(timeout=8) as client:
                    r = await client.get(
                        "https://api.binance.com/api/v3/ticker/24hr",
                        params={"symbol": f"{base.upper()}{'USDT' if quote.upper() == 'USD' else quote.upper()}"},
                    )
                    r.raise_for_status()
                    d = r.json()
                return {
                    "symbol": symbol,
                    "price": float(d["lastPrice"]),
                    "change_24h_pct": round(float(d["priceChangePercent"]), 2),
                    "high_24h": float(d["highPrice"]),
                    "low_24h": float(d["lowPrice"]),
                    "source": "binance",
                }
            except Exception:
                pass  # fallback DB candles

    # Fallback multi-marchés : fetchers engine (TwelveData/yfinance/Deriv)
    # → prix live pour forex, métaux, synthétiques — pas la DB stale.
    try:
        from routers.scan_fetchers import fetch_klines_fallback
        df = await fetch_klines_fallback(symbol, "1h", limit=5)
        if df is not None and not df.empty:
            last = df.iloc[-1]
            first = df.iloc[0]
            change = round((float(last["close"]) - float(first["close"])) / float(first["close"]) * 100, 2)
            return {
                "symbol": symbol,
                "price": float(last["close"]),
                "change_pct": change,
                "asof": str(last["time"]),
                "source": "engine_fetchers",
            }
    except Exception:
        pass

    # Dernier recours : dernière bougie en DB (peut être stale)
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT close, open_time FROM candles
               WHERE symbol = $1 ORDER BY open_time DESC LIMIT 1""",
            symbol,
        )
    if not row:
        return {"error": f"pas de données pour {symbol}"}
    return {"symbol": symbol, "price": float(row["close"]), "asof": str(row["open_time"]), "source": "candles_db", "stale": True}


async def _get_latest_signals(limit: int, symbol: Optional[str]) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 5), 20))
    pool = await get_shared_pool()
    where = "WHERE a.symbol = $2" if symbol else ""
    params: list = [limit]
    if symbol:
        params.append(symbol)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""SELECT s.id, a.symbol, s.signal, s.confidence, s.timeframe,
                       s."entryPrice", s."stopLoss", s."takeProfit1",
                       s.execution_status, s."createdAt"
                FROM signals s JOIN assets a ON a.id = s."assetId"
                {where}
                ORDER BY s."createdAt" DESC LIMIT $1""",
            *params,
        )
    return {
        "count": len(rows),
        "signals": [
            {
                "id": r["id"], "symbol": r["symbol"], "signal": r["signal"],
                "confidence": r["confidence"], "timeframe": r["timeframe"],
                "entry": float(r["entryPrice"]) if r["entryPrice"] else None,
                "stop_loss": float(r["stopLoss"]) if r["stopLoss"] else None,
                "tp1": float(r["takeProfit1"]) if r["takeProfit1"] else None,
                "execution_status": r["execution_status"],
                "created_at": str(r["createdAt"]),
            }
            for r in rows
        ],
    }


async def _get_signal_details(signal_id: str) -> Dict[str, Any]:
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        sig = await conn.fetchrow(
            """SELECT s.id, a.symbol, s.signal, s.confidence, s.timeframe,
                      s."entryPrice", s."stopLoss", s."takeProfit1", s."takeProfit2",
                      s.execution_status, s.final_pnl_pct, s."createdAt", s."expiresAt"
               FROM signals s JOIN assets a ON a.id = s."assetId"
               WHERE s.id = $1""",
            signal_id,
        )
        if not sig:
            return {"error": "signal introuvable"}
        events = await conn.fetch(
            """SELECT type, price, candle_time FROM signal_execution_events
               WHERE signal_id = $1 ORDER BY candle_time""",
            signal_id,
        )
    return {
        "id": sig["id"], "symbol": sig["symbol"], "signal": sig["signal"],
        "confidence": sig["confidence"], "timeframe": sig["timeframe"],
        "entry": float(sig["entryPrice"]) if sig["entryPrice"] else None,
        "stop_loss": float(sig["stopLoss"]) if sig["stopLoss"] else None,
        "tp1": float(sig["takeProfit1"]) if sig["takeProfit1"] else None,
        "tp2": float(sig["takeProfit2"]) if sig["takeProfit2"] else None,
        "execution_status": sig["execution_status"],
        "final_pnl_pct": float(sig["final_pnl_pct"]) if sig["final_pnl_pct"] else None,
        "created_at": str(sig["createdAt"]),
        "events": [
            {"type": e["type"], "price": float(e["price"]), "at": str(e["candle_time"])}
            for e in events
        ],
    }


async def _get_market_regime(symbol: str) -> Dict[str, Any]:
    # Bougies daily live via les fetchers multi-provider (DB candles trop sparse)
    try:
        from routers.scan_fetchers import fetch_klines_fallback
        df = await fetch_klines_fallback(symbol, "1d", limit=200)
    except Exception:
        df = None
    if df is None or len(df) < 20:
        return {"error": f"pas assez de données daily pour {symbol}"}
    prices = df["close"].astype(float).tolist()
    from routers.ml_regime import classifier
    if not classifier.model:
        return {"regime": "unknown", "detail": "modèle non entraîné"}
    regimes = classifier.predict(prices)
    counts: Dict[str, int] = {}
    for r in regimes[-30:]:
        counts[r] = counts.get(r, 0) + 1
    return {"symbol": symbol, "regime": regimes[-1], "last_30d": counts}


async def _get_portfolio(user_id: str) -> Dict[str, Any]:
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        portfolios = await conn.fetch(
            """SELECT id, name, type, currency, "initialCapital", "currentCapital"
               FROM portfolios WHERE "userId" = $1""",
            user_id,
        )
        if not portfolios:
            return {"portfolios": [], "detail": "aucun portfolio"}
        positions = await conn.fetch(
            """SELECT p.id, a.symbol, p.direction, p.status, p."entryPrice",
                      p.quantity, p.pnl, p."pnlPercent", pf.name AS portfolio_name
               FROM positions p
               JOIN portfolios pf ON pf.id = p."portfolioId"
               JOIN assets a ON a.id = p."assetId"
               WHERE pf."userId" = $1 AND p.status = 'OPEN'""",
            user_id,
        )
    return {
        "portfolios": [
            {
                "name": p["name"], "type": p["type"], "currency": p["currency"],
                "capital": float(p["currentCapital"]),
                "initial_capital": float(p["initialCapital"]),
            }
            for p in portfolios
        ],
        "open_positions": [
            {
                "symbol": r["symbol"], "direction": r["direction"],
                "entry": float(r["entryPrice"]), "quantity": float(r["quantity"]),
                "pnl": float(r["pnl"]) if r["pnl"] else None,
                "pnl_pct": r["pnlPercent"],
                "portfolio": r["portfolio_name"],
            }
            for r in positions
        ],
    }


async def _get_signal_stats() -> Dict[str, Any]:
    pool = await get_shared_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT execution_status, count(*) AS n FROM signals GROUP BY execution_status"
        )
        pnl = await conn.fetchrow(
            """SELECT count(*) FILTER (WHERE final_pnl_pct > 0) AS wins,
                      count(*) FILTER (WHERE final_pnl_pct <= 0) AS losses,
                      round(avg(final_pnl_pct)::numeric, 2) AS avg_pnl
               FROM signals WHERE final_pnl_pct IS NOT NULL"""
        )
    stats = {r["execution_status"]: r["n"] for r in rows}
    wins = stats.get("CLOSED_WIN", 0)
    losses = stats.get("CLOSED_LOSS", 0)
    total_closed = wins + losses
    return {
        "by_status": stats,
        "winrate_pct": round(wins / total_closed * 100, 1) if total_closed else None,
        "avg_pnl_pct": float(pnl["avg_pnl"]) if pnl and pnl["avg_pnl"] is not None else None,
    }
