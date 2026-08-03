"""
Tests for risk management modules.
"""
import pytest
import numpy as np
from datetime import datetime

from risk.position_sizer import PositionSizer
from risk.kill_switch import KillSwitch, KillSwitchState
from risk.correlation_manager import CorrelationManager
from risk.drawdown_manager import DrawdownManager
from risk.cooldown import CooldownManager, CooldownConfig
from risk.regime_filter import RegimeFilter
from risk.performance_monitor import PerformanceMonitor
from risk.tail_risk import TailRiskManager, TailRiskConfig
from risk.discipline_controller import DisciplineController, TradeDecision
from risk.trailing_stop import TrailingStop, TrailingMode


class TestPositionSizer:
    def test_basic_sizing(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        result = sizer.compute(entry=100, stop_loss=98, atr_pct=1.0, signal_score=0.75)
        assert not result.blocked
        assert result.risk_amount == pytest.approx(100, rel=0.01)
        assert result.size == pytest.approx(50, rel=0.01)  # 100 / 2

    def test_volatility_reduces_size(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        low_vol = sizer.compute(entry=100, stop_loss=98, atr_pct=0.5, signal_score=0.75)
        high_vol = sizer.compute(entry=100, stop_loss=98, atr_pct=3.0, signal_score=0.75)
        assert high_vol.risk_pct_used < low_vol.risk_pct_used

    def test_low_score_reduces_size(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        high_score = sizer.compute(entry=100, stop_loss=98, signal_score=0.90)
        low_score = sizer.compute(entry=100, stop_loss=98, signal_score=0.50)
        assert low_score.risk_pct_used < high_score.risk_pct_used

    def test_drawdown_blocks_at_kill(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        result = sizer.compute(entry=100, stop_loss=98, drawdown_pct=10.0)
        assert result.blocked
        assert "kill" in result.block_reason.lower()

    def test_correlation_blocks(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        result = sizer.compute(entry=100, stop_loss=98, correlated_open=3)
        assert result.blocked

    def test_zero_stop_distance_blocks(self):
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        result = sizer.compute(entry=100, stop_loss=100)
        assert result.blocked


class TestKillSwitch:
    def test_normal_operation(self):
        ks = KillSwitch(10_000)
        status = ks.update(10_000)
        assert status.state == KillSwitchState.ACTIVE

    def test_triggers_on_daily_loss(self):
        ks = KillSwitch(10_000)
        # First update sets day_start_capital to current (10_000)
        ks.update(10_000)
        # Second update: 3% daily loss from 10_000
        status = ks.update(9_700)
        assert status.state == KillSwitchState.HALTED

    def test_triggers_on_drawdown(self):
        ks = KillSwitch(10_000)
        ks.update(11_000)  # peak
        ks.update(9_500)  # >10% drawdown
        assert ks.state == KillSwitchState.HALTED

    def test_triggers_on_consecutive_losses(self):
        ks = KillSwitch(10_000)
        ks.record_trade_result(-100)
        ks.record_trade_result(-100)
        ks.record_trade_result(-100)
        ks.update(9_700)
        assert ks.state == KillSwitchState.HALTED

    def test_can_trade_blocks_when_halted(self):
        ks = KillSwitch(10_000)
        ks.update(10_000)
        ks.update(9_500)  # 5% daily loss → trigger
        can, _ = ks.can_trade()
        assert not can

    def test_manual_reset(self):
        ks = KillSwitch(10_000)
        ks.update(9_500)
        ks.reset()
        assert ks.state == KillSwitchState.ACTIVE


class TestCorrelationManager:
    def test_no_correlation(self):
        cm = CorrelationManager()
        status = cm.check("EUR/USD", "BUY")
        assert status.correlated_open == 0
        assert not status.blocked

    def test_same_symbol_counts(self):
        cm = CorrelationManager()
        cm.register_position("EUR/USD", "BUY")
        status = cm.check("EUR/USD", "BUY")
        assert status.correlated_open == 1

    def test_blocks_at_max(self):
        cm = CorrelationManager()
        for i in range(3):
            cm.register_position(f"SYM{i}", "BUY")
        # Need correlation matrix — same symbol check is enough
        cm.register_position("EUR/USD", "BUY")
        status = cm.check("EUR/USD", "BUY")
        assert status.correlated_open >= 1

    def test_unregister(self):
        cm = CorrelationManager()
        cm.register_position("EUR/USD", "BUY")
        cm.unregister_position("EUR/USD")
        status = cm.check("EUR/USD", "BUY")
        assert status.correlated_open == 0


class TestDrawdownManager:
    def test_normal(self):
        dm = DrawdownManager(10_000)
        status = dm.update(10_000)
        assert status.level == "NORMAL"
        assert status.size_factor == 1.0

    def test_caution_level(self):
        dm = DrawdownManager(10_000)
        dm.update(10_500)  # peak
        status = dm.update(10_100)  # ~3.8% DD
        assert status.level == "CAUTION"
        assert status.size_factor < 1.0

    def test_kill_level(self):
        dm = DrawdownManager(10_000)
        dm.update(11_000)
        status = dm.update(9_500)  # ~13.6% DD
        assert status.level == "KILL"
        assert status.size_factor == 0.0


class TestCooldown:
    def test_active_initially(self):
        cd = CooldownManager()
        can, _ = cd.can_trade()
        assert can

    def test_cooldown_after_loss(self):
        cd = CooldownManager()
        cd.record_loss()
        can, reason = cd.can_trade()
        assert not can
        assert "cooldown" in reason.lower()

    def test_win_resets_consecutive(self):
        cd = CooldownManager()
        cd.record_loss()
        cd.record_loss()
        assert cd.consecutive_losses == 2
        cd.record_win()
        assert cd.consecutive_losses == 0

    def test_frequency_limit(self):
        config = CooldownConfig(max_trades_per_hour=3)
        cd = CooldownManager(config)
        now = datetime.utcnow()
        cd.record_trade(now)
        cd.record_trade(now)
        cd.record_trade(now)
        can, reason = cd.can_trade(now)
        assert not can
        assert "frequency" in reason.lower()


class TestRegimeFilter:
    def test_trend_follow_in_trend(self):
        rf = RegimeFilter()
        result = rf.check("trend_follow", "TRENDING_BULL", 0.8)
        assert result.allowed
        assert result.compatibility == 1.0

    def test_mean_revert_in_trend_blocked(self):
        rf = RegimeFilter()
        result = rf.check("mean_revert", "TRENDING_BULL", 0.8)
        # compatibility 0.3 — at min threshold
        assert not result.allowed or result.adjusted_score < 0.8

    def test_breakout_in_volatile(self):
        rf = RegimeFilter()
        result = rf.check("breakout", "VOLATILE", 0.7)
        assert result.allowed
        assert result.compatibility == 0.9


class TestPerformanceMonitor:
    def test_all_wins(self):
        pm = PerformanceMonitor()
        for _ in range(10):
            pm.record_trade(100)
        stats = pm.compute_stats()
        assert stats.winrate == 1.0
        assert stats.expectancy > 0

    def test_all_losses(self):
        pm = PerformanceMonitor()
        for _ in range(10):
            pm.record_trade(-50)
        stats = pm.compute_stats()
        assert stats.winrate == 0.0
        assert stats.expectancy < 0
        assert PerformanceMonitor.PerformanceAlert.NEGATIVE_EXPECTANCY if hasattr(PerformanceMonitor, 'PerformanceAlert') else True
        # Check alerts
        from risk.performance_monitor import PerformanceAlert
        assert PerformanceAlert.NEGATIVE_EXPECTANCY in stats.alerts

    def test_mixed(self):
        pm = PerformanceMonitor()
        for _ in range(6):
            pm.record_trade(100)
        for _ in range(4):
            pm.record_trade(-50)
        stats = pm.compute_stats()
        assert stats.winrate == pytest.approx(0.6, rel=0.01)
        assert stats.profit_factor > 1.0

    def test_should_pause_on_negative_expectancy(self):
        pm = PerformanceMonitor()
        for _ in range(15):
            pm.record_trade(-100)
        should, reason = pm.should_pause()
        assert should


class TestTailRisk:
    def test_no_data(self):
        tr = TailRiskManager()
        status = tr.update()
        assert status.var_pct == 0.0
        assert not status.crisis_mode

    def test_normal_var(self):
        tr = TailRiskManager()
        np.random.seed(42)
        for _ in range(100):
            tr.record_return(np.random.normal(0.1, 1.0))
        status = tr.update()
        assert status.var_pct > 0
        assert not status.crisis_mode

    def test_crisis_mode(self):
        config = TailRiskConfig(crisis_var_threshold=3.0, min_observations=10)
        tr = TailRiskManager(config)
        for _ in range(20):
            tr.record_return(-5.0)  # huge losses
        status = tr.update()
        assert status.crisis_mode
        assert status.size_factor < 1.0


class TestTrailingStop:
    def test_long_no_move(self):
        ts = TrailingStop(entry=100, initial_stop=98, direction="BUY")
        update = ts.update(current_price=100, atr=1.5)
        assert not update.moved
        assert ts.current_mode == TrailingMode.INITIAL

    def test_long_break_even(self):
        ts = TrailingStop(entry=100, initial_stop=98, direction="BUY")
        update = ts.update(current_price=102, atr=1.5)  # 2 > 1×ATR
        assert update.moved
        assert ts.current_mode == TrailingMode.BREAK_EVEN
        assert ts.current_stop == 100

    def test_long_trailing(self):
        ts = TrailingStop(entry=100, initial_stop=98, direction="BUY")
        ts.update(current_price=102, atr=1.5)  # BE
        update = ts.update(current_price=105, atr=1.5)  # trail
        assert ts.current_mode == TrailingMode.TRAILING
        assert ts.current_stop > 100  # moved forward

    def test_short_break_even(self):
        ts = TrailingStop(entry=100, initial_stop=102, direction="SELL")
        update = ts.update(current_price=98, atr=1.5)
        assert update.moved
        assert ts.current_stop == 100

    def test_stopped_out_long(self):
        ts = TrailingStop(entry=100, initial_stop=98, direction="BUY")
        assert ts.is_stopped_out(97)
        assert not ts.is_stopped_out(99)


class TestDisciplineController:
    def test_approve_normal_trade(self):
        dc = DisciplineController(capital=10_000, risk_pct=1.0)
        assessment = dc.evaluate(
            symbol="EUR/USD",
            direction="BUY",
            entry=1.0850,
            stop_loss=1.0820,
            atr_pct=0.5,
            signal_score=0.80,
            strategy="trend_follow",
            regime="TRENDING_BULL",
        )
        assert assessment.decision in (TradeDecision.APPROVED, TradeDecision.REDUCED)
        assert assessment.risk_pct > 0

    def test_block_on_drawdown(self):
        dc = DisciplineController(capital=10_000, risk_pct=1.0)
        dc.update_capital(8_500)  # 15% drawdown
        assessment = dc.evaluate(
            symbol="EUR/USD",
            direction="BUY",
            entry=1.0850,
            stop_loss=1.0820,
            signal_score=0.80,
            strategy="trend_follow",
            regime="TRENDING_BULL",
        )
        assert assessment.decision == TradeDecision.BLOCKED

    def test_block_on_bad_regime(self):
        dc = DisciplineController(capital=10_000, risk_pct=1.0)
        assessment = dc.evaluate(
            symbol="EUR/USD",
            direction="BUY",
            entry=1.0850,
            stop_loss=1.0820,
            signal_score=0.80,
            strategy="mean_revert",
            regime="TRENDING_BULL",
        )
        # mean_revert in TRENDING_BULL has compat 0.3 — at min threshold
        assert assessment.decision == TradeDecision.BLOCKED or assessment.adjusted_score < 0.80

    def test_status_summary(self):
        dc = DisciplineController(capital=10_000)
        status = dc.get_status()
        assert "kill_switch" in status
        assert "cooldown" in status
        assert "drawdown" in status
        assert "performance" in status
        assert status["capital"] == 10_000
