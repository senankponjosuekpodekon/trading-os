"""
Shared-secret authentication middleware for the FastAPI engine.

Every HTTP request (except /health, /metrics, and WebSocket handshakes)
must carry an `X-Engine-Key` header matching ENGINE_API_KEY.

If ENGINE_API_KEY is not set, the middleware is bypassed with a warning
(development mode).  In production the key MUST be configured.
"""
import os
import secrets

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from utils.logger import get_logger

logger = get_logger(__name__)

_EXEMPT_PATHS = {"/health", "/metrics"}
_ENGINE_KEY = os.getenv("ENGINE_API_KEY", "")
_PRODUCTION = os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "")).strip().lower() in ("production", "prod")


class EngineAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # WebSocket upgrades — skip auth (they have their own connection logic)
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        # Health & metrics — always public
        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        # No key configured — toléré en dev uniquement. En production on
        # refuse tout : une clé absente + bind exposé ouvrirait les endpoints
        # de trading réel (/deriv/scalp) et le LLM à quiconque atteint le port.
        if not _ENGINE_KEY:
            if _PRODUCTION:
                logger.error("engine_auth_no_key_production", path=request.url.path)
                return JSONResponse(
                    status_code=503,
                    content={"error": "ENGINE_KEY_MISSING", "message": "ENGINE_API_KEY is required in production"},
                )
            return await call_next(request)

        provided = request.headers.get("x-engine-key", "")
        if not secrets.compare_digest(provided, _ENGINE_KEY):
            logger.warning("engine_auth_rejected", path=request.url.path, ip=request.client.host if request.client else "?")
            return JSONResponse(
                status_code=401,
                content={"error": "UNAUTHORIZED", "message": "Missing or invalid X-Engine-Key header"},
            )

        return await call_next(request)
