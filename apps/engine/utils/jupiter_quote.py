import asyncio
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Literal

import httpx

_ORDER_URL = "https://api.jup.ag/swap/v2/order"
_BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_U64_MAX = 2**64 - 1
_MAX_AGE_SECONDS = 15.0
_HTTP_TIMEOUT_SECONDS = 8.0
_REQUEST_INTERVAL_SECONDS = 2.1


class JupiterQuoteError(RuntimeError):
    def __init__(self, code: str, http_status: int | None = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


@dataclass(frozen=True)
class JupiterQuote:
    input_mint: str
    output_mint: str
    input_amount: int
    output_amount: int
    min_output_amount: int
    slippage_bps: int
    fee_bps: int
    fee_mint: str
    router: str
    checked_at: datetime
    expires_at: datetime
    _issued_monotonic: float = field(repr=False)
    _deadline_monotonic: float = field(repr=False)
    source: Literal["JUPITER_SWAP_V2"] = "JUPITER_SWAP_V2"
    execution_enabled: Literal[False] = False
    price_impact_pct: float | None = None

    @property
    def is_fresh(self) -> bool:
        return self._issued_monotonic <= monotonic() < self._deadline_monotonic

    def require_fresh(self) -> None:
        if not self.is_fresh:
            raise JupiterQuoteError("EXPIRED_QUOTE")


def _mint(value: str) -> str:
    if not isinstance(value, str) or not 32 <= len(value) <= 44:
        raise ValueError("INVALID_MINT")
    number = 0
    for char in value:
        if char not in _BASE58:
            raise ValueError("INVALID_MINT")
        number = number * 58 + _BASE58.index(char)
    length = (number.bit_length() + 7) // 8 + len(value) - len(value.lstrip("1"))
    if length != 32:
        raise ValueError("INVALID_MINT")
    return value


def _integer(value: int, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("INVALID_INTEGER")
    return value


def _amount(value: str) -> int:
    if not isinstance(value, str) or not 1 <= len(value) <= 20 or not value.isascii() or not value.isdecimal():
        raise ValueError("INVALID_AMOUNT")
    return _integer(int(value), 1, _U64_MAX)


def _parse_quote(data: object, input_mint: str, output_mint: str, amount: int,
                 slippage_bps: int, max_fee_bps: int, started: float, received: float) -> JupiterQuote:
    try:
        if not isinstance(data, dict) or any(data.get(key) is not None for key in ("error", "errorCode", "errorMessage")):
            raise ValueError("INVALID_RESPONSE")
        if data["transaction"] not in (None, "") or data.get("taker") is not None:
            raise JupiterQuoteError("UNEXPECTED_TRANSACTION_OR_WALLET")
        if data["inputMint"] != input_mint or data["outputMint"] != output_mint or _amount(data["inAmount"]) != amount:
            raise ValueError("MISMATCHED_REQUEST")
        if data["swapMode"] != "ExactIn":
            raise ValueError("UNSUPPORTED_SWAP_MODE")
        out_amount = _amount(data["outAmount"])
        min_amount = _amount(data["otherAmountThreshold"])
        actual_slippage = _integer(data["slippageBps"], 0, 10000)
        fee_bps = _integer(data["feeBps"], 0, 10000)
        if fee_bps > max_fee_bps:
            raise JupiterQuoteError("FEE_LIMIT_EXCEEDED")
        if actual_slippage > slippage_bps or min_amount < out_amount * (10000 - actual_slippage) // 10000:
            raise JupiterQuoteError("SLIPPAGE_LIMIT_EXCEEDED")
        if min_amount > out_amount or data["feeMint"] not in (input_mint, output_mint):
            raise ValueError("INVALID_THRESHOLD_OR_FEE_MINT")
        router = data["router"]
        if router not in ("metis", "jupiterz", "dflow", "okx"):
            raise ValueError("UNSUPPORTED_ROUTER")
        impact = data.get('priceImpact')
        if impact is not None and (isinstance(impact, bool) or not isinstance(impact, (int, float)) or not math.isfinite(impact)):
            raise ValueError('INVALID_IMPACT')
        checked_at = datetime.now(timezone.utc)
        age = received - started
        if not 0 <= age < _MAX_AGE_SECONDS:
            raise JupiterQuoteError("EXPIRED_QUOTE")
        expires_at = checked_at + timedelta(seconds=_MAX_AGE_SECONDS - age)
        if data.get("expireAt") is not None:
            expiry = datetime.fromisoformat(data["expireAt"].replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                raise ValueError("INVALID_EXPIRY")
            expires_at = min(expires_at, expiry)
        quote = JupiterQuote(
            input_mint=input_mint, output_mint=output_mint, input_amount=amount,
            output_amount=out_amount, min_output_amount=min_amount, slippage_bps=actual_slippage,
            fee_bps=fee_bps, fee_mint=data["feeMint"], router=router,
            checked_at=checked_at, expires_at=expires_at, _issued_monotonic=started,
            _deadline_monotonic=received + (expires_at - checked_at).total_seconds(),
            price_impact_pct=float(impact) if impact is not None else None,
        )
        quote.require_fresh()
        return quote
    except (KeyError, TypeError, ValueError, OverflowError, AttributeError):
        raise JupiterQuoteError("INVALID_RESPONSE") from None


class JupiterQuoteReader:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None):
        self._transport = transport
        self._lock = asyncio.Lock()
        self._next_request_at = 0.0

    async def get_quote(self, input_mint: str, output_mint: str, amount: int, *,
                        slippage_bps: int = 50, max_fee_bps: int = 30) -> JupiterQuote:
        _mint(input_mint)
        _mint(output_mint)
        _integer(amount, 1, _U64_MAX)
        _integer(slippage_bps, 0, 100)
        _integer(max_fee_bps, 0, 100)
        if input_mint == output_mint:
            raise ValueError("IDENTICAL_MINTS")
        async with self._lock:
            delay = self._next_request_at - monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            started = monotonic()
            self._next_request_at = started + _REQUEST_INTERVAL_SECONDS
            try:
                async with (
                    asyncio.timeout(_HTTP_TIMEOUT_SECONDS),
                    httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=False, transport=self._transport) as client,
                ):
                    response = await client.get(_ORDER_URL, params={
                        "inputMint": input_mint, "outputMint": output_mint,
                        "amount": str(amount), "slippageBps": str(slippage_bps),
                    })
                    response.raise_for_status()
                    data = response.json()
            except httpx.HTTPStatusError as error:
                if error.response.status_code == 400:
                    try:
                        body = error.response.json()
                    except ValueError:
                        body = None
                    if isinstance(body, dict) and body.get('transaction') in (None, '') and body.get('taker') is None:
                        codes = ('NO_ROUTES_FOUND', 'COULD_NOT_FIND_ANY_ROUTE')
                        if body.get('error') in codes or body.get('errorCode') in codes:
                            raise JupiterQuoteError('NO_ROUTE', http_status=400) from None
                raise JupiterQuoteError("HTTP_ERROR", http_status=error.response.status_code) from None
            except (httpx.HTTPError, TimeoutError):
                raise JupiterQuoteError("UNAVAILABLE") from None
            except ValueError:
                raise JupiterQuoteError("INVALID_RESPONSE") from None
            return _parse_quote(data, input_mint, output_mint, amount, slippage_bps,
                                max_fee_bps, started, monotonic())
