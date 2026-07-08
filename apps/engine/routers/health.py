from fastapi import APIRouter
from datetime import datetime

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "Trading OS Engine",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "0.1.0",
    }
