from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import structlog
import os
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.asyncio import AsyncioIntegration
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from middleware.security import SecurityHeadersMiddleware
from middleware.errors import ErrorFormatterMiddleware
from routers import (
    health,
    indicators,
    analyze,
    scan,
    ws,
    risk,
    probability,
    trailing_stop,
    backtest,
    llm,
    brvm,
    brvm_reports,
    deriv,
    rag,
    news,
    news_scraper,
    macro,
    onchain,
    synthetic_engine,
    tick_stats,
    tokenomics,
    social_sentiment,
    ml_feedback,
    expected_move,
    ml_regime,
    ml_signals,
    dex_discovery,
)
from utils.errors import EngineException, format_error_response
from config import settings  # noqa: F401 — valide les secrets au démarrage
import asyncio

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute", "1000/hour"])

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Trading OS Engine starting up")
    price_task = asyncio.create_task(ws.price_broadcaster())
    warmup_task = asyncio.create_task(scan.warmup_features())
    yield
    price_task.cancel()
    warmup_task.cancel()
    for task in (price_task, warmup_task):
        try:
            await asyncio.wait_for(task, timeout=5.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    logger.info("Trading OS Engine shutting down")


if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment="production" if os.getenv("NODE_ENV") == "production" else "development",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[FastApiIntegration(), AsyncioIntegration()],
    )

app = FastAPI(
    title="Trading OS Engine",
    description="Quantitative analysis engine — Market data, indicators, signals",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Security headers ─────────────────────────────────────────────
app.add_middleware(SecurityHeadersMiddleware)

# ── Rate limiting ──────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(EngineException, format_error_response)
app.add_middleware(SlowAPIMiddleware)

# ── Catch-all error formatting ───────────────────────────────────
app.add_middleware(ErrorFormatterMiddleware)

# ── CORS strict ──────────────────────────────────────────────
_allowed_origins = [
    o.strip() for o in
    os.getenv("ALLOWED_ORIGINS", "http://169.58.80.46:3000,http://169.58.80.46:3001,http://localhost:3000,http://localhost:3001").split(",")
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(health.router, tags=["Health"])
app.include_router(indicators.router, prefix="/indicators", tags=["Indicators"])
app.include_router(analyze.router, prefix="/analyze", tags=["Analyze"])
app.include_router(scan.router, prefix="/scan", tags=["Scan"])
app.include_router(ws.router, tags=["WebSocket"])
app.include_router(risk.router,          prefix="", tags=["Risk"])
app.include_router(probability.router,    prefix="", tags=["Probability"])
app.include_router(trailing_stop.router, prefix="", tags=["Trailing Stop"])
app.include_router(backtest.router, prefix="",  tags=["Backtest"])
app.include_router(llm.router,      prefix="",  tags=["LLM"])
app.include_router(brvm.router,     prefix="",  tags=["BRVM"])
app.include_router(brvm_reports.router, prefix="", tags=["BRVM Reports"])
app.include_router(deriv.router,    prefix="",  tags=["Deriv"])
app.include_router(synthetic_engine.router, prefix="", tags=["Synthetic"])
app.include_router(tick_stats.router, prefix="", tags=["Tick Stats"])
app.include_router(rag.router,      prefix="",  tags=["RAG"])
app.include_router(news.router,         prefix="",  tags=["News"])
app.include_router(news_scraper.router, prefix="",  tags=["News Scraper"])
app.include_router(macro.router,        prefix="/macro", tags=["Macro"])
app.include_router(onchain.router,      prefix="/onchain", tags=["On-chain"])
app.include_router(tokenomics.router,   prefix="/tokenomics", tags=["Tokenomics"])
app.include_router(social_sentiment.router, prefix="/social", tags=["Social Sentiment"])
app.include_router(ml_feedback.router, prefix="/ml-feedback", tags=["ML Feedback"])
app.include_router(ml_signals.router, tags=["ML"])
app.include_router(expected_move.router)
app.include_router(ml_regime.router, prefix="", tags=["ML"])
app.include_router(dex_discovery.router, prefix="/dex", tags=["DEX Discovery"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_delay=1,
        timeout_graceful_shutdown=2,
    )
