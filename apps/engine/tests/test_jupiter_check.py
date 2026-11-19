import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from time import monotonic
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from ml import jupiter_check as check
from utils.jupiter_quote import JupiterQuote, JupiterQuoteError, JupiterQuoteReader

SOL = 'So11111111111111111111111111111111111111112'
USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'


def quote(input_mint, output_mint, amount, out, impact=None):
    stamp = monotonic()
    now = datetime.now(timezone.utc)
    return JupiterQuote(input_mint=input_mint, output_mint=output_mint, input_amount=amount, output_amount=out,
                        min_output_amount=out * 9950 // 10000, slippage_bps=50, fee_bps=2, fee_mint=output_mint,
                        router='metis', checked_at=now, expires_at=now + timedelta(seconds=15),
                        _issued_monotonic=stamp, _deadline_monotonic=stamp + 15, price_impact_pct=impact)


def reader_for(*responses):
    reader = AsyncMock(spec=JupiterQuoteReader)
    reader.get_quote.side_effect = responses
    return reader


@pytest.mark.asyncio
async def test_round_trip_uses_exact_received_units_and_percentage_points():
    buy = quote(SOL, USDC, 700000000, 1000000, -0.25)
    sell = quote(USDC, SOL, 1000000, 693000000)
    reader = reader_for(buy, sell)
    result = await check.check_exit_liquidity(USDC, reader=reader)
    assert result['status'] == 'QUOTED'
    assert result['checked'] is True and result['sellable'] is True
    assert result['round_trip_loss_pct'] == pytest.approx(1)
    assert result['buy_impact_pct'] == 0.25
    assert result['quote_only'] is True and result['execution_enabled'] is False
    assert reader.get_quote.await_args_list[1].args == (USDC, SOL, buy.output_amount)
    assert result['expires_at']
    assert result['source'] == 'JUPITER_SWAP_V2'


@pytest.mark.asyncio
@pytest.mark.parametrize('code,status', [('UNAVAILABLE', 'UNAVAILABLE'), ('HTTP_ERROR', 'UNAVAILABLE'),
                                        ('EXPIRED_QUOTE', 'STALE'), ('FEE_LIMIT_EXCEEDED', 'REJECTED'),
                                        ('SLIPPAGE_LIMIT_EXCEEDED', 'REJECTED'), ('INVALID_RESPONSE', 'REJECTED')])
async def test_provider_failures_are_not_unsellability(code, status):
    result = await check.check_exit_liquidity(USDC, reader=reader_for(JupiterQuoteError(code)))
    assert result['checked'] is False
    assert result['sellable'] is None
    assert result['status'] == status
    assert result['round_trip_loss_pct'] is None


@pytest.mark.asyncio
async def test_no_buy_route_does_not_claim_the_token_cannot_be_sold():
    result = await check.check_exit_liquidity(USDC, reader=reader_for(JupiterQuoteError('NO_ROUTE', 400)))
    assert result['status'] == 'NO_ENTRY_ROUTE'
    assert result['checked'] is False and result['sellable'] is None


@pytest.mark.asyncio
async def test_explicit_missing_sell_route_is_a_probe_result_not_a_honeypot_verdict():
    result = await check.check_exit_liquidity(USDC, reader=reader_for(
        quote(SOL, USDC, 700000000, 1000000), JupiterQuoteError('NO_ROUTE', 400)))
    assert result['status'] == 'NO_EXIT_ROUTE'
    assert result['checked'] is True and result['sellable'] is False
    assert 'honeypot' not in str(result).lower()


@pytest.mark.asyncio
async def test_sell_api_error_discards_partial_quote_data():
    result = await check.check_exit_liquidity(USDC, reader=reader_for(
        quote(SOL, USDC, 700000000, 1000000, 0.3), JupiterQuoteError('HTTP_ERROR', 429)))
    assert result['sellable'] is None and result['checked'] is False
    assert result['buy_impact_pct'] is None
    assert result['round_trip_loss_pct'] is None
    assert result['reason'] == 'RATE_LIMITED'


@pytest.mark.asyncio
async def test_invalid_input_is_not_reported_as_a_liquidity_failure():
    result = await check.check_exit_liquidity('invalid', reader=reader_for(ValueError('private-data')))
    assert result['status'] == 'INVALID_INPUT'
    assert result['sellable'] is None
    assert 'private-data' not in str(result)


@pytest.mark.asyncio
async def test_high_cost_preserves_the_existing_ninety_percent_threshold():
    reader = reader_for(quote(SOL, USDC, 700000000, 1000000), quote(USDC, SOL, 1000000, 70000000))
    result = await check.check_exit_liquidity(USDC, reader=reader)
    assert result['status'] == 'QUOTED'
    assert result['round_trip_loss_pct'] == 90
    assert result['sellable'] is False


@pytest.mark.asyncio
async def test_expired_first_leg_is_rejected_after_the_return_quote():
    buy = quote(SOL, USDC, 700000000, 1000000)
    reader = reader_for()
    async def respond(input_mint, output_mint, amount):
        if input_mint == SOL:
            return buy
        object.__setattr__(buy, '_deadline_monotonic', monotonic() - 1)
        return quote(USDC, SOL, amount, 693000000)
    reader.get_quote.side_effect = respond
    result = await check.check_exit_liquidity(USDC, reader=reader)
    assert reader.get_quote.await_count == 2
    assert result['status'] == 'STALE'
    assert result['checked'] is False


@pytest.mark.asyncio
async def test_no_route_on_an_expired_probe_is_unknown_not_unsellable():
    buy = quote(SOL, USDC, 700000000, 1000000)
    reader = reader_for()
    async def respond(input_mint, output_mint, amount):
        if input_mint == SOL:
            return buy
        object.__setattr__(buy, '_deadline_monotonic', monotonic() - 1)
        raise JupiterQuoteError('NO_ROUTE', 400)
    reader.get_quote.side_effect = respond
    result = await check.check_exit_liquidity(USDC, reader=reader)
    assert result['status'] == 'STALE'
    assert result['checked'] is False and result['sellable'] is None


@pytest.mark.asyncio
async def test_batch_is_bounded_reuses_one_reader_and_marks_unchecked_candidates(monkeypatch):
    reader = reader_for()
    handler = AsyncMock(return_value={'status': 'QUOTED'})
    monkeypatch.setattr(check, 'check_exit_liquidity', handler)
    result = await check.check_exit_liquidity_batch([USDC, USDC, USDC], reader=reader)
    assert handler.await_count == 2
    assert all(call.kwargs['reader'] is reader for call in handler.await_args_list)
    assert result[2]['status'] == 'DEFERRED'
    assert result[2]['checked'] is False and result[2]['sellable'] is None


@pytest.mark.asyncio
async def test_batch_budget_stops_slow_checks_without_false_rejections(monkeypatch):
    async def slow(*args, **kwargs):
        await asyncio.sleep(1)
    monkeypatch.setattr(check, '_BATCH_BUDGET_SECONDS', 0.01)
    monkeypatch.setattr(check, 'check_exit_liquidity', slow)
    result = await check.check_exit_liquidity_batch([USDC, USDC], reader=reader_for())
    assert result[0]['reason'] == 'BATCH_TIMEOUT'
    assert result[0]['sellable'] is None and result[0]['checked'] is False
    assert result[1]['status'] == 'DEFERRED'


@pytest.mark.asyncio
async def test_rate_limit_stops_the_batch(monkeypatch):
    handler = AsyncMock(return_value={'status': 'UNAVAILABLE', 'reason': 'RATE_LIMITED'})
    monkeypatch.setattr(check, 'check_exit_liquidity', handler)
    result = await check.check_exit_liquidity_batch([USDC, USDC], reader=reader_for())
    assert handler.await_count == 1
    assert result[1]['status'] == 'DEFERRED'
