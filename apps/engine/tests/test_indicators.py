"""Tests unitaires — indicateurs techniques et stratégies."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np


# ── Helpers ──────────────────────────────────────────────────
def make_series(n=50, seed=42, base=100.0, vol=2.0) -> pd.Series:
    np.random.seed(seed)
    returns = np.random.normal(0, vol / 100, n)
    prices  = base * np.cumprod(1 + returns)
    return pd.Series(prices.tolist())


# ── Tests scan.py indicators ─────────────────────────────────
from routers.scan import macd, bollinger


class TestMacd:
    def test_returns_three_series(self):
        close = make_series(100)
        m, s, h = macd(close)
        assert len(m) == len(close)
        assert len(s) == len(close)
        assert len(h) == len(close)

    def test_histogram_is_macd_minus_signal(self):
        close = make_series(100)
        m, s, h = macd(close)
        diff = (m - s).dropna()
        hist = h.dropna()
        pd.testing.assert_series_equal(diff, hist, check_names=False, atol=1e-6)

    def test_no_nan_at_end(self):
        close = make_series(100)
        m, s, h = macd(close)
        assert not np.isnan(h.iloc[-1])
        assert not np.isnan(m.iloc[-1])

    def test_custom_periods(self):
        close = make_series(100)
        m, s, h = macd(close, fast=5, slow=10, signal=3)
        assert len(h) == len(close)


class TestBollinger:
    def test_returns_four_series(self):
        close = make_series(50)
        up, mid, lo, bw = bollinger(close)
        assert len(up) == len(close)
        assert len(mid) == len(close)
        assert len(lo) == len(close)
        assert len(bw) == len(close)

    def test_upper_above_lower(self):
        close = make_series(50)
        up, mid, lo, bw = bollinger(close)
        valid = ~(up.isna() | lo.isna())
        assert (up[valid] >= lo[valid]).all()

    def test_mid_is_sma(self):
        close = make_series(50)
        up, mid, lo, bw = bollinger(close, p=20)
        expected_mid = close.rolling(20).mean()
        pd.testing.assert_series_equal(mid.dropna(), expected_mid.dropna(), check_names=False, atol=1e-6)

    def test_bandwidth_positive(self):
        close = make_series(50)
        up, mid, lo, bw = bollinger(close)
        assert (bw.dropna() >= 0).all()


# ── Tests Deriv stratégie ─────────────────────────────────────
from routers.deriv import _v75_scalp_strategy, _mock_v75_candles


class TestV75Strategy:
    def test_returns_required_keys(self):
        candles = _mock_v75_candles(60)
        result  = _v75_scalp_strategy(candles)
        for key in ['signal', 'confidence', 'score', 'indicators', 'reasons']:
            assert key in result

    def test_signal_is_valid(self):
        candles = _mock_v75_candles(60)
        result  = _v75_scalp_strategy(candles)
        assert result['signal'] in ('CALL', 'PUT', 'WAIT')

    def test_confidence_range(self):
        candles = _mock_v75_candles(60)
        result  = _v75_scalp_strategy(candles)
        assert 0 <= result['confidence'] <= 100

    def test_insufficient_data_returns_wait(self):
        candles = _mock_v75_candles(10)
        result  = _v75_scalp_strategy(candles)
        assert result['signal'] == 'WAIT'

    def test_indicators_present(self):
        candles = _mock_v75_candles(60)
        result  = _v75_scalp_strategy(candles)
        ind = result['indicators']
        for key in ['close', 'ema8', 'ema21', 'rsi', 'bb_upper', 'bb_lower']:
            assert key in ind

    def test_mock_candles_count(self):
        for n in [50, 100, 200]:
            c = _mock_v75_candles(n)
            assert len(c) == n

    def test_candle_ohlcv_valid(self):
        candles = _mock_v75_candles(50)
        for c in candles:
            t, o, h, lo, cl = c
            assert h >= lo
            assert h >= o
            assert h >= cl


# ── Tests BRVM mock data ──────────────────────────────────────
from routers.brvm import _mock_brvm_quotes, _analyze_brvm_signal, TOP_SYMBOLS


class TestBrvm:
    def test_mock_returns_all_symbols(self):
        quotes = _mock_brvm_quotes()
        syms   = [q['symbol'] for q in quotes]
        for s in TOP_SYMBOLS:
            assert s in syms

    def test_mock_quote_structure(self):
        quotes = _mock_brvm_quotes()
        for q in quotes:
            assert q['price'] > 0
            assert q['currency'] == 'XOF'
            assert q['market']   == 'BRVM'
            assert -50 < q['change_pct'] < 50

    def test_analysis_adds_signal(self):
        quotes  = _mock_brvm_quotes()
        results = _analyze_brvm_signal(quotes)
        for r in results:
            assert r['signal'] in ('BUY', 'SELL', 'WATCH')
            assert 'confidence' in r
            assert 'reasons' in r

    def test_analysis_sorted_by_abs_score(self):
        quotes  = _mock_brvm_quotes()
        results = _analyze_brvm_signal(quotes)
        scores  = [abs(r['score']) for r in results]
        assert scores == sorted(scores, reverse=True)


# ── Tests LLM prompts ─────────────────────────────────────────
from routers.llm import _build_signal_prompt, _mock_response, ExplainRequest


class TestLlm:
    def _make_req(self, signal='BUY'):
        return ExplainRequest(
            symbol='ETH/USDT', timeframe='1h', signal=signal,
            confidence=72.0, explanation='EMA bullish | MACD crossover',
            indicators={'close': 1800, 'ema20': 1790, 'rsi': 58, 'macd_hist': 3.2},
        )

    def test_prompt_contains_symbol(self):
        prompt = _build_signal_prompt(self._make_req())
        assert 'ETH/USDT' in prompt

    def test_prompt_contains_signal(self):
        prompt = _build_signal_prompt(self._make_req('SELL'))
        assert 'SELL' in prompt

    def test_prompt_contains_indicators(self):
        prompt = _build_signal_prompt(self._make_req())
        assert 'RSI' in prompt or 'rsi' in prompt.lower()
        assert 'MACD' in prompt or 'macd' in prompt.lower()

    def test_mock_buy_response(self):
        r = _mock_response('signal BUY test')
        assert 'BUY' in r or 'hausse' in r.lower()

    def test_mock_sell_response(self):
        r = _mock_response('signal SELL test')
        assert 'SELL' in r or 'baissi' in r.lower()

    def test_mock_error_includes_message(self):
        r = _mock_response('signal test', error='API key invalid')
        assert 'API key invalid' in r or 'OPENAI_API_KEY' in r
