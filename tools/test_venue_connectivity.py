import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("venue_check", Path(__file__).with_name("check-venue-connectivity.py"))
venue_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(venue_check)


class ConnectivityTests(unittest.TestCase):
    def test_binance_targets_only_distinct_demo_hosts(self):
        with patch.object(venue_check, "read_json", return_value={"serverTime": 1700000000000}) as read:
            for market, host in [("spot", "demo-api.binance.com"), ("futures", "demo-fapi.binance.com")]:
                result = venue_check.check_binance(market)
                self.assertEqual(result["status"], "PUBLIC_READY")
                self.assertIn(host, read.call_args.args[0])
                self.assertIsNone(result.get("account"))

    def test_authenticated_reads_never_place_orders_or_return_credentials(self):
        responses = [{"serverTime": 1700000000000},
                     {"canTrade": True, "balances": [{"asset": "USDT", "free": "100", "locked": "0"},
                                                     {"asset": "BTC", "free": "0", "locked": "0"}]},
                     [{"symbol": "ETHUSDT", "side": "BUY", "type": "LIMIT", "status": "NEW",
                       "price": "3000", "origQty": "0.1"}]]
        with patch.object(venue_check, "read_json", side_effect=responses) as read:
            result = venue_check.check_binance("spot", ("test-api-key", "test-secret"))
            url = read.call_args_list[1].args[0]
            self.assertIn("/api/v3/account?", url)
            self.assertIn("signature=", url)
            self.assertFalse(result["executionEnabled"])
            self.assertEqual(result["status"], "AUTHENTICATED_READ_ONLY")
            self.assertEqual(result["balances"], [{"asset": "USDT", "free": "100", "locked": "0"}])
            self.assertEqual(len(result["openOrders"]), 1)
            self.assertIn("/api/v3/openOrders?", read.call_args_list[2].args[0])
            self.assertNotIn("test-api-key", json.dumps(result))
            self.assertNotIn("test-secret", json.dumps(result))
            self.assertNotIn("signature", json.dumps(result))

    def test_futures_uses_the_futures_account_endpoint(self):
        account = {"assets": [{"asset": "USDT", "walletBalance": "500", "unrealizedProfit": "0"}],
                   "positions": [{"symbol": "BTCUSDT", "positionAmt": "0.01", "entryPrice": "90000",
                                  "unrealizedProfit": "-1"},
                                 {"symbol": "ETHUSDT", "positionAmt": "0", "entryPrice": "0",
                                  "unrealizedProfit": "0"}]}
        with patch.object(venue_check, "read_json", side_effect=[{"serverTime": 1700000000000}, account, []]) as read:
            result = venue_check.check_binance("futures", ("key", "secret"))
            self.assertIn("demo-fapi.binance.com/fapi/v3/account?", read.call_args_list[1].args[0])
            self.assertIn("demo-fapi.binance.com/fapi/v1/openOrders?", read.call_args_list[2].args[0])
            self.assertEqual(len(result["balances"]), 1)
            self.assertEqual(len(result["positions"]), 1)
            self.assertEqual(result["positions"][0]["symbol"], "BTCUSDT")
            self.assertEqual(result["openOrders"], [])

    def test_open_orders_endpoint_is_the_only_order_path_allowed(self):
        for url in ["https://demo-api.binance.com/api/v3/openOrders",
                    "https://demo-fapi.binance.com/fapi/v1/openOrders"]:
            with self.assertRaises(ValueError):
                venue_check.read_json(url + "?timestamp=1", data={"order": "x"})

    def test_read_transport_refuses_execution_hosts_and_order_paths(self):
        for url in ["https://api.binance.com/api/v3/account", "https://demo-api.binance.com/api/v3/order", "http://demo-api.binance.com/api/v3/time"]:
            with self.assertRaises(ValueError):
                venue_check.read_json(url)

    def test_rpc_refuses_transaction_submission(self):
        with self.assertRaises(ValueError):
            venue_check.read_json("https://api.mainnet-beta.solana.com", data={"method": "sendTransaction"})

    def test_solana_reads_balance_with_only_a_public_address(self):
        address = "11111111111111111111111111111111"
        with patch.object(venue_check, "read_json", side_effect=[{"result": "ok"}, {"result": "genesis"}, {"result": {"value": 2000000000}}]) as read:
            result = venue_check.check_solana("devnet", address)
            self.assertEqual(result["balanceSol"], 2)
            self.assertFalse(result["executionEnabled"])
            self.assertEqual([call.kwargs["data"]["method"] for call in read.call_args_list], ["getHealth", "getGenesisHash", "getBalance"])

    def test_transport_uses_get_for_binance_account_reads(self):
        from unittest.mock import MagicMock
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"balances": []}'
        with patch.object(venue_check, "build_opener") as opener:
            opener.return_value.open.return_value = response
            venue_check.read_json("https://demo-api.binance.com/api/v3/account", headers={"X-MBX-APIKEY": "test-key"})
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_method(), "GET")
            self.assertIsNone(request.data)

    def test_authentication_refuses_noninteractive_input(self):
        with patch("sys.stdin.isatty", return_value=False), patch("sys.stderr", new_callable=io.StringIO), patch.object(venue_check.getpass, "getpass") as prompt:
            with self.assertRaises(SystemExit):
                venue_check.main(["--authenticate"])
            prompt.assert_not_called()

    def test_authentication_refuses_unmasked_getpass_fallback(self):
        def warn(*args):
            venue_check.warnings.warn("no tty", venue_check.getpass.GetPassWarning)
        with patch("sys.stdin.isatty", return_value=True), patch("sys.stderr", new_callable=io.StringIO), patch.object(venue_check.getpass, "getpass", side_effect=warn), self.assertRaises(SystemExit):
            venue_check.main(["--authenticate"])

    def test_redirects_are_not_followed_with_credentials(self):
        self.assertIsNone(venue_check.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://example.invalid"))

    def test_failure_output_does_not_include_raw_error_or_signed_url(self):
        error = HTTPError("https://demo-api.binance.com/?signature=private", 401, "private", {}, io.BytesIO(b"private"))
        with patch.object(venue_check, "check_binance", side_effect=error), patch("sys.stdout", new_callable=io.StringIO) as output:
            result = venue_check.main(["--binance", "spot"])
            self.assertEqual(result, 1)
            self.assertNotIn("private", output.getvalue())
            self.assertIn("HTTP_401", output.getvalue())


DERIV_ACCOUNTS = {"data": [
    {"account_id": "DOT94629444", "balance": "10003.37", "currency": "USD",
     "group": "row", "status": "active", "account_type": "demo"},
    {"account_id": "ROT92679819", "balance": "0.00", "currency": "USD",
     "group": "row", "status": "active", "account_type": "real"},
]}


class DerivPreflightTests(unittest.TestCase):
    def run_check(self, response=None, **kwargs):
        with patch.object(venue_check, "read_json", return_value=response if response is not None else DERIV_ACCOUNTS) as read:
            result = venue_check.check_deriv(kwargs.pop("app_id", "1089"), kwargs.pop("token", "SECRET-TOKEN-xyz"), **kwargs)
            return result, read

    def test_deriv_accounts_are_read_only_and_sanitized(self):
        result, read = self.run_check()
        url, headers = read.call_args.args[0], read.call_args.kwargs["headers"]
        self.assertEqual(url, "https://api.derivws.com/trading/v1/options/accounts")
        self.assertEqual(headers["Deriv-App-ID"], "1089")
        self.assertEqual(headers["Authorization"], "Bearer SECRET-TOKEN-xyz")
        self.assertEqual(result["status"], "AUTHENTICATED_READ_ONLY")
        self.assertEqual(result["accountCount"], 2)
        self.assertFalse(result["executionEnabled"])
        body = json.dumps(result)
        self.assertNotIn("SECRET-TOKEN-xyz", body)
        self.assertNotIn("DOT94629444", body)
        self.assertIn("***9444", body)
        self.assertIn("demo", body)

    def test_deriv_warns_without_demo_account(self):
        only_real = {"data": [DERIV_ACCOUNTS["data"][1]]}
        result, _ = self.run_check(only_real)
        self.assertIn("warning", result)

    def test_deriv_expected_account_check(self):
        result, _ = self.run_check(expected_account="DOT94629444")
        self.assertTrue(result["expectedAccountPresent"])
        result, _ = self.run_check(expected_account="DOT999")
        self.assertFalse(result["expectedAccountPresent"])
        self.assertIn("warning", result)

    def test_deriv_refuses_bad_inputs_and_bad_hosts(self):
        with self.assertRaisesRegex(ValueError, "invalid_app_id"):
            self.run_check(app_id="bad id!")
        with self.assertRaisesRegex(ValueError, "missing_api_token"):
            self.run_check(token="")
        for bad in ["https://evil.example.com", "wss://api.derivws.com", "https://api.derivws.com/other/path", "https://api.derivws.com/x?y=1"]:
            with self.assertRaisesRegex(ValueError, "invalid_read_target"):
                self.run_check(base_url=bad)

    def test_deriv_invalid_response_fails(self):
        with self.assertRaises(TypeError):
            self.run_check({"unexpected": True})


if __name__ == "__main__":
    unittest.main()
