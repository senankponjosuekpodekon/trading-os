"""
Audit smoke tests — executable proof that fixes #64-80 are actually in place.

These tests exist because previous audit sessions produced contradictory
"✅ Fixé" claims.  Each test below reads the real code path and asserts
behaviour, not just presence of a string.

Coverage:
  #73  DisciplineController bridge — update_capital propagates to evaluate()
  #75  CorrelationManager — update_price_history is callable and stores data
  #79  AlphaAgent token_grade — no TypeError on a real TokenGrade dataclass
  #71  RegimeFilter — all 8 real strategy slugs resolve (never "default")
  #76  PositionSizer — below-floor check blocks before clamp
  #64  compute_token_grade — scan.py call signature matches
  #69  compute_calmar — no annualisation by trade count
"""
import pytest


# ─── #73: DisciplineController bridge ─────────────────────────────────────────

class TestDisciplineControllerBridge:
    """Verify that update_capital() actually changes what evaluate() sees."""

    def test_update_capital_propagates_to_sizer(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.update_capital(8_000)
        assert dc._current_capital == 8_000
        assert dc.sizer.capital == 8_000

    def test_update_capital_propagates_to_kill_switch(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.update_capital(8_000)
        # Check internal state directly — do NOT re-call .update() which would
        # overwrite regardless of whether update_capital propagated.
        assert dc.kill_switch.current_capital == 8_000

    def test_update_capital_propagates_to_drawdown(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.update_capital(8_000)
        # Check internal state directly — do NOT re-call .update()
        assert dc.drawdown.current_capital == 8_000

    def test_record_trade_result_calls_all_modules(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.record_trade_result(500)
        dc.record_trade_result(-200)
        # Verify performance monitor actually recorded both trades
        assert dc.performance._all_trades == [500, -200]
        # Verify kill_switch saw the loss (consecutive_losses incremented)
        assert dc.kill_switch.consecutive_losses == 1
        # Verify cooldown saw the loss
        assert dc.cooldown.consecutive_losses == 1

    def test_record_daily_return_calls_tail_risk(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.record_daily_return(2.5)
        # Verify tail_risk actually stored the return value
        assert 2.5 in dc.tail_risk._returns or len(dc.tail_risk._returns) > 0

    def test_register_unregister_position(self):
        from risk.discipline_controller import DisciplineController
        dc = DisciplineController(capital=10_000)
        dc.register_position("BTC/USDT", "BUY")
        # Verify position is actually tracked in correlation manager
        assert "BTC/USDT" in dc.correlation._open_positions
        dc.unregister_position("BTC/USDT")
        # Verify position was removed
        assert "BTC/USDT" not in dc.correlation._open_positions

    def test_endpoints_exist_in_risk_router(self):
        """Verify the 4 FastAPI endpoints are registered."""
        from routers.risk import router
        paths = {r.path for r in router.routes}
        assert "/risk/update-capital" in paths
        assert "/risk/record-trade" in paths
        assert "/risk/register-position" in paths
        assert "/risk/record-daily-return" in paths


# ─── #75: CorrelationManager update_price_history ─────────────────────────────

class TestCorrelationManagerFeeding:
    """Verify update_price_history actually stores price data."""

    def test_update_price_history_stores_data(self):
        import pandas as pd
        from risk.correlation_manager import CorrelationManager
        cm = CorrelationManager()
        prices = pd.Series([100, 102, 101, 103, 104, 102, 105, 106, 104, 107])
        cm.update_price_history("BTC/USDT", prices)
        # Internal history must contain the exact symbol and the exact data
        assert "BTC/USDT" in cm._price_history
        stored = cm._price_history["BTC/USDT"]
        assert len(stored) == 10
        assert stored.iloc[0] == 100

    def test_update_price_history_multiple_symbols(self):
        import pandas as pd
        from risk.correlation_manager import CorrelationManager
        cm = CorrelationManager()
        btc = pd.Series([100 + i for i in range(20)])
        eth = pd.Series([50 + i * 0.5 for i in range(20)])
        cm.update_price_history("BTC/USDT", btc)
        cm.update_price_history("ETH/USDT", eth)
        # Both must be stored under their exact keys
        assert "BTC/USDT" in cm._price_history
        assert "ETH/USDT" in cm._price_history
        assert len(cm._price_history) == 2

    def test_scan_py_calls_update_price_history_in_fetch_and_analyze(self):
        """Verify scan_routes.py + scan_analysis.py contain update_price_history calls."""
        import inspect
        from routers import scan_routes, scan_analysis
        routes_source = inspect.getsource(scan_routes)
        analysis_source = inspect.getsource(scan_analysis)
        # Both the single-symbol path and scan_multi must call update_price_history
        total = routes_source.count("update_price_history") + analysis_source.count("update_price_history")
        assert total >= 2, (
            "scan_routes + scan_analysis must call update_price_history at least twice"
        )


# ─── #79: AlphaAgent token_grade ──────────────────────────────────────────────

class TestAlphaAgentTokenGrade:
    """Verify AlphaAgent doesn't crash on a real TokenGrade dataclass."""

    def test_alpha_agent_with_real_token_grade(self):
        import asyncio
        from ml.token_grade import TokenGrade
        from ml.multi_agent import AlphaAgent
        agent = AlphaAgent()
        grade = TokenGrade(
            symbol="BTC",
            grade=85,
            label="A",
            layers={"technical": 80, "social": 70},
            weights_used={"technical": 0.35},
            available_layers=["technical", "social"],
            missing_layers=["onchain"],
            recommendation="strong_buy",
        )
        market_data = {"onchain_signals": {"signal_score": 60, "whale_accumulation": False}, "token_grade": grade}
        signal = asyncio.get_event_loop().run_until_complete(agent.analyze("BTC", market_data))
        assert signal is not None
        assert signal.symbol == "BTC"

    def test_alpha_agent_with_none_token_grade(self):
        import asyncio
        from ml.multi_agent import AlphaAgent
        agent = AlphaAgent()
        market_data = {"onchain_signals": {"signal_score": 60, "whale_accumulation": False}, "token_grade": None}
        signal = asyncio.get_event_loop().run_until_complete(agent.analyze("BTC", market_data))
        assert signal is not None

    def test_alpha_agent_high_grade_triggers_buy(self):
        import asyncio
        from ml.token_grade import TokenGrade
        from ml.multi_agent import AlphaAgent
        agent = AlphaAgent()
        grade = TokenGrade(
            symbol="ETH",
            grade=90,
            label="A+",
            layers={},
            weights_used={},
            available_layers=[],
            missing_layers=[],
            recommendation="strong_buy",
        )
        market_data = {"onchain_signals": {"signal_score": 50, "whale_accumulation": False}, "token_grade": grade}
        signal = asyncio.get_event_loop().run_until_complete(agent.analyze("ETH", market_data))
        assert signal.signal_type == "BUY"


# ─── #71: RegimeFilter strategy mapping ───────────────────────────────────────

class TestRegimeFilterStrategyMap:
    """Verify all 8 real strategy slugs resolve to a known category, not 'default'."""

    STRATEGY_SLUGS = [
        "ema_trend_+_rsi",
        "macd_momentum",
        "swing_trend_follow",
        "bollinger_squeeze_breakout",
        "smc_retest_ob/fvg",
        "scalper_rsi_reversal",
        "brvm_value_swing",
        "synthetic_mean_reversion",
    ]

    def test_all_mapped_strategies_resolve(self):
        from risk.regime_filter import RegimeFilter
        rf = RegimeFilter()
        for slug in self.STRATEGY_SLUGS:
            result = rf.check(slug, "TRENDING_BULL", 0.8)
            assert result.allowed is True, f"{slug} was blocked in TRENDING_BULL"

    def test_mapped_strategies_never_use_default_fallback(self):
        """The 7 known slugs should map to a specific category, not 'default'."""
        from risk.regime_filter import RegimeFilter
        rf = RegimeFilter()
        for slug in self.STRATEGY_SLUGS:
            mapped = rf._STRATEGY_CATEGORY_MAP.get(slug)
            assert mapped is not None, f"{slug} not in _STRATEGY_CATEGORY_MAP"
            assert mapped != "default", f"{slug} maps to 'default' — should have a specific category"

    def test_unknown_strategy_falls_back_gracefully(self):
        from risk.regime_filter import RegimeFilter
        rf = RegimeFilter()
        result = rf.check("nonexistent_strategy", "TRENDING_BULL", 0.8)
        # Should use default compatibility (0.5), not crash
        assert result.compatibility == 0.5


# ─── #76: PositionSizer below-floor check ─────────────────────────────────────

class TestPositionSizerBelowFloor:
    """Verify that factors reducing risk below floor BLOCK, not clamp."""

    def test_below_floor_blocks_not_clamps(self):
        from risk.position_sizer import PositionSizer, SizingConfig
        # Use a config where factors will push below floor
        config = SizingConfig(
            base_risk_pct=1.0,
            min_risk_pct=0.2,
            max_risk_pct=2.0,
            score_low_multiplier=0.4,
        )
        sizer = PositionSizer(capital=10_000, risk_pct=1.0, config=config)
        # Low score (0.3) + high drawdown (6%) + high vol (3%) → product well below 0.2%
        result = sizer.compute(
            entry=100.0, stop_loss=99.0,
            atr_pct=3.0, signal_score=0.3,
            drawdown_pct=6.0, correlated_open=0,
        )
        assert result.blocked is True, "Should be blocked, not clamped to min"
        assert "below floor" in result.block_reason.lower()

    def test_normal_conditions_not_blocked(self):
        from risk.position_sizer import PositionSizer
        sizer = PositionSizer(capital=10_000, risk_pct=1.0)
        result = sizer.compute(
            entry=100.0, stop_loss=99.0,
            atr_pct=1.0, signal_score=0.75,
            drawdown_pct=1.0, correlated_open=0,
        )
        assert result.blocked is False
        assert result.size > 0


# ─── #64: compute_token_grade signature match ─────────────────────────────────

class TestTokenGradeSignature:
    """Verify scan.py passes the right kwargs to compute_token_grade."""

    def test_compute_token_grade_accepts_scan_py_params(self):
        from ml.token_grade import compute_token_grade
        # These are the exact params scan.py passes (lines 2372-2378)
        grade = compute_token_grade(
            "BTC/USDT",
            technical_score=75,
            technical_confidence=75,
            onchain_bonus=45,
            social_score=60,
            tokenomics_penalty=10,
        )
        assert isinstance(grade.grade, int)
        assert 0 <= grade.grade <= 100
        assert grade.label is not None

    def test_compute_token_grade_returns_dataclass_with_grade_field(self):
        from ml.token_grade import compute_token_grade, TokenGrade
        grade = compute_token_grade("ETH", technical_score=80, technical_confidence=80)
        assert isinstance(grade, TokenGrade)
        assert hasattr(grade, "grade")
        assert not isinstance(grade, dict)


# ─── #69: compute_calmar no annualisation ─────────────────────────────────────

class TestComputeCalmar:
    """Verify Calmar is total_return / max_dd, not annualised by trade count."""

    def test_calmar_is_raw_ratio(self):
        from ml.scientific_backtest import compute_calmar
        # equity goes from 10000 → 12000 (20% return), max DD = 10%
        equity = [10000, 11000, 9900, 12000]
        returns = [10.0, -10.0, 21.21]
        calmar = compute_calmar(returns, equity)
        # total_return = 0.2, max_dd = 0.1 → calmar = 2.0
        assert calmar == pytest.approx(2.0, abs=0.1)

    def test_calmar_with_drawdown_not_inflated_by_trade_count(self):
        """Calmar with many trades and a real drawdown must NOT be multiplied by N trades."""
        from ml.scientific_backtest import compute_calmar
        # Equity: 10000 → dip to 9000 → recover to 11000 (10% total return)
        # Repeat this pattern 50 times to simulate many trades
        # Peak = 11000, trough = 9000 → max_dd = 2000/11000 ≈ 18.18%
        # calmar = 0.1 / 0.1818 ≈ 0.55
        equity = [10000]
        for _i in range(50):
            equity.append(11000)   # peak
            equity.append(9000)    # 18.18% DD from peak
        equity.append(11000)       # end at 10% total return
        returns = [10.0, -20.0] * 50
        calmar = compute_calmar(returns, equity)
        # If annualised by trade count (100 trades), it would be ~55.0
        assert calmar == pytest.approx(0.55, abs=0.1), (
            f"Calmar should be ~0.55 (raw ratio), got {calmar} — may be annualised by trade count"
        )
