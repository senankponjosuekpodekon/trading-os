"""Tests for the Staged Stop Engine."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from routers.risk import compute_staged_stop


class TestStagedStop:
    def test_initial_stage_buy(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95
        )
        assert stop == 95
        assert stage == "initial"

    def test_initial_stage_sell(self):
        stop, stage, reason = compute_staged_stop(
            direction="SELL", entry_price=100, initial_stop=105
        )
        assert stop == 105
        assert stage == "initial"

    def test_break_even_after_tp1_buy(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            reached_tps=[1]
        )
        assert stop == 100
        assert stage == "break_even"

    def test_break_even_after_tp1_sell(self):
        stop, stage, reason = compute_staged_stop(
            direction="SELL", entry_price=100, initial_stop=105,
            reached_tps=[1]
        )
        assert stop == 100
        assert stage == "break_even"

    def test_structure_after_tp2_buy(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            structure_stop=103, reached_tps=[1, 2]
        )
        assert stop == 103
        assert stage == "structure"

    def test_structure_after_tp2_sell(self):
        stop, stage, reason = compute_staged_stop(
            direction="SELL", entry_price=100, initial_stop=105,
            structure_stop=97, reached_tps=[1, 2]
        )
        assert stop == 97
        assert stage == "structure"

    def test_trailing_after_tp3_buy(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            structure_stop=103, trailing_stop=108, reached_tps=[1, 2, 3]
        )
        assert stop == 108
        assert stage == "trailing"

    def test_trailing_after_tp3_sell(self):
        stop, stage, reason = compute_staged_stop(
            direction="SELL", entry_price=100, initial_stop=105,
            structure_stop=97, trailing_stop=92, reached_tps=[1, 2, 3]
        )
        assert stop == 92
        assert stage == "trailing"

    def test_break_even_custom_trigger(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            break_even_trigger=99, reached_tps=[1]
        )
        # Trigger is worse than entry -> max(entry, trigger) used
        assert stop == 100

    def test_structure_not_worse_than_be(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            structure_stop=98, reached_tps=[1, 2]
        )
        # Structure stop below BE -> stay at BE (entry)
        assert stop == 100

    def test_trailing_ignored_if_worse(self):
        stop, stage, reason = compute_staged_stop(
            direction="BUY", entry_price=100, initial_stop=95,
            structure_stop=103, trailing_stop=98, reached_tps=[1, 2, 3]
        )
        # Trailing 98 is worse than current structure stop -> ignore
        assert stop == 103
        assert stage == "structure"
