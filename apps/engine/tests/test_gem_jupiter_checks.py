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
