"""Tests for BRVM scraper and fundamentals modules."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
from datetime import datetime

from scrapers.brvm_scraper import (
    BRVM_SYMBOLS,
    fetch_brvm_quotes,
    _mock_brvm_quotes,
    is_brvm_symbol,
)
from scrapers.brvm_fundamentals import (
    fundamental_score,
    FundamentalScoreOut,
    BrvmReport,
)


def test_brvm_symbols_constant():
    assert "SNTS" in BRVM_SYMBOLS
    assert "BOABF" in BRVM_SYMBOLS


def test_is_brvm_symbol():
    assert is_brvm_symbol("SNTS") is True
    assert is_brvm_symbol("BTC/USDT") is False


def test_mock_quotes_structure():
    quotes = _mock_brvm_quotes()
    assert len(quotes) == len(BRVM_SYMBOLS)
    for q in quotes:
        assert q["symbol"] in BRVM_SYMBOLS
        assert q["price"] > 0
        assert q["currency"] == "XOF"
        assert q["market"] == "BRVM"


def test_fetch_brvm_quotes_returns_empty_or_data():
    result = asyncio.run(fetch_brvm_quotes())
    # live scrape may fail in CI; the module exposes a separate mock fallback
    assert isinstance(result, list)


def test_mock_fallback_available():
    quotes = _mock_brvm_quotes()
    assert len(quotes) == len(BRVM_SYMBOLS)



def test_fundamental_score_recent_report():
    recent = [BrvmReport("Rapport annuel", "ANNUAL", datetime.utcnow(), "http://x/20260101.pdf")]
    assert fundamental_score(recent) == 20


def test_fundamental_score_old_report():
    old = [BrvmReport("Rapport annuel", "ANNUAL", datetime(2024, 1, 1), None)]
    assert fundamental_score(old) == 0


def test_fundamental_score_out_struct():
    out = FundamentalScoreOut("SNTS", 10, "QUARTERLY", datetime.utcnow(), "sonatel")
    assert out.symbol == "SNTS"
    assert out.score == 10
