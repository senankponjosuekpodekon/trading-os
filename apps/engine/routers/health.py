from fastapi import APIRouter, Response
from datetime import datetime
from utils.metrics import render

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "Trading OS Engine",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "0.1.0",
    }


@router.get("/metrics")
async def metrics():
    return Response(content=render(), media_type="text/plain; version=0.0.4; charset=utf-8")
