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
        login=12345, server="Broker-Demo", balance=10000)
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
