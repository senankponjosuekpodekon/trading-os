"""Tests ml/smart_money — réputation deployer + early-buyer overlap."""
import pytest
from unittest.mock import AsyncMock, patch

from ml.smart_money import _chain_id, fetch_early_buyers


class FakeRedis:
    """Mini zset/set Redis en mémoire pour les tests."""
    def __init__(self):
        self.zsets = {}
        self.sets = {}

    async def zincrby(self, key, amt, member):
        self.zsets.setdefault(key, {})[member] = self.zsets.setdefault(key, {}).get(member, 0) + amt

    async def zscore(self, key, member):
        return self.zsets.get(key, {}).get(member)

    async def zrevrange(self, key, start, stop, withscores=False):
        items = sorted(self.zsets.get(key, {}).items(), key=lambda kv: -kv[1])
        items = items[start:stop + 1]
        return items if withscores else [m for m, _ in items]

    async def zcard(self, key):
        return len(self.zsets.get(key, {}))

    async def sadd(self, key, *members):
        self.sets.setdefault(key, set()).update(members)

    async def smembers(self, key):
        return self.sets.get(key, set())

    async def scard(self, key):
        return len(self.sets.get(key, set()))


class FakeCache:
    def __init__(self, r):
        self._r = r

    async def client(self):
        return self._r


class TestChainIds:
    def test_evm_mapping(self):
        assert _chain_id("ethereum") == 1
        assert _chain_id("bsc") == 56
        assert _chain_id("base") == 8453
        assert _chain_id("solana") is None
        assert _chain_id("") is None


class TestFetchEarlyBuyers:
    @pytest.mark.asyncio
    async def test_no_key_returns_empty(self):
        with patch("ml.smart_money._settings_key", return_value=""):
            assert await fetch_early_buyers("ethereum", "0xabc") == []

    @pytest.mark.asyncio
    async def test_non_evm_returns_empty(self):
        with patch("ml.smart_money._settings_key", return_value="key"):
            assert await fetch_early_buyers("solana", "mint") == []


class TestCheckToken:
    @pytest.mark.asyncio
    async def test_deployer_reputation(self):
        r = FakeRedis()
        r.zsets["smartmoney:deployers:ethereum"] = {"0xdev": 2}
        r.zsets["smartmoney:rugs:ethereum"] = {}
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.smart_money.fetch_early_buyers", new=AsyncMock(return_value=[])):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            out = await sm.check_token("ethereum", "0xtoken", "0xDEV")
        assert out["deployer_wins"] == 2
        assert out["score"] == 60

    @pytest.mark.asyncio
    async def test_rug_deployer_penalty(self):
        r = FakeRedis()
        r.zsets["smartmoney:rugs:base"] = {"0xrug": 3}
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.smart_money.fetch_early_buyers", new=AsyncMock(return_value=[])):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            out = await sm.check_token("base", "0xtoken", "0xRUG")
        assert out["deployer_rugs"] == 3
        assert out["score"] == 0

    @pytest.mark.asyncio
    async def test_smart_wallet_overlap(self):
        r = FakeRedis()
        r.zsets["smartmoney:wallets:ethereum"] = {"0xsmart1": 2, "0xsmart2": 1}
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.smart_money.fetch_early_buyers",
                   new=AsyncMock(return_value=["0xsmart1", "0xrandom", "0xsmart2"])):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            out = await sm.check_token("ethereum", "0xtoken", "")
        assert out["smart_wallets"] == 2
        assert out["score"] == 50


class TestIndexUpdate:
    @pytest.mark.asyncio
    async def test_winner_indexed_once(self):
        r = FakeRedis()
        r.sets["gem_tracked"] = {"ethereum:0xtok"}
        hist = [{"ts": 200, "price": 1.6, "creator": "0xdev"},
                {"ts": 100, "price": 1.0, "creator": "0xdev"}]
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.hidden_gems._load_gem_history", new=AsyncMock(return_value=hist)), \
             patch("ml.smart_money.fetch_early_buyers",
                   new=AsyncMock(return_value=["0xwhale"])):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            res = await sm.update_smart_money_index()

        assert res["winners"] == 1
        assert r.zsets["smartmoney:deployers:ethereum"]["0xdev"] == 1
        assert r.zsets["smartmoney:wallets:ethereum"]["0xwhale"] == 1
        assert "ethereum:0xtok" in r.sets["smartmoney:processed"]

    @pytest.mark.asyncio
    async def test_loser_marks_rug(self):
        r = FakeRedis()
        r.sets["gem_tracked"] = {"base:0xbad"}
        hist = [{"ts": 200, "price": 0.4, "creator": "0xrug"},
                {"ts": 100, "price": 1.0, "creator": "0xrug"}]
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.hidden_gems._load_gem_history", new=AsyncMock(return_value=hist)), \
             patch("ml.smart_money.fetch_early_buyers", new=AsyncMock(return_value=[])):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            res = await sm.update_smart_money_index()

        assert res["losers"] == 1
        assert r.zsets["smartmoney:rugs:base"]["0xrug"] == 1

    @pytest.mark.asyncio
    async def test_undecided_stays_pending(self):
        r = FakeRedis()
        r.sets["gem_tracked"] = {"ethereum:0xflat"}
        hist = [{"ts": 200, "price": 1.1}, {"ts": 100, "price": 1.0}]
        with patch("utils.cache.cache") as mock_cache, \
             patch("ml.hidden_gems._load_gem_history", new=AsyncMock(return_value=hist)):
            import ml.smart_money as sm
            mock_cache.client = AsyncMock(return_value=r)
            res = await sm.update_smart_money_index()

        assert res["pending"] == 1
        assert "smartmoney:processed" not in r.sets
