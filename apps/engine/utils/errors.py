"""Structured error codes and response formatting for the engine."""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from fastapi import Request, status
from fastapi.responses import JSONResponse


class ErrorCode(str, Enum):
    INTERNAL_ERROR = "INTERNAL_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    RATE_LIMITED = "RATE_LIMITED"

    # External / source
    EXTERNAL_API_ERROR = "EXTERNAL_API_ERROR"
    CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"

    # Domain
    INVALID_SYMBOL = "INVALID_SYMBOL"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    CALCULATION_ERROR = "CALCULATION_ERROR"


HTTP_STATUS_BY_CODE = {
    ErrorCode.INTERNAL_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
    ErrorCode.VALIDATION_ERROR: status.HTTP_400_BAD_REQUEST,
    ErrorCode.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.UNAUTHORIZED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.FORBIDDEN: status.HTTP_403_FORBIDDEN,
    ErrorCode.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
    ErrorCode.EXTERNAL_API_ERROR: status.HTTP_502_BAD_GATEWAY,
    ErrorCode.CIRCUIT_BREAKER_OPEN: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.SOURCE_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorCode.INVALID_SYMBOL: status.HTTP_400_BAD_REQUEST,
    ErrorCode.INSUFFICIENT_DATA: status.HTTP_400_BAD_REQUEST,
    ErrorCode.CALCULATION_ERROR: status.HTTP_500_INTERNAL_SERVER_ERROR,
}


class EngineException(Exception):
    """Domain exception carrying an internal error code."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: Optional[int] = None,
        details: Optional[dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code or HTTP_STATUS_BY_CODE.get(code, 500)
        self.details = details or {}


def format_error_response(request: Request, exc: Exception) -> JSONResponse:
    """Convert any exception into a structured JSON response."""
    if isinstance(exc, EngineException):
        payload = {
            "statusCode": exc.status_code,
            "code": exc.code,
            "message": exc.message,
            "path": request.url.path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if exc.details:
            payload["details"] = exc.details
    else:
        is_prod = __import__("os").getenv("ENV", "dev").lower() == "production"
        payload = {
            "statusCode": status.HTTP_500_INTERNAL_SERVER_ERROR,
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "Internal server error" if is_prod else str(exc),
            "path": request.url.path,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if not is_prod:
            import traceback
            payload["stack"] = traceback.format_exc()

    return JSONResponse(status_code=payload["statusCode"], content=payload)
