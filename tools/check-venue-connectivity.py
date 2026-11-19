import argparse
import getpass
import hashlib
import hmac
import json
import os
import re
import sys
import time
import warnings
from datetime import datetime, timezone
from functools import partial
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

BINANCE = {
    "spot": ("https://demo-api.binance.com", "/api/v3/time", "/api/v3/account", "/api/v3/openOrders"),
    "futures": ("https://demo-fapi.binance.com", "/fapi/v1/time", "/fapi/v3/account", "/fapi/v1/openOrders"),
}
SOLANA = {"mainnet": "https://api.mainnet-beta.solana.com", "devnet": "https://api.devnet.solana.com"}
RPC_READ_METHODS = {"getHealth", "getGenesisHash", "getBalance"}
DERIV_HOSTS = {"api.derivws.com", "staging-api.derivws.com"}
DERIV_READ_PATH = "/trading/v1/options/accounts"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_json(url, *, headers=None, data=None):
    parsed = urlsplit(url)
    allowed = {(urlsplit(base).netloc, path) for base, *paths in BINANCE.values() for path in paths}
    allowed |= {(host, DERIV_READ_PATH) for host in DERIV_HOSTS}
    is_rpc = parsed.netloc in {urlsplit(base).netloc for base in SOLANA.values()} and parsed.path in ("", "/")
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("invalid_read_target")
    if is_rpc:
        if not isinstance(data, dict) or data.get("method") not in RPC_READ_METHODS or headers or parsed.query:
            raise ValueError("invalid_rpc_read")
    elif (parsed.netloc, parsed.path) not in allowed or data is not None:
        raise ValueError("invalid_read_target")
    payload = json.dumps(data).encode() if data is not None else None
    req = Request(url, data=payload, headers={"Accept": "application/json", "Content-Type": "application/json", **(headers or {})}, method="POST" if is_rpc else "GET")
    with build_opener(NoRedirect()).open(req, timeout=10) as response:
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("oversized_response")
        return json.loads(body)


def check_binance(market, credentials=None):
    base, clock, account, open_orders = BINANCE[market]
    started = time.time() * 1000
    server_time = read_json(base + clock).get("serverTime")
    if not isinstance(server_time, int) or server_time <= 0:
        raise ValueError("invalid_server_time")
    result = {"venue": f"binance-{market}-demo", "host": urlsplit(base).netloc,
              "status": "PUBLIC_READY", "executionEnabled": False,
              "clockSkewMs": round(server_time - (started + time.time() * 1000) / 2)}
    if credentials is None:
        return result
    key, secret = credentials
    if not key or not secret:
        raise ValueError("missing_demo_credentials")

    def signed_get(path, params=None):
        query = urlencode({"timestamp": server_time, "recvWindow": 5000, **(params or {})})
        signature = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        return read_json(f"{base}{path}?{query}&signature={signature}", headers={"X-MBX-APIKEY": key})

    response = signed_get(account)
    if not isinstance(response, dict) or "code" in response:
        raise ValueError("invalid_account_response")
    field = "balances" if market == "spot" else "assets"
    rows = response.get(field)
    if not isinstance(rows, list):
        raise TypeError("invalid_account_response")
    can_trade = response.get("canTrade")
    result.update(status="AUTHENTICATED_READ_ONLY", assetCount=len(rows), canTrade=can_trade if isinstance(can_trade, bool) else None)

    def non_zero(value):
        try:
            return float(value) != 0
        except (TypeError, ValueError):
            return False

    if market == "spot":
        result["balances"] = [{"asset": r.get("asset"), "free": r.get("free"), "locked": r.get("locked")}
                              for r in rows[:500] if isinstance(r, dict) and (non_zero(r.get("free")) or non_zero(r.get("locked")))]
    else:
        result["balances"] = [{"asset": r.get("asset"), "walletBalance": r.get("walletBalance"),
                               "unrealizedProfit": r.get("unrealizedProfit")}
                              for r in rows[:500] if isinstance(r, dict) and (non_zero(r.get("walletBalance")) or non_zero(r.get("unrealizedProfit")))]
        positions = response.get("positions")
        if not isinstance(positions, list):
            raise TypeError("invalid_account_response")
        result["positions"] = [{"symbol": p.get("symbol"), "positionAmt": p.get("positionAmt"),
                                "entryPrice": p.get("entryPrice"), "unrealizedProfit": p.get("unrealizedProfit")}
                               for p in positions[:500] if isinstance(p, dict) and non_zero(p.get("positionAmt"))]

    orders = signed_get(open_orders)
    if not isinstance(orders, list):
        raise TypeError("invalid_open_orders_response")
    result["openOrders"] = [{"symbol": o.get("symbol"), "side": o.get("side"), "type": o.get("type"),
                             "status": o.get("status"), "price": o.get("price"), "origQty": o.get("origQty")}
                            for o in orders[:200] if isinstance(o, dict)]
    return result


def check_solana(network, address=None):
    if address and not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", address):
        raise ValueError("invalid_public_address")
    base = SOLANA[network]

    def rpc(method, params=None):
        response = read_json(base, data={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []})
        if not isinstance(response, dict) or "error" in response or "result" not in response:
            raise ValueError("rpc_read_failed")
        return response["result"]

    if rpc("getHealth") != "ok":
        raise ValueError("rpc_not_healthy")
    genesis = rpc("getGenesisHash")
    if not isinstance(genesis, str) or not genesis:
        raise ValueError("invalid_genesis")
    result = {"venue": f"solana-{network}", "status": "PUBLIC_READY", "executionEnabled": False, "genesisHash": genesis}
    if address:
        balance = rpc("getBalance", [address, {"commitment": "finalized"}])
        lamports = balance.get("value") if isinstance(balance, dict) else None
        if not isinstance(lamports, int) or isinstance(lamports, bool) or lamports < 0:
            raise ValueError("invalid_balance")
        result.update(balanceSol=lamports / 1_000_000_000)
    return result


def check_deriv(app_id, token, expected_account=None, base_url="https://api.derivws.com"):
    """Read-only Deriv preflight on the Options REST API.

    A single GET /trading/v1/options/accounts authenticates the PAT and the
    registered Deriv-App-ID and returns account types and balances. The URL
    allowlist admits only this path on Deriv hosts, in GET, so no order or
    write call can leave this process. Credentials come from the environment
    and are never echoed back.
    """
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", app_id or ""):
        raise ValueError("invalid_app_id")
    if not token:
        raise ValueError("missing_api_token")

    parsed = urlsplit(base_url)
    if parsed.scheme != "https" or parsed.netloc not in DERIV_HOSTS or parsed.username or parsed.password or parsed.path not in ("", "/"):
        raise ValueError("invalid_read_target")

    response = read_json(
        f"https://{parsed.netloc}{DERIV_READ_PATH}",
        headers={"Authorization": f"Bearer {token}", "Deriv-App-ID": app_id},
    )
    accounts = response.get("data") if isinstance(response, dict) else None
    if not isinstance(accounts, list):
        raise TypeError("invalid_accounts_response")

    def mask(account_id):
        return f"***{str(account_id)[-4:]}" if account_id else None

    rows = []
    for account in accounts[:50]:
        if not isinstance(account, dict):
            raise TypeError("invalid_accounts_response")
        rows.append({
            "accountIdSuffix": mask(account.get("account_id")),
            "accountType": account.get("account_type"),
            "status": account.get("status"),
            "balance": account.get("balance"),
            "currency": account.get("currency"),
        })

    ids = {str(a.get("account_id")) for a in accounts if isinstance(a, dict)}
    result = {
        "venue": "deriv-options-api",
        "host": parsed.netloc,
        "status": "AUTHENTICATED_READ_ONLY",
        "executionEnabled": False,
        "accountCount": len(rows),
        "accounts": rows,
    }
    demo = [a for a in accounts if isinstance(a, dict) and a.get("account_type") == "demo"]
    if not demo:
        result["warning"] = "no demo account returned by the token"
    if expected_account:
        result["expectedAccountPresent"] = str(expected_account) in ids
        if not result["expectedAccountPresent"]:
            result["warning"] = "configured DERIV_ACCOUNT_ID not visible under this token"
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only connectivity checks: Binance Demo and Solana. No execution adapters or private wallet keys are loaded.")
    parser.add_argument("--binance", choices=["spot", "futures", "both", "none"], default="both")
    parser.add_argument("--authenticate", action="store_true", help="Prompt for newly rotated Binance Demo credentials without saving them (interactive terminal only).")
    parser.add_argument("--solana", choices=["none", "mainnet", "devnet"], default="none")
    parser.add_argument("--solana-address", help="Public address only. Never supply a private key.")
    parser.add_argument("--deriv", action="store_true", help="Read-only Deriv WebSocket preflight using DERIV_APP_ID/DERIV_API_TOKEN/DERIV_ACCOUNT_ID from the environment only.")
    args = parser.parse_args(argv)
    if args.solana_address and args.solana == "none":
        parser.error("--solana is required with a public address")
    if args.deriv:
        app_id = os.environ.get("DERIV_APP_ID", "")
        token = os.environ.get("DERIV_API_TOKEN", "")
        expected = os.environ.get("DERIV_ACCOUNT_ID") or None
        if not app_id or not token:
            parser.error("--deriv requires DERIV_APP_ID and DERIV_API_TOKEN in the environment")
    if args.authenticate and (not sys.stdin.isatty() or args.binance == "none"):
        parser.error("Authentication requires Binance Demo selection and an interactive terminal")
    checks = []
    failed = False

    def check(venue, callback):
        nonlocal failed
        try:
            checks.append(callback())
        except (OSError, ValueError, TypeError) as error:
            failed = True
            reason = f"HTTP_{error.code}" if isinstance(error, HTTPError) else "READ_FAILED"
            checks.append({"venue": venue, "status": "UNAVAILABLE", "reason": reason, "executionEnabled": False})

    markets = ["spot", "futures"] if args.binance == "both" else [] if args.binance == "none" else [args.binance]
    for market in markets:
        credentials = None
        if args.authenticate:
            print(f"{market.upper()} DEMO: use newly rotated keys only. Values are not saved.", file=sys.stderr)
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                try:
                    credentials = (getpass.getpass("Demo API key: "), getpass.getpass("Demo secret: "))
                except getpass.GetPassWarning:
                    parser.error("Masked terminal unavailable; refusing credential input")
        check(f"binance-{market}-demo", partial(check_binance, market, credentials))
        credentials = None
    if args.solana != "none":
        check(f"solana-{args.solana}", lambda: check_solana(args.solana, args.solana_address))
    if args.deriv:
        check("deriv-options-api", lambda: check_deriv(app_id, token, expected))
    print(json.dumps({"checkedAt": datetime.now(timezone.utc).isoformat(), "mode": "READ_ONLY", "checks": checks}, indent=2))
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
