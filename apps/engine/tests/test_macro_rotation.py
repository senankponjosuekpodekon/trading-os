"""Tests for macro rotation signal module."""
import asyncio
from unittest.mock import AsyncMock, patch
from risk.macro_rotation import compute_macro_rotation


class TestMacroRotation:
    def test_risk_off_phase(self):
        """BTC crashing > 5% → RISK_OFF."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 52.0, "eth_dominance": 17.0, "total_mcap_change_24h": -8.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": -3.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 90000, "change_24h": -7.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": -10.0, "max_24h": -2.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=15)):
                result = await compute_macro_rotation()
                return result
        result = asyncio.run(_run())
        assert result["phase"] == "RISK_OFF"
        assert result["confidence"] > 0
        assert "Réduire" in result["implication"]

    def test_btc_phase(self):
        """BTC rising, ETH/BTC falling, high dominance → BTC phase."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 55.0, "eth_dominance": 16.0, "total_mcap_change_24h": 3.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.04, "change_24h": -2.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 5.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 2.0, "max_24h": 5.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=55)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "BTC"
        assert "BTC" in result["phase_label"]

    def test_eth_phase(self):
        """ETH outperforming BTC → ETH phase."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 48.0, "eth_dominance": 18.0, "total_mcap_change_24h": 5.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": 5.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 2.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 3.0, "max_24h": 8.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=60)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "ETH"
        assert "ETH" in result["phase_label"]

    def test_altcoins_phase(self):
        """Altcoins outperforming BTC significantly → ALTCOINS phase."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 42.0, "eth_dominance": 17.0, "total_mcap_change_24h": 8.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": 1.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 1.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 12.0, "max_24h": 25.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=65)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "ALTCOINS"
        assert "Altcoins" in result["phase_label"]

    def test_memecoins_phase(self):
        """Extreme greed + altcoins pumping hard → MEMECOINS phase."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 40.0, "eth_dominance": 16.0, "total_mcap_change_24h": 10.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": 1.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 3.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 15.0, "max_24h": 50.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=85)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "MEMECOINS"
        assert result["warning"] is not None
        assert "fin" in result["warning"].lower() or "prudence" in result["warning"].lower()

    def test_transition_phase(self):
        """No clear rotation → TRANSITION."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 50.0, "eth_dominance": 17.0, "total_mcap_change_24h": 0.5})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": 0.5})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 0.5})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 1.0, "max_24h": 3.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=50)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "TRANSITION"
        assert result["confidence"] <= 30

    def test_no_data_returns_unknown(self):
        """All fetches fail → UNKNOWN."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value=None)), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value=None)), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value=None)), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value=None)), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=None)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert result["phase"] == "UNKNOWN"
        assert result["confidence"] == 0

    def test_data_fields_populated(self):
        """Result should contain all expected data fields."""
        async def _run():
            with patch("risk.macro_rotation._fetch_btc_dominance", new=AsyncMock(return_value={"btc_dominance": 52.0, "eth_dominance": 17.0, "total_mcap_change_24h": 2.0})), \
                 patch("risk.macro_rotation._fetch_eth_btc_ratio", new=AsyncMock(return_value={"price": 0.05, "change_24h": -1.0})), \
                 patch("risk.macro_rotation._fetch_btc_24h", new=AsyncMock(return_value={"price": 100000, "change_24h": 3.0})), \
                 patch("risk.macro_rotation._fetch_top_altcoins_performance", new=AsyncMock(return_value={"avg_24h": 2.0, "max_24h": 5.0, "count": 8})), \
                 patch("risk.macro_rotation._fetch_fear_greed", new=AsyncMock(return_value=55)):
                return await compute_macro_rotation()
        result = asyncio.run(_run())
        assert "btc_dominance" in result["data"]
        assert "btc_change_24h" in result["data"]
        assert "eth_btc_change_24h" in result["data"]
        assert "altcoins_avg_24h" in result["data"]
        assert "fear_greed" in result["data"]
        assert "implication" in result
