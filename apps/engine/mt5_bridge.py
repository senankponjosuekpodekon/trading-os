"""
MT5 Bridge — Microservice Python pour connecter NestJS à MetaTrader 5.

Prérequis:
  - MetaTrader 5 terminal installé (Windows ou Wine/Linux)
  - pip install MetaTrader5 fastapi uvicorn pydantic

Démarrage:
  python mt5_bridge.py --port 8001

Le bridge se connecte à MT5 à chaque requête (stateless) pour éviter
les problèmes de session. Pour la production, envisager un pool de connexions.
"""

import argparse
import logging
from datetime import datetime
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mt5-bridge")

app = FastAPI(title="MT5 Bridge", version="1.0.0")


class Credentials(BaseModel):
    login: str
    password: str
    server: Optional[str] = None


class OrderRequest(Credentials):
    symbol: str
    volume: float
    direction: str  # "BUY" or "SELL"
    order_type: str = "ORDER_TYPE_MARKET"
    price: Optional[float] = None
    sl: Optional[float] = None
    tp: Optional[float] = None


class BalanceRequest(Credentials):
    pass


def connect_mt5(login: str, password: str, server: Optional[str] = None):
    """Initialize MT5 connection with credentials."""
    if not mt5.initialize():
        raise HTTPException(status_code=503, detail=f"MT5 initialize failed: {mt5.last_error()}")

    # Auto-detect server from common brokers if not provided
    if not server:
        login_int = int(login)
        if login_int >= 10000000:
            server = "Exness-MT5Real"
        elif login_int >= 50000000:
            server = "ICMarketsSC-MT5"
        else:
            server = "MetaQuotes-Demo"

    authorized = mt5.login(login=int(login), password=password, server=server)
    if not authorized:
        mt5.shutdown()
        raise HTTPException(status_code=401, detail=f"MT5 login failed: {mt5.last_error()}")

    return server


def disconnect_mt5():
    mt5.shutdown()


@app.post("/mt5/order")
def place_order(req: OrderRequest):
    try:
        server = connect_mt5(req.login, req.password, req.server)

        symbol_info = mt5.symbol_info(req.symbol)
        if symbol_info is None:
            raise HTTPException(status_code=400, detail=f"Symbol {req.symbol} not found")
        if not symbol_info.visible:
            if not mt5.symbol_select(req.symbol, True):
                raise HTTPException(status_code=400, detail=f"Cannot select symbol {req.symbol}")

        # Determine order type
        if req.direction.upper() == "BUY":
            trade_type = mt5.ORDER_TYPE_BUY
            price = mt5.symbol_info_tick(req.symbol).ask
        else:
            trade_type = mt5.ORDER_TYPE_SELL
            price = mt5.symbol_info_tick(req.symbol).bid

        if req.order_type == "ORDER_TYPE_BUY_LIMIT" and req.price:
            trade_type = mt5.ORDER_TYPE_BUY_LIMIT
            price = req.price
        elif req.order_type == "ORDER_TYPE_SELL_LIMIT" and req.price:
            trade_type = mt5.ORDER_TYPE_SELL_LIMIT
            price = req.price

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": req.symbol,
            "volume": float(req.volume),
            "type": trade_type,
            "price": price,
            "deviation": 20,
            "magic": 234000,
            "comment": "trading-os",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        if req.sl:
            request["sl"] = float(req.sl)
        if req.tp:
            request["tp"] = float(req.tp)

        result = mt5.order_send(request)

        if result is None:
            raise HTTPException(status_code=400, detail=f"order_send returned None: {mt5.last_error()}")

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            raise HTTPException(
                status_code=400,
                detail=f"Order failed: retcode={result.retcode}, comment={result.comment}",
            )

        broker = server or "unknown"

        return {
            "ticket": result.order,
            "price": result.price,
            "volume": result.volume,
            "status": "FILLED",
            "broker": broker,
            "timestamp": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Order error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        disconnect_mt5()


@app.post("/mt5/balance")
def get_balance(req: BalanceRequest):
    try:
        connect_mt5(req.login, req.password, req.server)

        account = mt5.account_info()
        if account is None:
            raise HTTPException(status_code=400, detail="Cannot get account info")

        return {
            "balance": account.balance,
            "equity": account.equity,
            "currency": account.currency,
            "margin": account.margin,
            "free_margin": account.margin_free,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Balance error: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        disconnect_mt5()


@app.post("/mt5/validate")
def validate_credentials(req: Credentials):
    try:
        connect_mt5(req.login, req.password, req.server)
        account = mt5.account_info()
        return {"valid": account is not None, "login": req.login}
    except HTTPException:
        return {"valid": False}
    finally:
        disconnect_mt5()


@app.get("/health")
def health():
    return {"status": "ok", "mt5_available": mt5.initialize() and mt5.shutdown() or False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MT5 Bridge microservice")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    args = parser.parse_args()

    logger.info(f"Starting MT5 Bridge on {args.host}:{args.port}")
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
