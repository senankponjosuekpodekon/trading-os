"""
Security middleware for the FastAPI engine.

Adds common HTTP security headers and strips server banners.
"""
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        # Prevent MIME sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"
        # Referrer policy
        response.headers["Referrer-Policy"] = "same-origin"
        # Basic CSP for API responses (no inline scripts expected)
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        # Restrict browser features
        response.headers["Permissions-Policy"] = (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
        )
        # Remove server banner
        try:
            del response.headers["Server"]
        except KeyError:
            pass

        return response
