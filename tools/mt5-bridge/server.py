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
import math
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
    import hmac
    return hmac.compare_digest(
        request.headers.get("Authorization", ""), f"Bearer {TOKEN}")


def _account_mode(acct):
    return {0: "DEMO", 1: "CONTEST", 2: "REAL"}.get(
        getattr(acct, "trade_mode", None), "UNKNOWN")


def _identity_matches(acct):
    login = os.getenv("MT5_EXPECTED_LOGIN", os.getenv("MT5_LOGIN", ""))
    server = os.getenv("MT5_EXPECTED_SERVER", os.getenv("MT5_SERVER", ""))
    return bool(acct and login and server
                and str(acct.login) == login and acct.server == server)


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
    if request.method != "GET" and os.getenv("MT5_READ_ONLY", "1") != "0":
        return jsonify({"error": "read_only"}), 403
    if request.path != "/health":
        try:
            if not _ensure():
                return jsonify({"error": "mt5_disconnected"}), 503
            with _locked():
                if not _identity_matches(mt5.account_info()):
                    return jsonify({"error": "account_identity_mismatch"}), 503
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
        "identity_matches": _identity_matches(acct),
        "read_only": os.getenv("MT5_READ_ONLY", "1") != "0",
        "ready_for_read": connected and _identity_matches(acct),
        "initialized": ok,
        "last_error": err,
        "terminal": str(info.build) if info else None,
        "trade_allowed": bool(info.trade_allowed) if info else None,
        "account_login": acct.login if acct else None,
        "account_mode": _account_mode(acct),
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
            "leverage": a.leverage, "login": a.login, "server": a.server,
            "account_mode": _account_mode(a)}


@app.get("/positions")
def positions():
    try:
        with _locked():
            pos = mt5.positions_get()
            if pos is None:
                return {"error": "positions_unavailable"}, 503
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
    import math
    if not t or not all(math.isfinite(v) and v > 0 for v in (t.bid, t.ask)) or t.ask < t.bid:
        return {"error": "no_tick"}, 404
    age = time.time() - t.time
    if not math.isfinite(age) or age < -5 or age > 60:
        return {"error": "stale_tick"}, 503
    return {"bid": t.bid, "ask": t.ask, "time": t.time}


class _ReadUnavailable(Exception):
    def __init__(self, reason, broker_code=None):
        self.reason = reason
        self.broker_code = broker_code


def _now():
    return datetime.now(timezone.utc)


def _demo_account():
    terminal = mt5.terminal_info()
    acct = mt5.account_info()
    if not terminal or not terminal.connected or not _identity_matches(acct) or _account_mode(acct) != "DEMO":
        raise _ReadUnavailable("demo_account_not_ready")
    return acct


def _read_result(value, reason):
    if value is None:
        error = mt5.last_error()
        code = error[0] if isinstance(error, (tuple, list)) and error and type(error[0]) is int else None
        raise _ReadUnavailable(reason, code)
    return value


def _read_options():
    allowed = {"from", "to", "limit", "offset"}
    if set(request.args) - allowed or any(len(request.args.getlist(key)) != 1 for key in request.args):
        raise ValueError()
    limit = int(request.args.get("limit", "100"))
    offset = int(request.args.get("offset", "0"))
    if not 1 <= limit <= 200 or not 0 <= offset <= 1000000:
        raise ValueError()
    now = _now()
    if bool(request.args.get("from")) != bool(request.args.get("to")):
        raise ValueError()
    if "from" in request.args or "to" in request.args:
        start = datetime.fromisoformat(request.args["from"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(request.args["to"].replace("Z", "+00:00"))
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError()
        start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    else:
        end, start = now, now - timedelta(days=7)
    if start >= end or end - start > timedelta(days=31) or end > now + timedelta(seconds=5):
        raise ValueError()
    return start, end, limit, offset


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError()
    return value


def _integer(value, minimum=0):
    if type(value) is not int or value < minimum:
        raise ValueError()
    return value


def _record(row, deal=False):
    ids = ("ticket", "order", "position_id", "magic") if deal else ("ticket", "position_id", "magic")
    integers = ("type", "entry", "time_msc", "reason") if deal else (
        "type", "state", "time_setup_msc", "time_done_msc", "time_expiration", "type_time", "type_filling", "reason")
    numbers = ("volume", "price", "commission", "swap", "profit", "fee") if deal else (
        "volume_initial", "volume_current", "price_open", "price_current", "price_stoplimit", "sl", "tp")
    item = {key: str(_integer(getattr(row, key), -(2**63) if key == "magic" else 1 if key == "ticket" else 0)) for key in ids}
    item.update({key: _integer(getattr(row, key)) for key in integers})
    item.update({key: _number(getattr(row, key)) for key in numbers})
    if not isinstance(row.symbol, str) or len(row.symbol) > 128:
        raise ValueError()
    return {**item, "symbol": row.symbol}


def _page(rows, limit, offset, kind):
    if not isinstance(rows, (tuple, list)):
        raise ValueError()
    def sort_key(row):
        stamp = row.time_msc if kind == "deals" else row.time_done_msc or row.time_setup_msc
        return stamp, row.ticket
    ordered = sorted(rows, key=sort_key, reverse=True)
    next_offset = offset + limit if offset + limit < len(ordered) else None
    return {"items": [_record(row, kind == "deals") for row in ordered[offset:offset + limit]],
            "total": len(ordered), "limit": limit, "offset": offset, "next_offset": next_offset}


def _contract_data(info):
    numbers = {"contract_size": "trade_contract_size", "volume_min": "volume_min", "volume_max": "volume_max",
               "volume_step": "volume_step", "point": "point", "tick_size": "trade_tick_size",
               "tick_value": "trade_tick_value", "tick_value_profit": "trade_tick_value_profit",
               "tick_value_loss": "trade_tick_value_loss", "margin_initial": "margin_initial",
               "margin_maintenance": "margin_maintenance", "volume_limit": "volume_limit"}
    integers = {"digits": "digits", "stops_level": "trade_stops_level", "freeze_level": "trade_freeze_level",
                "trade_calc_mode": "trade_calc_mode", "trade_mode": "trade_mode", "filling_mode": "filling_mode"}
    data = {key: _number(getattr(info, attr)) for key, attr in numbers.items()}
    if any(value < 0 for value in data.values()) or any(data[key] <= 0 for key in ("contract_size", "volume_min", "volume_max", "volume_step", "point")):
        raise ValueError()
    if data["volume_min"] > data["volume_max"] or data["volume_step"] > data["volume_max"]:
        raise ValueError()
    data.update({key: _integer(getattr(info, attr)) for key, attr in integers.items()})
    for key in ("currency_base", "currency_profit", "currency_margin"):
        value = getattr(info, key)
        if not isinstance(value, str) or not value or len(value) > 16:
            raise ValueError()
        data[key] = value
    return data


def _broker_read(kind):
    try:
        start, end, limit, offset = _read_options()
    except (ValueError, OverflowError, KeyError):
        return {"error": "invalid_read_query"}, 400
    try:
        with _locked():
            acct = _demo_account()
            if not isinstance(acct.currency, str) or not acct.currency or len(acct.currency) > 16:
                raise ValueError()
            data = {"account_login": acct.login, "server": acct.server, "account_mode": "DEMO", "currency": acct.currency}
            window = {"from": start.isoformat(), "to": end.isoformat()}
            if kind in ("pending_orders", "activity"):
                rows = _read_result(mt5.orders_get(), "orders_unavailable")
                page = _page(rows, limit, offset, "orders")
                if kind == "activity": data["pending_orders"] = page
                else: data.update(page)
            if kind in ("history_orders", "activity"):
                rows = _read_result(mt5.history_orders_get(start, end), "history_orders_unavailable")
                page = _page(rows, limit, offset, "orders")
                if kind == "activity": data["history_orders"] = page
                else: data.update(page)
                data["range"] = window
            if kind in ("deals", "activity"):
                rows = _read_result(mt5.history_deals_get(start, end), "deals_unavailable")
                page = _page(rows, limit, offset, "deals")
                if kind == "activity": data["deals"] = page
                else: data.update(page)
                data["range"] = window
            if kind == "activity":
                if not mt5.symbol_select("EURUSD", True):
                    raise _ReadUnavailable("symbol_unavailable")
                info = _read_result(mt5.symbol_info("EURUSD"), "contract_unavailable")
                data["contract"] = {"symbol": "EURUSD", **_contract_data(info)}
            try:
                current = _demo_account()
            except _ReadUnavailable:
                raise _ReadUnavailable("account_changed") from None
            if (current.login, current.server) != (acct.login, acct.server):
                raise _ReadUnavailable("account_changed")
            return {**data, "checked_at": _now().isoformat()}
    except _Mt5Busy:
        return _busy()
    except _ReadUnavailable as error:
        return {"error": error.reason, "broker_error_code": error.broker_code, "checked_at": _now().isoformat()}, 503
    except (ValueError, TypeError, AttributeError, OverflowError):
        return {"error": "invalid_broker_data", "checked_at": _now().isoformat()}, 503


@app.get("/orders")
def pending_orders():
    return _broker_read("pending_orders")


@app.get("/history/orders")
def history_orders():
    return _broker_read("history_orders")


@app.get("/history/deals")
def history_deals():
    return _broker_read("deals")


@app.get("/activity")
def activity():
    return _broker_read("activity")


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
    try:
        return _contract_data(info)
    except (ValueError, TypeError, AttributeError, OverflowError):
        return {"error": "invalid_broker_data"}, 503


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
            pos = mt5.positions_get(symbol=symbol)
            if pos is None:
                # None = échec de lecture MT5, pas "aucune position" —
                # un kill switch ne doit pas rapporter "rien fermé"
                # alors que la lecture a échoué.
                return jsonify({"error": "positions_unavailable",
                                "detail": f"positions_get {symbol} -> None"}), 503
            info = mt5.symbol_info(symbol)
            for p in pos:
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
            pos = mt5.positions_get()
            if pos is None:
                return jsonify({"error": "positions_unavailable"}), 503
            for p in pos:
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


@app.post("/modify")
def modify():
    """Modifie SL/TP des positions {symbol} filtrées par magic (obligatoire,
    même règle que /close — jamais de modification hors de nos ordres).
    Body : {symbol, magic, sl?, tp?} — au moins sl ou tp requis."""
    b = request.get_json(force=True, silent=True) or {}
    symbol = b.get("symbol")
    magic = b.get("magic")
    if not symbol or magic is None:
        return jsonify({"error": "bad_request",
                        "detail": "attendu {symbol, magic, sl?|tp?}"}), 400
    if b.get("sl") is None and b.get("tp") is None:
        return jsonify({"error": "bad_request",
                        "detail": "sl ou tp requis"}), 400
    modified, errors = [], []
    try:
        with _locked():
            for p in mt5.positions_get(symbol=symbol) or []:
                if p.magic != int(magic):
                    continue
                req = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "symbol": symbol,
                    "position": p.ticket,
                    "sl": float(b["sl"]) if b.get("sl") is not None else p.sl,
                    "tp": float(b["tp"]) if b.get("tp") is not None else p.tp,
                    "magic": 20261118,
                }
                res = mt5.order_send(req)
                if res is not None and res.retcode == mt5.TRADE_RETCODE_DONE:
                    modified.append({"ticket": p.ticket,
                                     "sl": req["sl"], "tp": req["tp"]})
                else:
                    errors.append({"ticket": p.ticket,
                                   "retcode": res.retcode if res else None,
                                   "comment": res.comment if res else "send_none"})
    except _Mt5Busy:
        return _busy()
    return {"modified": modified, "errors": errors}


if __name__ == "__main__":
    # Bind local UNIQUEMENT : 127.0.0.1 par défaut, ou l'IP gateway docker
    # (ex. 172.17.0.1) pour que les containers y accèdent sans exposition
    # publique. Jamais 0.0.0.0.
    host = os.getenv("MT5_BIND_HOST", "127.0.0.1")
    app.run(host=host, port=int(os.getenv("MT5_BRIDGE_PORT", "5555")))
