import importlib.util
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.error import HTTPError, URLError

import pytest


@pytest.fixture
def bridge(monkeypatch):
    monkeypatch.setenv("MT5_BRIDGE_TOKEN", "test-bridge-token")
    monkeypatch.setenv("MT5_LOGIN", "12345")
    monkeypatch.setenv("MT5_SERVER", "Broker-Demo")
    monkeypatch.delenv("MT5_READ_ONLY", raising=False)
    monkeypatch.delenv("MT5_EXPECTED_LOGIN", raising=False)
    monkeypatch.delenv("MT5_EXPECTED_SERVER", raising=False)
    mt5 = Mock()
    mt5.terminal_info.return_value = SimpleNamespace(
        connected=True, trade_allowed=True, build=5000)
    mt5.account_info.return_value = SimpleNamespace(
        login=12345, server="Broker-Demo", balance=10000, trade_mode=0, currency="USD")
    mt5.last_error.return_value = (1, "Success")
    monkeypatch.setitem(sys.modules, "MetaTrader5", mt5)
    path = Path(__file__).resolve().parents[3] / "tools/mt5-bridge/server.py"
    spec = importlib.util.spec_from_file_location("mt5_bridge_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, mt5, module.app.test_client()


HEADERS = {"Authorization": "Bearer test-bridge-token"}


def test_auth_required(bridge):
    _, mt5, client = bridge
    assert client.get("/health").status_code == 401
    mt5.terminal_info.assert_not_called()


@pytest.mark.parametrize("path", ["/order", "/close", "/close-all"])
def test_mutations_blocked_by_default(bridge, path):
    _, mt5, client = bridge
    response = client.post(path, headers=HEADERS, json={})
    assert response.status_code == 403
    assert response.json == {"error": "read_only"}
    mt5.order_send.assert_not_called()
    mt5.terminal_info.assert_not_called()


def test_health_readiness_requires_expected_account(bridge):
    _, _, client = bridge
    response = client.get("/health", headers=HEADERS)
    assert response.json["ready_for_read"] is True
    assert response.json["read_only"] is True


@pytest.mark.parametrize("field,value", [("login", 999), ("server", "Other")])
def test_wrong_account_blocks_reads(bridge, field, value):
    _, mt5, client = bridge
    setattr(mt5.account_info.return_value, field, value)
    assert client.get("/health", headers=HEADERS).json["ready_for_read"] is False
    response = client.get("/positions", headers=HEADERS)
    assert response.status_code == 503
    assert response.json["error"] == "account_identity_mismatch"
    mt5.positions_get.assert_not_called()


def test_unconfigured_identity_not_ready(bridge, monkeypatch):
    _, _, client = bridge
    monkeypatch.delenv("MT5_LOGIN")
    assert client.get("/health", headers=HEADERS).json["ready_for_read"] is False


def test_expected_identity_without_auto_login_credentials(bridge, monkeypatch):
    _, _, client = bridge
    monkeypatch.setenv("MT5_EXPECTED_LOGIN", "12345")
    monkeypatch.setenv("MT5_EXPECTED_SERVER", "Broker-Demo")
    monkeypatch.delenv("MT5_LOGIN")
    monkeypatch.delenv("MT5_SERVER")
    assert client.get("/health", headers=HEADERS).json["ready_for_read"] is True


@pytest.mark.parametrize("mode,label", [(0, "DEMO"), (1, "CONTEST"), (2, "REAL"), (None, "UNKNOWN")])
def test_account_mode_reported(bridge, mode, label):
    _, mt5, client = bridge
    mt5.account_info.return_value.trade_mode = mode
    assert client.get("/health", headers=HEADERS).json["account_mode"] == label


@pytest.fixture
def service_check():
    path = Path(__file__).resolve().parents[3] / "tools/mt5-bridge/healthcheck.py"
    spec = importlib.util.spec_from_file_location("mt5_service_check_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_service_check_requires_both_authenticated_services(service_check, monkeypatch):
    probe = Mock(side_effect=HTTPError("http://localhost", 401, "Unauthorized", {}, None))
    monkeypatch.setattr(service_check, "urlopen", probe)
    service_check.check_services()
    assert probe.call_count == 2


@pytest.mark.parametrize("error", [URLError("unavailable"), HTTPError("http://localhost", 500, "Error", {}, None)])
def test_service_check_fails_when_service_unavailable(service_check, monkeypatch, error):
    monkeypatch.setattr(service_check, "urlopen", Mock(side_effect=error))
    with pytest.raises(URLError):
        service_check.check_services()


def test_service_check_fails_if_authentication_missing(service_check, monkeypatch):
    from unittest.mock import MagicMock
    monkeypatch.setattr(service_check, "urlopen", MagicMock())
    with pytest.raises(RuntimeError, match="Authentication"):
        service_check.check_services()


def test_positions_from_expected_account(bridge):
    _, mt5, client = bridge
    mt5.positions_get.return_value = []
    assert client.get("/positions", headers=HEADERS).json == []


def test_positions_failure_not_reported_as_empty(bridge):
    _, mt5, client = bridge
    mt5.positions_get.return_value = None
    assert client.get("/positions", headers=HEADERS).status_code == 503


@pytest.mark.parametrize("bid,ask,age,status", [
    (1.1, 1.2, 0, 200), (1.1, 1.2, 120, 503),
    (1.1, 1.2, -120, 503), (float("nan"), 1.2, 0, 404),
    (1.2, 1.1, 0, 404), (1.1, 0, 0, 404),
])
def test_quote_validation(bridge, bid, ask, age, status):
    _, mt5, client = bridge
    mt5.symbol_info_tick.return_value = SimpleNamespace(
        bid=bid, ask=ask, time=time.time() - age)
    assert client.get("/quote/EURUSD", headers=HEADERS).status_code == status


def broker_order(ticket=1, **changes):
    return SimpleNamespace(ticket=ticket, position_id=0, symbol="EURUSD", type=2, state=1,
                           magic=42, time_setup_msc=1700000000000 + ticket, time_done_msc=0,
                           time_expiration=0, type_time=0, type_filling=1, reason=0,
                           volume_initial=0.01, volume_current=0.01, price_open=1.1,
                           price_current=1.11, price_stoplimit=0, sl=1.08, tp=1.15,
                           comment="private-account-comment", **changes)


def broker_deal(ticket=1):
    return SimpleNamespace(ticket=ticket, order=3, position_id=4, symbol="EURUSD", type=0,
                           entry=0, magic=42, time_msc=1700000000000 + ticket, reason=0,
                           volume=0.01, price=1.1, commission=-0.1, swap=0, profit=0, fee=0,
                           comment="private-account-comment")


def broker_contract():
    return SimpleNamespace(trade_contract_size=100000, volume_min=0.01, volume_max=50,
                           volume_step=0.01, digits=5, point=0.00001, trade_tick_size=0.00001,
                           trade_tick_value=1, trade_tick_value_profit=1, trade_tick_value_loss=1,
                           trade_stops_level=10, trade_freeze_level=0, trade_calc_mode=0,
                           trade_mode=4, filling_mode=3, currency_base="EUR", currency_profit="USD",
                           currency_margin="EUR", margin_initial=0, margin_maintenance=0, volume_limit=0)


@pytest.fixture
def activity_bridge(bridge):
    module, mt5, client = bridge
    mt5.orders_get.return_value = []
    mt5.history_orders_get.return_value = []
    mt5.history_deals_get.return_value = []
    mt5.symbol_info.return_value = broker_contract()
    return module, mt5, client


@pytest.mark.parametrize("path", ["/orders", "/history/orders", "/history/deals", "/activity"])
def test_new_reads_require_authentication(activity_bridge, path):
    _, mt5, client = activity_bridge
    assert client.get(path).status_code == 401
    mt5.orders_get.assert_not_called()
    mt5.history_orders_get.assert_not_called()
    mt5.history_deals_get.assert_not_called()


def test_activity_preserves_empty_results_and_exposes_broker_specifications(activity_bridge):
    _, mt5, client = activity_bridge
    response = client.get("/activity", headers=HEADERS)
    assert response.status_code == 200
    data = response.json
    assert data["account_mode"] == "DEMO"
    assert data["pending_orders"]["items"] == []
    assert data["history_orders"]["total"] == 0
    assert data["deals"]["next_offset"] is None
    assert data["contract"]["tick_value_loss"] == 1
    assert data["contract"]["stops_level"] == 10
    assert data["contract"]["currency_margin"] == "EUR"
    assert data["range"]["from"].endswith("+00:00")
    mt5.order_send.assert_not_called()


@pytest.mark.parametrize("method", ["orders_get", "history_orders_get", "history_deals_get"])
def test_activity_none_is_not_an_empty_account(activity_bridge, method):
    _, mt5, client = activity_bridge
    getattr(mt5, method).return_value = None
    mt5.last_error.return_value = (-10004, "private-account-comment")
    response = client.get("/activity", headers=HEADERS)
    assert response.status_code == 503
    assert response.json["broker_error_code"] == -10004
    assert "private-account-comment" not in response.text
    assert "items" not in response.json


@pytest.mark.parametrize("mode", [1, 2, None])
def test_new_activity_reads_are_demo_only(activity_bridge, mode):
    _, mt5, client = activity_bridge
    mt5.account_info.return_value.trade_mode = mode
    assert client.get("/activity", headers=HEADERS).status_code == 503
    mt5.orders_get.assert_not_called()


def test_account_switch_during_read_discards_the_entire_snapshot(activity_bridge):
    _, mt5, client = activity_bridge
    original = mt5.account_info.return_value
    mt5.account_info.side_effect = [original, original, SimpleNamespace(login=999, server="Other", trade_mode=0)]
    response = client.get("/activity", headers=HEADERS)
    assert response.status_code == 503
    assert response.json["error"] == "account_changed"
    assert "pending_orders" not in response.json


@pytest.mark.parametrize("query", [
    {"limit": "0"}, {"limit": "201"}, {"limit": "x"}, {"offset": "-1"},
    {"from": "2026-11-01T00:00:00Z"},
    {"from": "invalid", "to": "invalid"},
    {"from": "2026-11-01T00:00:00", "to": "2026-11-02T00:00:00"},
    {"from": "2026-10-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"},
    {"from": "2026-11-02T00:00:00Z", "to": "2026-11-01T00:00:00Z"},
    {"from": "2099-01-01T00:00:00Z", "to": "2099-01-02T00:00:00Z"},
    {"account_login": "999"},
])
def test_history_queries_are_bounded_and_timezone_aware(activity_bridge, query):
    _, mt5, client = activity_bridge
    assert client.get("/history/orders", headers=HEADERS, query_string=query).status_code == 400
    mt5.history_orders_get.assert_not_called()


def test_history_is_newest_first_paginated_and_omits_comments(activity_bridge):
    _, mt5, client = activity_bridge
    mt5.history_orders_get.return_value = [broker_order(1), broker_order(9007199254740993), broker_order(2)]
    response = client.get("/history/orders?limit=1&offset=0", headers=HEADERS)
    assert response.status_code == 200
    data = response.json
    assert data["items"][0]["ticket"] == "9007199254740993"
    assert data["total"] == 3
    assert data["next_offset"] == 1
    assert "private-account-comment" not in response.text
    assert "comment" not in data["items"][0]
    start, end = mt5.history_orders_get.call_args.args
    assert start.tzinfo is not None and end.tzinfo is not None


def test_deal_ids_and_costs_are_preserved(activity_bridge):
    _, mt5, client = activity_bridge
    mt5.history_deals_get.return_value = [broker_deal()]
    data = client.get("/history/deals", headers=HEADERS).json
    assert data["items"][0]["order"] == "3"
    assert data["items"][0]["position_id"] == "4"
    assert data["items"][0]["commission"] == -0.1


def test_broker_non_finite_values_do_not_become_valid_data(activity_bridge):
    _, mt5, client = activity_bridge
    item = broker_deal()
    item.profit = float("nan")
    mt5.history_deals_get.return_value = [item]
    response = client.get("/activity", headers=HEADERS)
    assert response.status_code == 503
    assert response.json["error"] == "invalid_broker_data"
