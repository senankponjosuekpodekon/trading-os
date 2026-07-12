from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import structlog
import os

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from routers import health, indicators, analyze, scan, ws, risk, backtest, llm, brvm, deriv, rag, news, news_scraper
import config  # noqa: F401 — valide les secrets au démarrage
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


app = FastAPI(
    title="Trading OS Engine",
    description="Quantitative analysis engine — Market data, indicators, signals",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Rate limiting ──────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── CORS strict ──────────────────────────────────────────────
_allowed_origins = [
    o.strip() for o in
    os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")
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
app.include_router(risk.router,     prefix="",  tags=["Risk"])
app.include_router(backtest.router, prefix="",  tags=["Backtest"])
app.include_router(llm.router,      prefix="",  tags=["LLM"])
app.include_router(brvm.router,     prefix="",  tags=["BRVM"])
app.include_router(deriv.router,    prefix="",  tags=["Deriv"])
app.include_router(rag.router,      prefix="",  tags=["RAG"])
app.include_router(news.router,         prefix="",  tags=["News"])
app.include_router(news_scraper.router, prefix="",  tags=["News Scraper"])

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
