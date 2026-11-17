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
import threading
import time
from contextlib import contextmanager
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

# La lib MetaTrader5 n'est PAS thread-safe : Flask étant threaded par
# défaut, tout appel mt5.* passe sous ce verrou — sinon deux requêtes
# concurrentes peuvent corrompre l'état IPC.
_MT5 = threading.Lock()
# acquire() SANS timeout = un order_send bloqué gèle tous les endpoints,
# /health compris. Timeout → 503 mt5_busy.
LOCK_TIMEOUT = int(os.getenv("MT5_LOCK_TIMEOUT", "45"))


class _Mt5Busy(Exception):
    pass


@contextmanager
def _locked(timeout: int = LOCK_TIMEOUT):
    if not _MT5.acquire(timeout=timeout):
        raise _Mt5Busy()
    try:
        yield
    finally:
        _MT5.release()


def _busy():
    return jsonify({"error": "mt5_busy",
                    "detail": "opération MT5 en cours — retry"}), 503


def _filling(info) -> int:
    """type_filling compatible avec le symbole — cause n°1 de rejet
    d'ordre MT5. filling_mode est un bitmask : 1=FOK, 2=IOC ; RETURN
    sinon (certains brokers n'exposent ni FOK ni IOC)."""
    fm = getattr(info, "filling_mode", 0) or 0
    if fm & 2:
        return mt5.ORDER_FILLING_IOC
    if fm & 1:
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


def _auth():
    return request.headers.get("Authorization") == f"Bearer {TOKEN}"


def _ensure() -> bool:
    """Init + (re)connexion au terminal si besoin. Toute la séquence sous
    verrou : shutdown/initialize/login ne sont pas réentrants.
    initialize() s'attache à un terminal DÉJÀ démarré et ignore alors les
    credentials — d'où le mt5.login() explicite quand connected==False."""
    with _locked(timeout=max(LOCK_TIMEOUT, 120)):  # initialize est lent
        info = mt5.terminal_info()
        if info is not None and info.connected:
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
        if not (mt5.initialize(path, **kw) or mt5.initialize(**kw)):
            return False
        info = mt5.terminal_info()
        if info is not None and info.connected:
            return True
        # Terminal attaché mais pas loggé → tentative de login explicite
        if kw:
            return bool(mt5.login(**kw))
        return False


@app.before_request
def guard():
    if not _auth():
        return jsonify({"error": "unauthorized"}), 401
    if request.path != "/health":
        try:
            if not _ensure():
                return jsonify({"error": "mt5_disconnected"}), 503
        except _Mt5Busy:
            return _busy()


@app.get("/health")
def health():
    """État complet : IPC lib↔terminal + connexion broker + compte.
    last_error exposé systématiquement — un login qui échoue sous Wine
    retourne True sans connecter ; le code d'erreur est le seul diagnostic."""
    try:
        ok = _ensure()
        with _locked():
            info = mt5.terminal_info()
            err = mt5.last_error()
            acct = mt5.account_info() if ok else None
    except _Mt5Busy:
        return _busy()
    # Critère de santé réel : last_error==(1,'Success') ne prouve rien
    # (vu sous Wine : login retourne True sans connecter). La connexion
    # est vraie quand le terminal est connecté ET qu'un compte est attaché.
    connected = bool(info and info.connected
                     and acct is not None and acct.login)
    return {
        "connected": connected,
        "initialized": ok,
        "last_error": err,
        "terminal": str(info.build) if info else None,
        "trade_allowed": bool(info.trade_allowed) if info else None,
        "account_login": acct.login if acct else None,
        "server": acct.server if acct else None,
        "balance": acct.balance if acct and connected else None,
    }


@app.get("/account")
def account():
    try:
        with _locked():
            a = mt5.account_info()
    except _Mt5Busy:
        return _busy()
    if a is None:
        return {"error": "no_account"}, 404
    return {"equity": a.equity, "balance": a.balance, "margin": a.margin,
            "margin_free": a.margin_free, "currency": a.currency,
            "leverage": a.leverage, "login": a.login, "server": a.server}


@app.get("/positions")
def positions():
    try:
        with _locked():
            pos = mt5.positions_get() or []
    except _Mt5Busy:
        return _busy()
    return jsonify([{
        "ticket": p.ticket, "symbol": p.symbol,
        "type": "BUY" if p.type == 0 else "SELL",
        "volume": p.volume, "price_open": p.price_open,
        "sl": p.sl, "tp": p.tp, "profit": p.profit,
        "magic": p.magic,
    } for p in pos])


@app.get("/quote/<symbol>")
def quote(symbol):
    try:
        with _locked():
            mt5.symbol_select(symbol, True)
            t = mt5.symbol_info_tick(symbol)
    except _Mt5Busy:
        return _busy()
    if not t or t.bid == 0:
        return {"error": "no_tick"}, 404
    return {"bid": t.bid, "ask": t.ask, "time": t.time}


@app.get("/contract/<symbol>")
def contract(symbol):
    """Spécifications broker : nécessaire à la conversion unités → lots
    côté engine (contract_size forex=100k, XAU=100oz, indices=1…)."""
    try:
        with _locked():
            if not mt5.symbol_select(symbol, True):
                return {"error": "symbol_unavailable"}, 404
            info = mt5.symbol_info(symbol)
    except _Mt5Busy:
        return _busy()
    if info is None:
        return {"error": "symbol_unavailable"}, 404
    return {"contract_size": info.trade_contract_size,
            "volume_min": info.volume_min,
            "volume_max": info.volume_max,
            "volume_step": info.volume_step,
            "digits": info.digits}


@app.post("/order")
def order():
    global _order_ts
    now = time.time()
    _order_ts = [t for t in _order_ts if now - t < 60]
    if len(_order_ts) >= MAX_ORDERS_MIN:
        return jsonify({"error": "rate_limited"}), 429
    _order_ts.append(now)  # chaque tentative compte — un ordre qui échoue
                           # en boucle ne doit pas spammer le broker

    b = request.get_json(force=True, silent=True) or {}
    try:
        symbol, side = b["symbol"], b["side"].upper()
        volume = float(b["volume"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "bad_request",
                        "detail": "attendu {symbol, side, volume}"}), 400
    if side not in ("BUY", "SELL"):
        return jsonify({"error": "bad_side", "detail": "BUY|SELL"}), 400
    if ALLOWED and symbol not in ALLOWED:
        return jsonify({"error": "symbol_not_allowed"}), 403
    if not 0 < volume <= MAX_VOLUME:
        return jsonify({"error": "volume_out_of_range"}), 400

    try:
        with _locked():
            if not mt5.symbol_select(symbol, True):
                return jsonify({"error": "symbol_unavailable"}), 404
            info = mt5.symbol_info(symbol)
            tick = mt5.symbol_info_tick(symbol)
            if not tick or tick.bid == 0 or tick.ask == 0:
                return jsonify({"error": "no_tick",
                                "detail": "pas de cotation live — marché "
                                          "fermé ou terminal non connecté"}), 503
            price = tick.ask if side == "BUY" else tick.bid

            req = {
                "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
                "volume": volume,
                "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
                "price": price, "deviation": 20,
                "magic": 20261118, "comment": "trading-os",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": _filling(info),
            }
            if b.get("sl"):
                req["sl"] = float(b["sl"])
            if b.get("tp"):
                req["tp"] = float(b["tp"])

            res = mt5.order_send(req)
    except _Mt5Busy:
        return _busy()

    if res is None:
        return jsonify({"error": "order_send_none",
                        "last_error": mt5.last_error()}), 502
    if res.retcode != mt5.TRADE_RETCODE_DONE:
        return jsonify({"error": "order_rejected", "retcode": res.retcode,
                        "comment": res.comment}), 502
    return {"filled": True, "price": res.price, "deal": res.deal,
            "order": res.order, "volume": res.volume}


@app.post("/close")
def close():
    b = request.get_json(force=True, silent=True) or {}
    symbol = b.get("symbol")
    if not symbol:
        return jsonify({"error": "bad_request", "detail": "{symbol}"}), 400
    # magic OBLIGATOIRE : sans filtre, /close fermerait aussi les
    # positions manuelles ou d'autres stratégies sur le même compte.
    magic = b.get("magic")
    if magic is None:
        return jsonify({"error": "magic_required",
                        "detail": "refusé : /close exige un filtre magic"}), 400
    closed, errors = [], []
    try:
        with _locked():
            info = mt5.symbol_info(symbol)
            for p in mt5.positions_get(symbol=symbol) or []:
                if p.magic != int(magic):
                    continue
                tick = mt5.symbol_info_tick(symbol)
                if not tick:
                    errors.append({"ticket": p.ticket, "error": "no_tick"})
                    continue
                res = mt5.order_send({
                    "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
                    "volume": p.volume, "position": p.ticket,
                    "type": mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
                    "price": tick.bid if p.type == 0 else tick.ask,
                    "deviation": 20, "magic": 20261118,
                    "type_filling": _filling(info),
                })
                if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
                    closed.append({"ticket": p.ticket, "price": res.price})
                else:
                    errors.append({"ticket": p.ticket,
                                   "retcode": res.retcode if res else None,
                                   "comment": res.comment if res else "send_none"})
    except _Mt5Busy:
        return _busy()
    return {"closed": closed, "errors": errors}


@app.post("/close-all")
def close_all():
    out = []
    try:
        with _locked():
            for p in mt5.positions_get() or []:
                symbol = p.symbol
                info = mt5.symbol_info(symbol)
                tick = mt5.symbol_info_tick(symbol)
                if not tick:
                    out.append({"ticket": p.ticket, "retcode": -1,
                                "error": "no_tick"})
                    continue
                res = mt5.order_send({
                    "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol,
                    "volume": p.volume, "position": p.ticket,
                    "type": mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
                    "price": tick.bid if p.type == 0 else tick.ask,
                    "deviation": 20, "type_filling": _filling(info),
                })
                out.append({"ticket": p.ticket,
                            "retcode": res.retcode if res else -1})
    except _Mt5Busy:
        return _busy()
    return {"results": out}


if __name__ == "__main__":
    # Bind local UNIQUEMENT : 127.0.0.1 par défaut, ou l'IP gateway docker
    # (ex. 172.17.0.1) pour que les containers y accèdent sans exposition
    # publique. Jamais 0.0.0.0.
    host = os.getenv("MT5_BIND_HOST", "127.0.0.1")
    app.run(host=host, port=int(os.getenv("MT5_BRIDGE_PORT", "5555")))
