"""Dominance BTC / phase macro — règles pures (feature + sizing)."""

from risk.adaptive import (phase_multiplier, multiplier_from_stats,
                           gem_phase_gate, MULT_LOW, MULT_HIGH)
from ml.market_memory import _extract_features


# ── phase_multiplier ─────────────────────────────────────────────────

class TestPhaseMultiplier:
    def test_sell_always_neutral(self):
        out = phase_multiplier("SELL", "BTC/USDT", "RISK_OFF")
        assert out["multiplier"] == 1.0

    def test_non_crypto_neutral(self):
        assert phase_multiplier("BUY", "EUR/USD", "RISK_OFF")["multiplier"] == 1.0
        assert phase_multiplier("BUY", "XAU/USD", "ALTCOINS")["multiplier"] == 1.0

    def test_no_phase_neutral(self):
        assert phase_multiplier("BUY", "BTC/USDT", None)["multiplier"] == 1.0
        assert phase_multiplier("BUY", "BTC/USDT", "UNKNOWN")["multiplier"] == 1.0

    def test_btc_phase_favors_btc_penalizes_alts(self):
        assert phase_multiplier("BUY", "BTC/USDT", "BTC")["multiplier"] > 1.0
        assert phase_multiplier("BUY", "SOL/USDT", "BTC")["multiplier"] < 1.0

    def test_altseason_favors_alts(self):
        assert phase_multiplier("BUY", "SOL/USDT", "ALTCOINS")["multiplier"] > 1.0
        assert phase_multiplier("BUY", "BTC/USDT", "ALTCOINS")["multiplier"] < 1.0

    def test_risk_off_crushes_alt_buys(self):
        assert phase_multiplier("BUY", "SOL/USDT", "RISK_OFF")["multiplier"] == 0.50
        assert phase_multiplier("BUY", "BTC/USDT", "RISK_OFF")["multiplier"] < 1.0

    def test_memecoins_late_cycle_caution(self):
        assert phase_multiplier("BUY", "DOGE/USDT", "MEMECOINS")["multiplier"] < 1.0

    def test_transition_neutral(self):
        assert phase_multiplier("BUY", "SOL/USDT", "TRANSITION")["multiplier"] == 1.0

    # ── Shorts sur venue shortable ───────────────────────────────────

    def test_sell_spot_neutral(self):
        out = phase_multiplier("SELL", "SOL/USDT", "RISK_OFF", shortable=False)
        assert out["multiplier"] == 1.0 and "exit" in out["reason"]

    def test_short_risk_off_boosted(self):
        out = phase_multiplier("SELL", "SOL/USDT", "RISK_OFF", shortable=True)
        assert out["multiplier"] == 1.15

    def test_short_altseason_crushed(self):
        out = phase_multiplier("SELL", "SOL/USDT", "ALTCOINS", shortable=True)
        assert out["multiplier"] == 0.60

    def test_short_memecoins_euphoria(self):
        out = phase_multiplier("SELL", "DOGE/USDT", "MEMECOINS", shortable=True)
        assert out["multiplier"] == 0.50

    def test_short_btc_phase_alts_bleed_first(self):
        alt = phase_multiplier("SELL", "LINK/USDT", "BTC", shortable=True)
        btc = phase_multiplier("SELL", "BTC/USDT", "BTC", shortable=True)
        assert alt["multiplier"] > btc["multiplier"]

    def test_short_unknown_phase_neutral(self):
        out = phase_multiplier("SELL", "SOL/USDT", "UNKNOWN", shortable=True)
        assert out["multiplier"] == 1.0


# ── Feature extraction (market_memory) ───────────────────────────────

class TestFeatureExtraction:
    def test_dominance_and_phase_extracted(self):
        md = {
            "regime": {"regime": "TRENDING", "adx": 28},
            "context": {"btc_dominance": {"btc_dominance": 57.8, "change_24h_pct": 0.6}},
            "macro_rotation": {"phase": "BTC"},
        }
        f = _extract_features(md)
        assert f["btc_dominance"] == 57.8
        assert f["btc_dom_change_24h"] == 0.6
        assert f["macro_phase"] == "BTC"

    def test_missing_context_safe(self):
        f = _extract_features({"regime": {}})
        assert f["btc_dominance"] is None
        assert f["btc_dom_change_24h"] is None
        assert f["macro_phase"] is None

    def test_old_features_intact(self):
        md = {"regime": {"regime": "RANGING", "adx": 15},
              "mtf_context": {"confluence": "ALIGNED"}, "risk_reward": 2.0}
        f = _extract_features(md)
        assert f["regime"] == "RANGING" and f["mtf_confluence"] == "ALIGNED" and f["rr"] == 2.0


# ── Bornes combinées ──────────────────────────────────────────────────

class TestBounds:
    def test_combined_capped(self):
        # Le pire cas : adaptive 0.5 × phase 0.5 = 0.25 → doit rester ≥ 0.5
        stats = multiplier_from_stats({"win_rate": 30, "sample_size": 50})
        phase = phase_multiplier("BUY", "SOL/USDT", "RISK_OFF")
        combined = max(MULT_LOW, min(MULT_HIGH, stats["multiplier"] * phase["multiplier"]))
        assert combined >= 0.5
        assert combined <= 1.2


# ── Gate Hidden Gems × phase ─────────────────────────────────────────

class TestGemPhaseGate:
    def test_risk_off_blocks_entries(self):
        out = gem_phase_gate("RISK_OFF")
        assert out["allow"] is False and out["mult"] == 0.0

    def test_btc_phase_reduces_size(self):
        out = gem_phase_gate("BTC")
        assert out["allow"] and out["mult"] == 0.6

    def test_altseason_full_size(self):
        assert gem_phase_gate("ALTCOINS")["mult"] == 1.0

    def test_memecoins_phase_is_theirs(self):
        out = gem_phase_gate("MEMECOINS")
        assert out["allow"] and out["mult"] == 1.0

    def test_unknown_phase_fail_open(self):
        assert gem_phase_gate(None)["allow"] is True
        assert gem_phase_gate("UNKNOWN")["allow"] is True
