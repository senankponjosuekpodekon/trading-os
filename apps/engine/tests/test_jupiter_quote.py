import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import httpx
import pytest

from utils import jupiter_quote as module
from utils.jupiter_quote import JupiterQuoteError, JupiterQuoteReader

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
SOL = "So11111111111111111111111111111111111111112"


def response(**updates):
    return {"inputMint": USDC, "outputMint": SOL, "inAmount": "1000000", "outAmount": "10000000",
            "otherAmountThreshold": "9950000", "swapMode": "ExactIn", "slippageBps": 50,
            "feeBps": 2, "feeMint": SOL, "router": "metis", "transaction": None, "taker": None, **updates}


def reader_for(data, *, status=200):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(status, json=data)

    return JupiterQuoteReader(transport=httpx.MockTransport(handle)), requests


@pytest.mark.asyncio
async def test_quote_is_get_only_and_has_no_wallet_or_signing_dependency(monkeypatch):
    monkeypatch.setenv("SOLANA_PRIVATE_KEY", "not-a-valid-key-and-must-not-be-read")
    reader, requests = reader_for(response())
    quote = await reader.get_quote(USDC, SOL, 1000000)
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url).startswith("https://api.jup.ag/swap/v2/order?")
    assert set(request.url.params) == {"inputMint", "outputMint", "amount", "slippageBps"}
    assert "authorization" not in request.headers and "x-api-key" not in request.headers
    assert request.content == b""
    assert quote.input_amount == 1000000
    assert quote.output_amount == 10000000
    assert quote.min_output_amount == 9950000
    assert quote.fee_bps == 2
    assert quote.execution_enabled is False
    assert quote.is_fresh
    quote.require_fresh()
    assert not hasattr(quote, "transaction")
    assert "not-a-valid-key" not in repr(quote)


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [0, -1, True, 1.5, "1000000", 2**64])
async def test_invalid_amount_is_rejected_before_any_http_request(amount):
    reader, requests = reader_for(response())
    with pytest.raises(ValueError):
        await reader.get_quote(USDC, SOL, amount)
    assert not requests


@pytest.mark.asyncio
@pytest.mark.parametrize("mint", ["", "secret", "0" * 44, "1" * 33, SOL + "1", None])
async def test_mints_must_decode_to_32_bytes(mint):
    reader, requests = reader_for(response())
    with pytest.raises(ValueError):
        await reader.get_quote(mint, SOL, 1000000)
    assert not requests


@pytest.mark.asyncio
async def test_identical_mints_are_rejected():
    reader, requests = reader_for(response())
    with pytest.raises(ValueError):
        await reader.get_quote(SOL, SOL, 1000000)
    assert not requests


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [{"slippage_bps": -1}, {"slippage_bps": 101}, {"slippage_bps": True},
                                    {"max_fee_bps": -1}, {"max_fee_bps": 101}, {"max_fee_bps": 2.5}])
async def test_policy_limits_are_validated_before_network(kwargs):
    reader, requests = reader_for(response())
    with pytest.raises(ValueError):
        await reader.get_quote(USDC, SOL, 1000000, **kwargs)
    assert not requests


@pytest.mark.asyncio
@pytest.mark.parametrize("updates", [
    {"inputMint": SOL}, {"outputMint": USDC}, {"inAmount": "1000001"},
    {"outAmount": "0"}, {"outAmount": "-1"}, {"outAmount": "1.5"}, {"outAmount": 10000000},
    {"outAmount": str(2**64)}, {"outAmount": "9" * 5000},
    {"swapMode": "ExactOut"}, {"feeBps": None}, {"feeBps": True}, {"feeBps": -1},
    {"feeMint": "11111111111111111111111111111111"},
    {"slippageBps": True}, {"slippageBps": -1},
    {"otherAmountThreshold": "0"}, {"otherAmountThreshold": "10000001"},
    {"router": None}, {"transaction": "unsigned-transaction"}, {"transaction": []},
    {"taker": "unexpected-wallet"}, {"errorCode": 123}, {"error": "do-not-echo-remote-error"},
    {"expireAt": "invalid-date"}, {"expireAt": "2026-01-01T12:00:00"},
])
async def test_malformed_or_unsafe_quotes_are_rejected(updates):
    reader, _ = reader_for(response(**updates))
    with pytest.raises(JupiterQuoteError) as error:
        await reader.get_quote(USDC, SOL, 1000000)
    assert "do-not-echo" not in str(error.value)
    assert "unsigned-transaction" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [None, [], {}, {"errorMessage": "private-provider-message"}])
async def test_missing_or_non_object_responses_fail_closed(data):
    reader, _ = reader_for(data)
    with pytest.raises(JupiterQuoteError):
        await reader.get_quote(USDC, SOL, 1000000)


@pytest.mark.asyncio
@pytest.mark.parametrize("updates,code", [
    ({"feeBps": 31}, "FEE_LIMIT_EXCEEDED"),
    ({"slippageBps": 51}, "SLIPPAGE_LIMIT_EXCEEDED"),
    ({"otherAmountThreshold": "9949999"}, "SLIPPAGE_LIMIT_EXCEEDED"),
    ({"expireAt": (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()}, "EXPIRED_QUOTE"),
])
async def test_policy_violations_have_sanitized_codes(updates, code):
    reader, _ = reader_for(response(**updates))
    with pytest.raises(JupiterQuoteError, match=code):
        await reader.get_quote(USDC, SOL, 1000000)


@pytest.mark.asyncio
async def test_quote_expires_locally_even_without_provider_expiry(monkeypatch):
    monkeypatch.setattr(module, "monotonic", lambda: 100.0)
    reader, _ = reader_for(response())
    quote = await reader.get_quote(USDC, SOL, 1000000)
    monkeypatch.setattr(module, "monotonic", lambda: 116.0)
    assert not quote.is_fresh
    with pytest.raises(JupiterQuoteError, match="EXPIRED_QUOTE"):
        quote.require_fresh()


@pytest.mark.asyncio
async def test_network_latency_counts_against_quote_freshness(monkeypatch):
    times = iter([100.0, 100.0, 116.0])
    monkeypatch.setattr(module, "monotonic", lambda: next(times, 116.0))
    reader, _ = reader_for(response())
    with pytest.raises(JupiterQuoteError, match="EXPIRED_QUOTE"):
        await reader.get_quote(USDC, SOL, 1000000)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [302, 400, 401, 429, 500])
async def test_http_failures_never_follow_redirects_or_expose_remote_body(status):
    reader, requests = reader_for({"error": "private-provider-message"}, status=status)
    with pytest.raises(JupiterQuoteError) as error:
        await reader.get_quote(USDC, SOL, 1000000)
    assert len(requests) == 1
    assert error.value.http_status == status
    assert "private-provider-message" not in str(error.value)


@pytest.mark.asyncio
async def test_integer_amounts_above_float_precision_are_preserved():
    amount = 2**53 + 1
    reader, requests = reader_for(response(inAmount=str(amount)))
    quote = await reader.get_quote(USDC, SOL, amount)
    assert quote.input_amount == amount
    assert requests[0].url.params['amount'] == str(amount)


@pytest.mark.asyncio
async def test_server_expiry_does_not_extend_local_quote_lifetime():
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    reader, _ = reader_for(response(expireAt=expiry.isoformat()))
    quote = await reader.get_quote(USDC, SOL, 1000000)
    assert 0 < (quote.expires_at - quote.checked_at).total_seconds() <= 15


@pytest.mark.asyncio
async def test_server_expiry_can_shorten_local_quote_lifetime():
    expiry = datetime.now(timezone.utc) + timedelta(seconds=10)
    reader, _ = reader_for(response(expireAt=expiry.isoformat()))
    quote = await reader.get_quote(USDC, SOL, 1000000)
    assert quote.expires_at == expiry


@pytest.mark.asyncio
async def test_malformed_json_is_rejected_without_provider_body():
    reader = JupiterQuoteReader(transport=httpx.MockTransport(lambda request: httpx.Response(200, text='private-provider-body')))
    with pytest.raises(JupiterQuoteError, match='INVALID_RESPONSE'):
        await reader.get_quote(USDC, SOL, 1000000)


@pytest.mark.asyncio
async def test_timeout_does_not_trigger_an_automatic_retry():
    requests = []

    def handle(request):
        requests.append(request)
        raise httpx.ReadTimeout("do-not-echo-provider-details", request=request)

    reader = JupiterQuoteReader(transport=httpx.MockTransport(handle))
    with pytest.raises(JupiterQuoteError, match="UNAVAILABLE"):
        await reader.get_quote(USDC, SOL, 1000000)
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_total_request_deadline_is_enforced(monkeypatch):
    monkeypatch.setattr(module, '_HTTP_TIMEOUT_SECONDS', 0.01)

    async def handle(request):
        await module.asyncio.sleep(0.1)
        return httpx.Response(200, json=response())

    reader = JupiterQuoteReader(transport=httpx.MockTransport(handle))
    with pytest.raises(JupiterQuoteError, match='UNAVAILABLE'):
        await reader.get_quote(USDC, SOL, 1000000)


@pytest.mark.asyncio
async def test_keyless_requests_are_spaced_without_automatic_retries(monkeypatch):
    monkeypatch.setattr(module, "monotonic", lambda: 100.0)
    sleep = AsyncMock()
    monkeypatch.setattr(module.asyncio, "sleep", sleep)
    reader, requests = reader_for(response())
    await reader.get_quote(USDC, SOL, 1000000)
    await reader.get_quote(USDC, SOL, 1000000)
    assert len(requests) == 2
    assert sleep.await_args.args[0] >= 2
