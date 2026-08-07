"""
FinBERT Sentiment — Phase I
Local NLP model for batch sentiment analysis of financial text.
Uses HuggingFace transformers (ProsusAI/finbert) if available.
Falls back to heuristic keyword matching if transformers not installed.

Designed for batch processing of RSS articles, tweets, Reddit posts
without paying OpenAI API costs.
"""
from __future__ import annotations

import re
from typing import List, Dict, Optional
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)

# Try to import transformers
try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    _TRANSFORMERS_AVAILABLE = True
except ImportError:
    _TRANSFORMERS_AVAILABLE = False
    logger.info("transformers_not_available_fallback_to_heuristic")

_MODEL_NAME = "ProsusAI/finbert"
_tokenizer = None
_model = None


@dataclass
class SentimentResult:
    text: str
    label: str  # positive | negative | neutral
    score: float  # -1.0 to 1.0
    confidence: float  # 0.0 to 1.0


def _load_model():
    """Lazy-load FinBERT model."""
    global _tokenizer, _model
    if _tokenizer is not None and _model is not None:
        return
    try:
        _tokenizer = AutoTokenizer.from_pretrained(_MODEL_NAME)
        _model = AutoModelForSequenceClassification.from_pretrained(_MODEL_NAME)
        logger.info("finbert_model_loaded", model=_MODEL_NAME)
    except Exception as exc:
        logger.warning("finbert_load_failed", error=str(exc))
        raise


# ── Heuristic fallback ───────────────────────────────────────────────────────

_BULLISH_WORDS = {
    "surge", "rally", "bull", "gain", "rise", "high", "record", "adoption",
    "approve", "launch", "partnership", "upgrade", "all-time", "breakout",
    "buy", "accumulate", "positive", "outperform", "beat", "exceed", "strong",
    "growth", "opportunity", "bullish", "uptrend", "support", "recovery",
    "inflow", "demand", "accumulate", "hold", "upgrade", "raise", "boost",
}

_BEARISH_WORDS = {
    "crash", "drop", "fall", "bear", "hack", "ban", "sell", "low", "warning",
    "fear", "dump", "scam", "fraud", "attack", "exploit", "lawsuit", "regulation",
    "fine", "bankruptcy", "collapse", "bearish", "downtrend", "resistance",
    "outflow", "decline", "miss", "disappoint", "weak", "cut", "downgrade",
    "loss", "risk", "concern", "threat", "sell-off", "liquidation", "fud",
}


def _heuristic_sentiment(text: str) -> SentimentResult:
    """Keyword-based sentiment analysis (fallback when FinBERT not available)."""
    words = set(re.findall(r'\b\w+\b', text.lower()))
    bullish = len(words & _BULLISH_WORDS)
    bearish = len(words & _BEARISH_WORDS)
    total = bullish + bearish

    if total == 0:
        return SentimentResult(text=text, label="neutral", score=0.0, confidence=0.3)

    score = (bullish - bearish) / total
    if score > 0.15:
        label = "positive"
    elif score < -0.15:
        label = "negative"
    else:
        label = "neutral"

    return SentimentResult(
        text=text,
        label=label,
        score=round(score, 3),
        confidence=min(0.5 + abs(score) * 0.5, 0.95),
    )


def _finbert_sentiment(text: str) -> SentimentResult:
    """FinBERT-based sentiment analysis."""
    _load_model()

    # Truncate to max 512 tokens
    inputs = _tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    )

    with torch.no_grad():
        outputs = _model(**inputs)
        probabilities = torch.nn.functional.softmax(outputs.logits, dim=-1)

    # FinBERT labels: 0=positive, 1=negative, 2=neutral
    labels_map = {0: "positive", 1: "negative", 2: "neutral"}
    pred_idx = int(torch.argmax(probabilities, dim=-1).item())
    confidence = float(probabilities[0][pred_idx].item())
    label = labels_map.get(pred_idx, "neutral")

    # Map to -1..1 score
    score_map = {"positive": confidence, "negative": -confidence, "neutral": 0.0}

    return SentimentResult(
        text=text,
        label=label,
        score=round(score_map[label], 4),
        confidence=round(confidence, 4),
    )


# ── Public API ───────────────────────────────────────────────────────────────

def analyze_sentiment(text: str) -> SentimentResult:
    """Analyze sentiment of a single text. Uses FinBERT if available, heuristic otherwise."""
    if not text or not text.strip():
        return SentimentResult(text=text, label="neutral", score=0.0, confidence=0.0)

    if _TRANSFORMERS_AVAILABLE:
        try:
            return _finbert_sentiment(text[:2000])  # cap text length
        except Exception as exc:
            logger.warning("finbert_inference_failed_fallback", error=str(exc))

    return _heuristic_sentiment(text)


def analyze_batch(texts: List[str]) -> List[SentimentResult]:
    """Analyze sentiment of multiple texts. Batch processing for efficiency."""
    return [analyze_sentiment(text) for text in texts]


def aggregate_sentiment(texts: List[str]) -> Dict:
    """
    Aggregate sentiment across multiple texts.
    Returns overall sentiment + per-text results.
    """
    results = analyze_batch(texts)
    if not results:
        return {
            "overall_label": "neutral",
            "overall_score": 0.0,
            "confidence": 0.0,
            "count": 0,
            "positive_count": 0,
            "negative_count": 0,
            "neutral_count": 0,
            "items": [],
        }

    scores = [r.score for r in results]
    avg_score = sum(scores) / len(scores)
    pos = sum(1 for r in results if r.label == "positive")
    neg = sum(1 for r in results if r.label == "negative")
    neu = sum(1 for r in results if r.label == "neutral")

    if avg_score > 0.1:
        overall = "positive"
    elif avg_score < -0.1:
        overall = "negative"
    else:
        overall = "neutral"

    return {
        "overall_label": overall,
        "overall_score": round(avg_score, 4),
        "confidence": round(min(abs(avg_score) + 0.3, 0.95), 4),
        "count": len(results),
        "positive_count": pos,
        "negative_count": neg,
        "neutral_count": neu,
        "items": [
            {"label": r.label, "score": r.score, "confidence": r.confidence, "text": r.text[:200]}
            for r in results
        ],
    }


def get_sentiment_bonus(overall_label: str, overall_score: float) -> float:
    """
    Convert sentiment to a bonus/malus for scan.py scoring.
    Positive sentiment → +bonus, negative → -bonus.
    """
    if overall_label == "positive":
        return min(overall_score * 15, 10)  # max +10
    elif overall_label == "negative":
        return max(overall_score * 15, -10)  # max -10
    return 0.0
