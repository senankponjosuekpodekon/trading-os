"""
MT5 Bridge — pont HTTP → MetaTrader5 (tourne SOUS Wine, même VPS).

Architecture :
  engine ──HTTP localhost:5555──> ce service ──MetaTrader5 lib──> terminal MT5
  Sécurité : bind 127.0.0.1 uniquement + Bearer MT5_BRIDGE_TOKEN sur chaque
  requête + whitelist symboles + plafonds volume/fréquence.

Endpoints :
  GET  /health      → connecté au terminal ?
  GET  /account     → equity/marge/libre réelles du broker
  GET  /positions   → positions réelles broker (vérité pour réconciliation)
  GET  /quote/<sym> → tick exécutable courant
  POST /order       → {symbol, side, volume, sl?, tp?} → fill ou erreur
  POST /close       → {symbol} → ferme la position
  POST /close-all   → kill switch : ferme TOUT

Env : MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_BRIDGE_TOKEN,
      MT5_ALLOWED_SYMBOLS (csv), MT5_MAX_VOLUME (défaut 1.0),
      MT5_MAX_ORDERS_MIN (défaut 10)
"""
import os
import time
from flask import Flask, jsonify, request

# Sous Wine, le handshake IPC lib↔terminal reste en état "initializing"
# (-10005 IPC timeout). patch_wine_mt5 corrige le status byte en mémoire.
# No-op si le module est absent (Windows natif n'en a pas besoin).
try:
    import patch_wine_mt5  # noqa: F401
except ImportError:
    pass

import MetaTrader5 as mt5

app = Flask(__name__)

TOKEN = os.environ["MT5_BRIDGE_TOKEN"]
ALLOWED = {s.strip() for s in
           os.getenv("MT5_ALLOWED_SYMBOLS", "").split(",") if s.strip()}
MAX_VOLUME = float(os.getenv("MT5_MAX_VOLUME", "1.0"))
MAX_ORDERS_MIN = int(os.getenv("MT5_MAX_ORDERS_MIN", "10"))
_order_ts: list[float] = []


def _auth():
    return request.headers.get("Authorization") == f"Bearer {TOKEN}"


def _ensure() -> bool:
    """Init + (re)connexion au terminal si besoin.
    Sans credentials : s'attache au terminal déjà loggé (login manuel)."""
    if mt5.terminal_info() is not None and mt5.terminal_info().connected:
        return True
    mt5.shutdown()
    path = os.getenv(
        "MT5_TERMINAL_PATH",
        r"C:\Program Files\MetaTrader 5\terminal64.exe",
    )
    kw = {}
    if os.getenv("MT5_LOGIN"):
        kw = {
            "login": int(os.environ["MT5_LOGIN"]),
            "password": os.environ["MT5_PASSWORD"],
            "server": os.environ["MT5_SERVER"],
        }
    # initialize(path) démarre le terminal si besoin et établit l'IPC ;
    # sans credentials on s'attache à la session déjà loggée.
    return mt5.initialize(path, **kw) or mt5.initialize(**kw)


@app.before_request
def guard():
    if not _auth():
        return jsonify({"error": "unauthorized"}), 401
    if request.path != "/health" and not _ensure():
        return jsonify({"error": "mt5_disconnected"}), 503


@app.get("/health")
def health():
    ok = _ensure()
    info = mt5.terminal_info()
    err = mt5.last_error() if not ok else None
    return {"connected": bool(info and info.connected),
            "initialized": ok,
            "last_error": err,
            "terminal": str(info.build) if info else None}


@app.get("/account")
def account():
    a = mt5.account_info()
    return {"equity": a.equity, "balance": a.balance, "margin": a.margin,
            "margin_free": a.margin_free, "currency": a.currency,
            "leverage": a.leverage}


@app.get("/positions")
def positions():
    return jsonify([{
        "ticket": p.ticket, "symbol": p.symbol,
        "type": "BUY" if p.type == 0 else "SELL",
        "volume": p.volume, "price_open": p.price_open,
        "sl": p.sl, "tp": p.tp, "profit": p.profit,
    } for p in (mt5.positions_get() or [])])


@app.get("/quote/<symbol>")
def quote(symbol):
    t = mt5.symbol_info_tick(symbol)
    if not t or t.bid == 0:
        return {"error": "no tick"}, 404
    return {"bid": t.bid, "ask": t.ask, "time": t.time}


@app.post("/order")
def order():
    global _order_ts
    now = time.time()
    _order_ts = [t for t in _order_ts if now - t < 60]
    if len(_order_ts) >= MAX_ORDERS_MIN:
        return jsonify({"error": "rate_limited"}), 429

    b = request.get_json(force=True)
    symbol, side = b["symbol"], b["side"].upper()
    volume = float(b["volume"])
    if ALLOWED and symbol not in ALLOWED:
        return jsonify({"error": "symbol_not_allowed"}), 403
    if not 0 < volume <= MAX_VOLUME:
        return jsonify({"error": "volume_out_of_range"}), 400

    if not mt5.symbol_select(symbol, True):
        return jsonify({"error": "symbol_unavailable"}), 404
    tick = mt5.symbol_info_tick(symbol)
    price = tick.ask if side == "BUY" else tick.bid

    req = {
        "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
        "price": price, "deviation": 20,
        "magic": 20261118, "comment": "trading-os",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    if b.get("sl"):
        req["sl"] = float(b["sl"])
    if b.get("tp"):
        req["tp"] = float(b["tp"])

    res = mt5.order_send(req)
    if res.retcode != mt5.TRADE_RETCODE_DONE:
        return jsonify({"error": "order_rejected", "retcode": res.retcode,
                        "comment": res.comment}), 502
    _order_ts.append(now)
    return {"filled": True, "price": res.price, "deal": res.deal,
            "order": res.order, "volume": res.volume}


@app.post("/close")
def close():
    symbol = request.get_json(force=True)["symbol"]
    closed = []
    for p in mt5.positions_get(symbol=symbol) or []:
        tick = mt5.symbol_info_tick(symbol)
        res = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
            "volume": p.volume, "position": p.ticket,
            "type": mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
            "price": tick.bid if p.type == 0 else tick.ask,
            "deviation": 20, "magic": 20261118,
            "type_filling": mt5.ORDER_FILLING_IOC,
        })
        if res.retcode == mt5.TRADE_RETCODE_DONE:
            closed.append({"ticket": p.ticket, "price": res.price})
    return {"closed": closed}


@app.post("/close-all")
def close_all():
    out = []
    for p in mt5.positions_get() or []:
        symbol = p.symbol
        tick = mt5.symbol_info_tick(symbol)
        res = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
            "volume": p.volume, "position": p.ticket,
            "type": mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
            "price": tick.bid if p.type == 0 else tick.ask,
            "deviation": 20, "type_filling": mt5.ORDER_FILLING_IOC,
        })
        out.append({"ticket": p.ticket, "retcode": res.retcode})
    return {"results": out}


if __name__ == "__main__":
    # Bind local UNIQUEMENT : 127.0.0.1 par défaut, ou l'IP gateway docker
    # (ex. 172.17.0.1) pour que les containers y accèdent sans exposition
    # publique. Jamais 0.0.0.0.
    host = os.getenv("MT5_BIND_HOST", "127.0.0.1")
    app.run(host=host, port=int(os.getenv("MT5_BRIDGE_PORT", "5555")))
