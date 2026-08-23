"""Pydantic models for the scanner API."""
from pydantic import BaseModel
from typing import List


class ScanRequest(BaseModel):
    symbols: List[str]
    timeframe: str = "1h"
    strategies: List[dict] = []
