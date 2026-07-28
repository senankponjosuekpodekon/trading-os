"""Tests for structured error responses."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from utils.errors import EngineException, ErrorCode, format_error_response


def test_engine_exception_response():
    app = FastAPI()
    app.add_exception_handler(EngineException, format_error_response)

    @app.get("/boom")
    def boom():
        raise EngineException(ErrorCode.INVALID_SYMBOL, "Unknown symbol", details={"symbol": "FOO"})

    client = TestClient(app)
    response = client.get("/boom")
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_SYMBOL"
    assert body["message"] == "Unknown symbol"
    assert body["details"] == {"symbol": "FOO"}
    assert "path" in body
    assert "timestamp" in body


def test_unknown_exception_response():
    from middleware.errors import ErrorFormatterMiddleware

    app = FastAPI()
    app.add_middleware(ErrorFormatterMiddleware)

    @app.get("/fail")
    def fail():
        raise RuntimeError("unexpected")

    client = TestClient(app)
    response = client.get("/fail")
    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "INTERNAL_ERROR"
    assert "message" in body
    assert "path" in body
