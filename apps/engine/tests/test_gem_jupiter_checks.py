import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest

from ml import hidden_gems, jupiter_check


def candidate(chain='solana'):
    return SimpleNamespace(chain=chain, token_address='token', gem_score=80, warnings=[], reasons=[], exec_check=None)


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['UNAVAILABLE', 'DEFERRED', 'STALE', 'REJECTED', 'NO_ENTRY_ROUTE', 'INVALID_INPUT'])
async def test_unverified_results_do_not_penalize_or_promote_candidates(monkeypatch, status):
    gem = candidate()
    result = {'status': status, 'checked': False, 'sellable': None, 'round_trip_loss_pct': None}
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', AsyncMock(return_value=[result]))
    await hidden_gems._apply_jupiter_checks([gem])
    assert gem.gem_score == 80
    assert gem.exec_check == result
    assert gem.warnings and 'non vérifiée' in gem.warnings[0]
    assert not gem.reasons
    assert 'honeypot' not in str(gem.warnings).lower()


@pytest.mark.asyncio
async def test_only_explicit_missing_exit_routes_get_the_existing_penalty(monkeypatch):
    gem = candidate()
    result = {'status': 'NO_EXIT_ROUTE', 'checked': True, 'sellable': False, 'round_trip_loss_pct': None}
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', AsyncMock(return_value=[result]))
    await hidden_gems._apply_jupiter_checks([gem])
    assert gem.gem_score == 40
    assert 'aucune route' in gem.warnings[0]
    assert 'honeypot' not in str(gem.warnings).lower()


@pytest.mark.asyncio
@pytest.mark.parametrize('loss,sellable,score', [(90, False, 40), (31, True, 50), (30, True, 68), (16, True, 68), (15, True, 80), (4, True, 80)])
async def test_existing_cost_thresholds_are_preserved(monkeypatch, loss, sellable, score):
    gem = candidate()
    result = {'status': 'QUOTED', 'checked': True, 'sellable': sellable, 'round_trip_loss_pct': loss}
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', AsyncMock(return_value=[result]))
    await hidden_gems._apply_jupiter_checks([gem])
    assert gem.gem_score == score
    if loss == 4:
        assert 'exécution non garantie' in gem.reasons[0]


@pytest.mark.asyncio
async def test_non_solana_candidates_are_not_sent_to_jupiter(monkeypatch):
    sol, evm = candidate(), candidate('ethereum')
    handler = AsyncMock(return_value=[{'status': 'DEFERRED', 'checked': False}])
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', handler)
    await hidden_gems._apply_jupiter_checks([sol, evm])
    handler.assert_awaited_once_with(['token'])
    assert evm.exec_check is None and not evm.warnings


@pytest.mark.asyncio
async def test_optional_enrichment_failure_is_visible_without_raw_error_details(monkeypatch):
    gem = candidate()
    handler = AsyncMock(side_effect=RuntimeError('private-provider-details'))
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', handler)
    await hidden_gems._apply_jupiter_checks([gem])
    assert gem.exec_check['status'] == 'UNAVAILABLE'
    assert gem.gem_score == 80
    assert 'private-provider-details' not in str(gem.exec_check) + str(gem.warnings)


@pytest.mark.asyncio
async def test_missing_result_is_not_silently_skipped(monkeypatch):
    gem = candidate()
    monkeypatch.setattr(jupiter_check, 'check_exit_liquidity_batch', AsyncMock(return_value=[]))
    await hidden_gems._apply_jupiter_checks([gem])
    assert gem.exec_check['checked'] is False
    assert gem.warnings


def _c(chain='solana', score=80, exec_check=None, honeypot=False):
    return SimpleNamespace(chain=chain, gem_score=score,
                           exec_check=exec_check, onchain={'honeypot': honeypot})


class TestPaperEntryGate:
    def test_solana_requires_verified_sellability(self):
        ok = {'checked': True, 'sellable': True}
        assert hidden_gems._paper_entry_ok(_c(exec_check=ok)) is True

    @pytest.mark.parametrize('chk', [
        None,
        {},
        {'checked': False, 'sellable': True},
        {'checked': True, 'sellable': False},
        {'checked': True, 'sellable': None},
        {'checked': False, 'status': 'DEFERRED'},
        {'checked': False, 'status': 'UNAVAILABLE'},
    ])
    def test_solana_unverified_or_unsellable_is_blocked(self, chk):
        assert hidden_gems._paper_entry_ok(_c(exec_check=chk)) is False

    def test_non_solana_uses_honeypot_flag_only(self):
        assert hidden_gems._paper_entry_ok(_c(chain='ethereum')) is True
        assert hidden_gems._paper_entry_ok(_c(chain='ethereum', honeypot=True)) is False

    def test_score_floor_and_honeypot_apply_everywhere(self):
        assert hidden_gems._paper_entry_ok(_c(score=59)) is False
        assert hidden_gems._paper_entry_ok(_c(honeypot=True)) is False


class TestJupiterAdapterGuards:
    def _adapter(self, monkeypatch):
        from risk.adapters import jupiter as ja
        monkeypatch.setattr(ja, "_LIVE_CHECK", None, raising=False)
        a = ja.JupiterAdapter.__new__(ja.JupiterAdapter)
        a._key_b58, a._rpc = "k", "rpc"
        a._keypair = None
        return a, ja

    @pytest.mark.asyncio
    async def test_kill_switch_blocks_swap(self, monkeypatch):
        a, _ = self._adapter(monkeypatch)
        monkeypatch.setenv("GEM_TRADING_DISABLED", "1")
        with pytest.raises(RuntimeError, match="kill switch|disabled"):
            await a.place_order("mintaddr12345678901234567890", "BUY", 10, 1.0)

    @pytest.mark.asyncio
    async def test_notional_cap_blocks_oversized_swap(self, monkeypatch):
        a, _ = self._adapter(monkeypatch)
        monkeypatch.delenv("GEM_TRADING_DISABLED", raising=False)
        monkeypatch.setenv("GEM_MAX_TRADE_USD", "25")
        with pytest.raises(ValueError, match="GEM_MAX_TRADE_USD"):
            await a.place_order("mintaddr12345678901234567890", "BUY", 30, 1.0)

    @pytest.mark.asyncio
    @pytest.mark.parametrize('chk', [
        {'checked': False, 'sellable': None, 'status': 'DEFERRED'},
        {'checked': True, 'sellable': False, 'status': 'NO_EXIT_ROUTE'},
        {'checked': True, 'sellable': None, 'status': 'STALE'},
    ])
    async def test_unverified_sellability_blocks_swap(self, monkeypatch, chk):
        a, _ = self._adapter(monkeypatch)
        monkeypatch.delenv("GEM_TRADING_DISABLED", raising=False)
        from ml import jupiter_check
        monkeypatch.setattr(jupiter_check, "check_exit_liquidity",
                            AsyncMock(return_value=chk))
        with pytest.raises(RuntimeError, match="sellability refused"):
            await a.place_order("mintaddr12345678901234567890", "BUY", 10, 1.0)

    @pytest.mark.asyncio
    async def test_sellability_check_failure_blocks_swap(self, monkeypatch):
        a, _ = self._adapter(monkeypatch)
        monkeypatch.delenv("GEM_TRADING_DISABLED", raising=False)
        from ml import jupiter_check
        monkeypatch.setattr(jupiter_check, "check_exit_liquidity",
                            AsyncMock(side_effect=RuntimeError("boom")))
        with pytest.raises(RuntimeError, match="check failed"):
            await a.place_order("mintaddr12345678901234567890", "BUY", 10, 1.0)


class TestGemAdapterRegistration:
    def test_jupiter_adapter_not_registered_without_venue_whitelist(self):
        import importlib
        import risk.execution as ex
        importlib.reload(ex)
        assert "GEM" not in ex._LIVE_ADAPTERS

    def test_jupiter_adapter_registered_when_gem_whitelisted(self, monkeypatch):
        import importlib
        import risk.execution as ex
        monkeypatch.setenv("EXECUTION_LIVE_VENUES", "GEM")
        monkeypatch.setenv("SOLANA_PRIVATE_KEY", "x" * 87)
        importlib.reload(ex)
        try:
            import risk.adapters.jupiter as ja
            monkeypatch.setattr(ja.JupiterAdapter, "from_env",
                                classmethod(lambda cls: object()))
            ex._register_adapters()
            assert "GEM" in ex._LIVE_ADAPTERS
        finally:
            monkeypatch.delenv("EXECUTION_LIVE_VENUES", raising=False)
            importlib.reload(ex)


# ── close_venue_position : MARGIN/SYNTHETIC → bridge MT5 ───────────

import risk.execution as rx


def test_close_venue_mt5_missing_bridge(monkeypatch):
    """Sans MT5_BRIDGE_URL/TOKEN → refus explicite, jamais d'appel HTTP."""
    import asyncio
    monkeypatch.setenv("MT5_BRIDGE_URL", "")
    monkeypatch.setenv("MT5_BRIDGE_TOKEN", "")
    r = asyncio.run(rx._close_via_mt5_bridge("EUR/USD"))
    assert r["closed"] is False
    assert "non configuré" in r["reason"]


def test_mt5_symbol_mapping():
    assert rx._mt5_symbol("EUR/USD") == "EURUSD"
    assert rx._mt5_symbol("V75") == "V75"
    assert rx._mt5_symbol("boom1000") == "BOOM1000"


def test_close_venue_routes_margin_to_bridge(monkeypatch):
    """Profil venue=MARGIN → _close_via_mt5_bridge, jamais _LIVE_ADAPTERS."""
    import asyncio
    calls = []

    async def fake_bridge(symbol):
        calls.append(symbol)
        return {"closed": True, "venue": "MT5"}

    class FakeProfile:
        async def get(self, symbol):
            return {"venue": "MARGIN"}

    monkeypatch.setattr(rx, "_close_via_mt5_bridge", fake_bridge)
    monkeypatch.setenv("MT5_BRIDGE_URL", "http://b:5555")
    monkeypatch.setenv("MT5_BRIDGE_TOKEN", "t")

    import utils.instrument_profile as ip
    async def fake_profile(symbol):
        return {"venue": "MARGIN"}
    monkeypatch.setattr(ip, "get_instrument_profile", fake_profile)

    r = asyncio.run(rx.close_venue_position("p1", "EUR/USD"))
    assert r["closed"] is True
    assert calls == ["EUR/USD"]
