"""
Hidden Gems Discovery — Phase L
Discovers undervalued tokens by combining on-chain metrics, tokenomics,
social sentiment, and DEX data. Scores tokens on a 0-100 "gem score".

Sources:
  - DEX Screener: liquidity, volume, age, price change
  - Tokenomics: unlock safety, distribution
  - Social: Reddit/YouTube sentiment buzz
  - On-chain asymmetry: buy/sell flow imbalance (DexScreener txns) +
    contract security via GoPlus (EVM/Solana) & RugCheck — holder
    concentration, LP lock, honeypot, mintable/freezable, taxes
"""
from __future__ import annotations

from typing import Any, Dict, List
from dataclasses import dataclass

from utils.logger import get_logger

logger = get_logger(__name__)

# Cache
_cache: dict = {"gems": None, "ts": 0.0}
_CACHE_TTL = 600  # 10 min


@dataclass
class GemCandidate:
    symbol: str
    name: str
    chain: str
    price: float
    liquidity: float
    volume_24h: float
    price_change_24h: float
    age_hours: float
    gem_score: int
    reasons: List[str]
    warnings: List[str]
    social_buzz: float
    tokenomics_safety: float
    onchain: Dict[str, Any] | None = None
    narrative: str | None = None
    narrative_momentum: float | None = None
    trajectory: Dict[str, Any] | None = None
    moonshot: bool = False
    under_the_radar: bool = False
    manipulation: Dict[str, Any] | None = None
    token_address: str | None = None
    upside: Dict[str, Any] | None = None


# Narratives — taxonomie des thèmes de marché crypto.
# Un token est rattaché à une narrative par keywords sur nom/symbole/description.
_NARRATIVES: Dict[str, List[str]] = {
    "AI": ["ai", "agent", "gpt", "llm", "neural", "bot", "intelligence", "inference"],
    "AI Agents": ["agent", "autonomous", "swarm", "aixbt"],
    "Meme": ["inu", "doge", "pepe", "wif", "bonk", "cat", "frog", "meme", "moon", "elon"],
    "DePIN": ["depin", "node", "sensor", "network", "iot", "helium", "render", "compute", "gpu"],
    "RWA": ["rwa", "real world", "asset", "estate", "bond", "treasury", "tokenized"],
    "DeFi": ["swap", "dex", "lend", "yield", "vault", "stake", "liquidity", "amm"],
    "Gaming": ["game", "play", "guild", "metaverse", "nft"],
    "L2/Infra": ["layer", "rollup", "bridge", "zk", "evm", "chain", "protocol"],
    "Privacy": ["privacy", "anon", "zero", "mix", "shield"],
    "SocialFi": ["social", "friend", "creator", "fan"],
    "Prediction": ["predict", "bet", "oracle", "market"],
    "Stablecoin": ["usd", "stable", "dollar"],
    "Solana Eco": ["solana", "sol", "pump", "raydium"],
}

# Narrative → mots-clés pour matcher les catégories CoinGecko
_NARRATIVE_CG_KEYWORDS: Dict[str, List[str]] = {
    "AI": ["artificial intelligence", "ai"],
    "AI Agents": ["ai agents", "ai agent"],
    "Meme": ["meme"],
    "DePIN": ["depin"],
    "RWA": ["real world assets", "rwa"],
    "DeFi": ["decentralized finance", "defi", "dex", "lending"],
    "Gaming": ["gaming", "gamefi", "metaverse", "nft"],
    "L2/Infra": ["layer 2", "layer 1", "infrastructure", "zero knowledge"],
    "Privacy": ["privacy"],
    "SocialFi": ["social"],
    "Prediction": ["prediction"],
    "Stablecoin": ["stablecoin"],
    "Solana Eco": ["solana ecosystem"],
}

# Narrative → id CoinGecko du leader de catégorie (plafond théorique)
_CATEGORY_LEADER_IDS: Dict[str, str] = {
    "AI": "bittensor",
    "AI Agents": "virtuals-protocol",
    "Meme": "dogecoin",
    "DePIN": "render-token",
    "RWA": "chainlink",
    "DeFi": "uniswap",
    "Gaming": "immutable-x",
    "L2/Infra": "arbitrum",
    "Privacy": "monero",
    "SocialFi": "chiliz",
    "Prediction": "gnosis",
    "Solana Eco": "solana",
}
_LEADER_MCACHE: Dict[str, Any] = {"ts": 0.0, "caps": {}}


async def _fetch_leader_mcaps() -> Dict[str, float]:
    """Mcap des leaders de catégorie — 1 requête CoinGecko, cache 24h."""
    import time
    import httpx
    now = time.time()
    if now - _LEADER_MCACHE["ts"] < 86_400 and _LEADER_MCACHE["caps"]:
        return _LEADER_MCACHE["caps"]
    ids = ",".join(sorted(set(_CATEGORY_LEADER_IDS.values())))
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={"vs_currency": "usd", "ids": ids},
            )
            r.raise_for_status()
            caps = {c["id"]: float(c.get("market_cap") or 0) for c in r.json()}
    except Exception as exc:
        logger.warning("leader_mcaps_failed", error=str(exc))
        return _LEADER_MCACHE["caps"]
    _LEADER_MCACHE.update(ts=now, caps=caps)
    return caps


def _estimate_upside(fdv: float, narrative: str | None,
                     leader_caps: Dict[str, float]) -> Dict[str, Any] | None:
    """
    Plafond théorique = mcap du leader de la catégorie / fdv du token.
    Ce n'est PAS une prédiction : c'est le multiple maximal observable si le
    token atteignait la capitalisation du leader de sa narrative. Labellisé
    honnêtement en 'plafond' — la probabilité dépend du score/trajectoire.
    """
    leader_id = _CATEGORY_LEADER_IDS.get(narrative or "")
    leader_cap = leader_caps.get(leader_id or "", 0)
    if not fdv or fdv <= 0 or not leader_cap:
        return None
    multiple = leader_cap / fdv
    if multiple < 5:
        return None
    for cap, label in ((15, "~10x"), (40, "~25x"), (75, "~50x"),
                       (150, "~100x"), (400, "~250x"), (700, "~500x")):
        if multiple < cap:
            bucket = label
            break
    else:
        bucket = "1000x+"
    return {
        "multiple": round(multiple, 1),
        "bucket": bucket,
        "benchmark": leader_id,
        "benchmark_mcap": round(leader_cap),
    }


def _classify_narrative(symbol: str, name: str, description: str = "") -> str | None:
    """Classe le token dans une narrative par keywords. None = pas de thème clair."""
    text = f"{symbol} {name} {description}".lower()
    best, best_hits = None, 0
    for narrative, kws in _NARRATIVES.items():
        hits = sum(1 for kw in kws if kw in text)
        if hits > best_hits:
            best, best_hits = narrative, hits
    return best if best_hits >= 1 else None


async def _fetch_narrative_momentum() -> Dict[str, float]:
    """
    Momentum des narratives = variation mcap 24h des catégories CoinGecko.
    Une seule requête pour toutes les catégories. Retourne {narrative: pct}.
    """
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get("https://api.coingecko.com/api/v3/coins/categories")
            r.raise_for_status()
            cats = r.json()
        out: Dict[str, float] = {}
        for narrative, kws in _NARRATIVE_CG_KEYWORDS.items():
            vals = [
                float(c.get("market_cap_change_24h") or 0)
                for c in cats
                if any(kw in (c.get("name") or "").lower() for kw in kws)
            ]
            if vals:
                out[narrative] = sum(vals) / len(vals)
        return out
    except Exception as exc:
        logger.debug("narrative_momentum_failed", error=str(exc))
        return {}


# ── Tracking longitudinal (détection moonshot) ────────────────────────────────
# Chaque cycle (cron 30min + appels API) snapshot les métriques par token dans
# Redis → permet de mesurer la TRAJECTOIRE : croissance holders, liquidité,
# persistance du buy-flow, survie. C'est ce qui distingue un moonshot naissant
# d'un pump éphémère — un snapshot seul ne dit rien.
_GEM_SNAPSHOT_TTL = 14 * 86400  # 14 jours de rétention
_GEM_SNAPSHOT_MAX = 400
_GEM_TRACKED_SET = "gem_tracked"  # index Redis des tokens suivis (backtest)


def _gem_snapshot_key(chain: str, addr: str) -> str:
    return f"gem_snapshots:{(chain or '').lower()}:{addr}"


async def _record_gem_snapshot(t: Dict[str, Any]) -> None:
    """Enregistre un snapshot des métriques du token dans Redis."""
    import json
    import time

    addr = t.get("token_address")
    if not addr:
        return
    try:
        from utils.cache import cache
        oc = t.get("onchain") or {}
        snap = {
            "ts": int(time.time()),
            "price": t.get("price", 0),
            "liquidity": t.get("liquidity", 0),
            "volume_24h": t.get("volume_24h", 0),
            "holders": oc.get("holder_count", 0),
            "top10_pct": oc.get("top10_pct", 0),
            "buys": t.get("buys_24h", 0),
            "sells": t.get("sells_24h", 0),
        }
        r = await cache.client()
        key = _gem_snapshot_key(t.get("chain", ""), addr)
        await r.lpush(key, json.dumps(snap))
        await r.ltrim(key, 0, _GEM_SNAPSHOT_MAX - 1)
        await r.expire(key, _GEM_SNAPSHOT_TTL)
        await r.sadd(_GEM_TRACKED_SET, f"{t.get('chain', '').lower()}:{addr}")
    except Exception as exc:
        logger.debug("gem_snapshot_failed", error=str(exc))


async def _stamp_gem_score(chain: str, addr: str, score: int) -> None:
    """Injecte le gem_score dans le snapshot le plus récent (index 0) —
    nécessaire pour le backtest score → performance ultérieure."""
    import json
    try:
        from utils.cache import cache
        r = await cache.client()
        key = _gem_snapshot_key(chain, addr)
        raw = await r.lindex(key, 0)
        if not raw:
            return
        snap = json.loads(raw)
        snap["score"] = score
        await r.lset(key, 0, json.dumps(snap))
    except Exception:
        pass


async def _load_gem_history(chain: str, addr: str) -> List[Dict[str, Any]]:
    """Historique des snapshots du token, du plus récent au plus ancien."""
    import json

    if not addr:
        return []
    try:
        from utils.cache import cache
        r = await cache.client()
        raw = await r.lrange(_gem_snapshot_key(chain, addr), 0, _GEM_SNAPSHOT_MAX - 1)
        return [json.loads(x) for x in raw]
    except Exception:
        return []


def _compute_trajectory(history: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Trajectoire mesurée depuis le premier snapshot du token.
    """
    if len(history) < 2:
        return {"snapshots": len(history), "tracked_hours": 0.0}

    newest, oldest = history[0], history[-1]
    span_h = max((newest["ts"] - oldest["ts"]) / 3600, 0.01)

    def _growth_24h(field: str) -> float | None:
        """Croissance vs le snapshot le plus proche d'il y a ~24h."""
        cutoff = newest["ts"] - 86400
        base = next((s for s in history if s["ts"] <= cutoff), oldest)
        old, new = base.get(field) or 0, newest.get(field) or 0
        return (new - old) / old * 100 if old > 0 else None

    buy_ratios = [
        s["buys"] / (s["buys"] + s["sells"])
        for s in history
        if (s.get("buys") or 0) + (s.get("sells") or 0) >= 20
    ]

    t10_new, t10_old = newest.get("top10_pct") or 0, oldest.get("top10_pct") or 0
    old_price, new_price = oldest.get("price") or 0, newest.get("price") or 0
    return {
        "snapshots": len(history),
        "tracked_hours": round(span_h, 1),
        "holder_growth_pct": _growth_24h("holders"),
        "liquidity_growth_pct": _growth_24h("liquidity"),
        "volume_growth_pct": _growth_24h("volume_24h"),
        "price_change_pct": round((new_price - old_price) / old_price * 100, 1) if old_price > 0 else None,
        "buy_ratio_avg": round(sum(buy_ratios) / len(buy_ratios), 3) if buy_ratios else None,
        "top10_trend": round(t10_new - t10_old, 1) if t10_new and t10_old else None,
    }


def _score_trajectory(traj: Dict[str, Any]) -> tuple[int, List[str], List[str], bool]:
    """
    Composante trajectoire -15/+15 pts.
    Retourne (points, reasons, warnings, moonshot_flag).
    Moonshot = croissance holders explosive + buy-flow dominant persistant
    + survie ≥6h de tracking.
    """
    pts = 0
    reasons: List[str] = []
    warnings: List[str] = []

    if (traj.get("snapshots") or 0) < 3:
        return 0, reasons, warnings, False

    hg = traj.get("holder_growth_pct")
    if hg is not None:
        if hg >= 100:
            pts += 8
            reasons.append(f"Holder count exploding (+{hg:.0f}% / 24h)")
        elif hg >= 30:
            pts += 5
            reasons.append(f"Strong holder growth (+{hg:.0f}% / 24h)")
        elif hg <= -50:
            pts -= 6
            warnings.append(f"Holder base shrinking ({hg:.0f}% / 24h)")

    lg = traj.get("liquidity_growth_pct")
    if lg is not None and lg >= 50:
        pts += 4
        reasons.append(f"Liquidity growing fast (+{lg:.0f}% / 24h)")

    bra = traj.get("buy_ratio_avg")
    if bra is not None:
        if bra >= 0.55:
            pts += 3
            reasons.append(f"Persistent buy pressure ({bra*100:.0f}% avg buys)")
        elif bra <= 0.40:
            pts -= 4
            warnings.append(f"Persistent sell pressure ({(1-bra)*100:.0f}% avg sells)")

    tracked = traj.get("tracked_hours") or 0
    if tracked >= 72:
        pts += 3
        reasons.append(f"Survived {tracked/24:.0f}d of tracking — not a flash pump")
    elif tracked >= 24:
        pts += 1

    pc = traj.get("price_change_pct")
    if pc is not None and pc <= -60:
        pts -= 5
        warnings.append(f"Price bleeding since detection ({pc:.0f}%)")

    t10 = traj.get("top10_trend")
    if t10 is not None and t10 < -5:
        pts += 2
        reasons.append("Holder concentration decreasing — healthier distribution")

    moonshot = bool(
        hg is not None and hg >= 50
        and bra is not None and bra >= 0.55
        and tracked >= 6
    )
    return max(-15, min(15, pts)), reasons, warnings, moonshot


# DexScreener chainId → GoPlus chain id (EVM token_security endpoint)
_GOPLUS_CHAIN_IDS = {
    "ethereum": "1", "bsc": "56", "polygon": "137", "arbitrum": "42161",
    "base": "8453", "avalanche": "43114", "optimism": "10", "fantom": "250",
    "cronos": "25", "linea": "59144", "mantle": "5000", "scroll": "534352",
    "blast": "81457", "sonic": "146", "zksync": "324", "mode": "34443",
    "manta": "169", "polygonzkevm": "1101", "core": "1116", "sei": "1329",
}

# Chaînes non-EVM couvertes par des endpoints GoPlus dédiés
# (même contrat /token_security, path différent).
_GOPLUS_SPECIAL_ENDPOINTS = {
    "tron": "https://api.gopluslabs.io/api/v1/tron/token_security",
    "sui": "https://api.gopluslabs.io/api/v1/sui/token_security",
}


def _f(v: Any) -> float:
    """Parse GoPlus string/number fields safely."""
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_goplus_evm(sec: Dict[str, Any]) -> Dict[str, Any]:
    holders = sec.get("holders") or []
    top10 = sum(_f(h.get("percent")) for h in holders[:10]) * 100
    lp = sec.get("lp_holders") or []
    lp_total = sum(_f(h.get("percent")) for h in lp)
    lp_locked = sum(_f(h.get("percent")) for h in lp if h.get("is_locked")) * 100 / max(lp_total, 1) if lp_total > 0 else 0.0
    return {
        "available": True,
        "holder_count": int(_f(sec.get("holder_count"))),
        "top10_pct": round(top10, 1),
        "lp_locked_pct": round(lp_locked, 1),
        "honeypot": sec.get("is_honeypot") == "1" or sec.get("cannot_buy") == "1",
        "mintable": sec.get("is_mintable") == "1",
        "proxy": sec.get("is_proxy") == "1",
        "open_source": sec.get("is_open_source") == "1",
        "hidden_owner": sec.get("hidden_owner") == "1",
        "freezable": sec.get("transfer_pausable") == "1",
        "non_transferable": False,
        "buy_tax": _f(sec.get("buy_tax")) * 100,
        "sell_tax": _f(sec.get("sell_tax")) * 100,
        "creator_pct": _f(sec.get("creator_percent")) * 100,
        "source": "goplus",
    }


def _parse_goplus_solana(sec: Dict[str, Any]) -> Dict[str, Any]:
    holders = sec.get("holders") or []
    top10 = sum(_f(h.get("percent")) for h in holders[:10]) * 100
    mintable = (sec.get("mintable") or {}).get("status") == "1"
    freezable = (sec.get("freezable") or {}).get("status") == "1"
    closable = (sec.get("closable") or {}).get("status") == "1"
    non_transferable = (sec.get("non_transferable") or {}).get("status") == "1"
    return {
        "available": True,
        "holder_count": int(_f(sec.get("holder_count"))),
        "top10_pct": round(top10, 1),
        "lp_locked_pct": 0.0,  # pas exposé par GoPlus solana
        "honeypot": non_transferable or sec.get("default_account_state") == "2",
        "mintable": mintable,
        "proxy": False,
        "open_source": None,
        "hidden_owner": False,
        "freezable": freezable or closable,
        "non_transferable": non_transferable,
        "buy_tax": _f((sec.get("transfer_fee") or {}).get("current_fee_rate")) * 100,
        "sell_tax": 0.0,
        "creator_pct": 0.0,  # creators[] en unités token, pas fiable en %
        "source": "goplus",
    }


async def _fetch_rugcheck(mint: str) -> Dict[str, Any] | None:
    """RugCheck.xyz — source primaire Solana (couvre les micro-caps récentes,
    contrairement à GoPlus qui indexe mal les tokens de quelques heures)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"https://api.rugcheck.xyz/v1/tokens/{mint}/report")
            if r.status_code != 200:
                return None
            d = r.json()
        holders = d.get("topHolders") or []
        top10 = sum(_f(h.get("pct")) for h in holders[:10])
        markets = d.get("markets") or []
        lp_locked = max((_f((m.get("lp") or {}).get("lpLockedPct")) for m in markets), default=0.0)
        risks = " ".join((r_.get("name") or "").lower() for r_ in (d.get("risks") or []))
        # Lockers RugCheck : durée restante du lock le plus proche.
        # "LP locked 100%" mais qui expire demain = faux sentiment de sécurité.
        import time as _t
        _now = _t.time()
        _days = []
        for lk in (d.get("lockers") or {}).values():
            ud = lk.get("unlockDate") or lk.get("unlock_date")
            if not ud:
                continue
            ts = _f(ud)
            if ts > 1e12:
                ts /= 1000
            if ts > 0:
                _days.append(max((ts - _now) / 86400, 0.0))
        lp_min_unlock_days = round(min(_days), 1) if _days else None
        return {
            "available": True,
            "holder_count": int(_f(d.get("totalHolders"))),
            "top10_pct": round(top10, 1),
            "lp_locked_pct": round(lp_locked, 1),
            "honeypot": bool(d.get("rugged")) or "honeypot" in risks,
            "mintable": d.get("mintAuthority") is not None or "mint authority" in risks,
            "proxy": False,
            "open_source": None,
            "hidden_owner": bool(d.get("graphInsidersDetected")),
            "freezable": d.get("freezeAuthority") is not None or "freez" in risks,
            "non_transferable": False,
            "buy_tax": 0.0,
            "sell_tax": 0.0,
            "creator_pct": 0.0,
            "lp_min_unlock_days": lp_min_unlock_days,
            "rugcheck_score": d.get("score_normalised", d.get("score")),
            "source": "rugcheck",
        }
    except Exception:
        return None


def _parse_goplus_generic(sec: Dict[str, Any]) -> Dict[str, Any]:
    """Parser tolérant pour les endpoints GoPlus non-EVM (tron, sui) — les
    shapes varient selon la chaîne ; on lit les champs partagés et on laisse
    les autres en défaut plutôt que de fabriquer des faux indicateurs."""
    holders = sec.get("holders") or []
    top10 = sum(_f(h.get("percent") or h.get("pct")) for h in holders[:10]) * 100
    return {
        "available": True,
        "holder_count": int(_f(sec.get("holder_count"))),
        "top10_pct": round(top10, 1),
        "lp_locked_pct": 0.0,
        "honeypot": sec.get("is_honeypot") in ("1", 1, True)
            or sec.get("cannot_sell_all") in ("1", 1, True)
            or (sec.get("sell_tax") is not None and _f(sec.get("sell_tax")) > 0.5),
        "mintable": sec.get("is_mintable") in ("1", 1, True),
        "proxy": False,
        "open_source": sec.get("is_open_source") in ("1", 1, True),
        "hidden_owner": sec.get("hidden_owner") in ("1", 1, True),
        "freezable": sec.get("transfer_pausable") in ("1", 1, True)
            or sec.get("freezeable") in ("1", 1, True),
        "non_transferable": sec.get("cannot_transfer") in ("1", 1, True),
        "buy_tax": _f(sec.get("buy_tax")) * 100,
        "sell_tax": _f(sec.get("sell_tax")) * 100,
        "creator_pct": _f(sec.get("creator_percent")) * 100,
        "source": "goplus",
    }


async def fetch_onchain_security(tokens: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Fetch contract/holder security pour une liste de tokens, batché par chain.
    Retourne {token_address: normalized_security}. GoPlus (EVM+Solana),
    fallback RugCheck pour Solana.
    """
    import asyncio as _a
    import httpx

    by_chain: Dict[str, List[Dict[str, Any]]] = {}
    for t in tokens:
        chain, addr = (t.get("chain") or "").lower(), t.get("token_address")
        if addr:
            by_chain.setdefault(chain, []).append(t)

    out: Dict[str, Dict[str, Any]] = {}

    async def _fetch_chain(chain: str, toks: List[Dict[str, Any]]):
        addrs = [t["token_address"] for t in toks]
        # Solana : RugCheck en primaire (meilleure couverture micro-caps),
        # GoPlus en fallback pour les mints non couverts.
        if chain == "solana":
            rcs = await _a.gather(
                *(_fetch_rugcheck(t["token_address"]) for t in toks[:20]),
                return_exceptions=True,
            )
            for t, rc in zip(toks, rcs):
                if isinstance(rc, dict):
                    out[t["token_address"]] = rc
            toks = [t for t in toks if t["token_address"] not in out]
            addrs = [t["token_address"] for t in toks]
            if not addrs:
                return
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                if chain == "solana":
                    url = "https://api.gopluslabs.io/api/v1/solana/token_security"
                elif chain in _GOPLUS_SPECIAL_ENDPOINTS:
                    url = _GOPLUS_SPECIAL_ENDPOINTS[chain]
                else:
                    gid = _GOPLUS_CHAIN_IDS.get(chain)
                    if not gid:
                        return
                    url = f"https://api.gopluslabs.io/api/v1/token_security/{gid}"
                r = await client.get(url, params={"contract_addresses": ",".join(addrs)})
                r.raise_for_status()
                result = (r.json() or {}).get("result") or {}
            if chain == "solana":
                parse = _parse_goplus_solana
            elif chain in _GOPLUS_SPECIAL_ENDPOINTS:
                parse = _parse_goplus_generic
            else:
                parse = _parse_goplus_evm
            for t in toks:
                addr = t["token_address"]
                # GoPlus EVM normalise les clés en minuscules
                sec = result.get(addr) or result.get(addr.lower())
                if sec:
                    out[addr] = parse(sec)
        except Exception as exc:
            logger.debug("goplus_fetch_failed", chain=chain, error=str(exc))

    await _a.gather(*(_fetch_chain(c, toks) for c, toks in by_chain.items()))
    return out


def _score_onchain(
    onchain: Dict[str, Any] | None,
    buys_24h: float,
    sells_24h: float,
    buys_1h: float,
    sells_1h: float,
) -> tuple[int, List[str], List[str], bool]:
    """
    Composante on-chain asymétrique : +20 max / -35 min.
    Retourne (points, reasons, warnings, honeypot_flag).
    """
    pts = 0
    reasons: List[str] = []
    warnings: List[str] = []
    honeypot = False

    if onchain and onchain.get("available"):
        if onchain.get("honeypot"):
            honeypot = True
            pts -= 30
            warnings.append("HONEYPOT detected — sells likely blocked")
        top10 = onchain.get("top10_pct") or 0
        if top10 > 0:
            if top10 < 25:
                pts += 6
                reasons.append(f"Well-distributed holders (top10 {top10:.0f}%)")
            elif top10 < 45:
                pts += 3
            elif top10 > 70:
                pts -= 10
                warnings.append(f"Extreme whale concentration (top10 {top10:.0f}%)")
            elif top10 > 50:
                pts -= 6
                warnings.append(f"High whale concentration (top10 {top10:.0f}%)")
        lp = onchain.get("lp_locked_pct") or 0
        if lp >= 70:
            pts += 6
            reasons.append(f"LP locked ({lp:.0f}%)")
        elif lp >= 40:
            pts += 3
        elif onchain.get("source") == "goplus" and lp > 0 and lp < 10:
            pts -= 4
            warnings.append(f"LP barely locked ({lp:.0f}%) — rug risk")
        holders = onchain.get("holder_count") or 0
        if holders >= 5000:
            pts += 5
            reasons.append(f"Broad holder base ({holders:,})")
        elif holders >= 1000:
            pts += 3
        elif 0 < holders < 150:
            pts -= 5
            warnings.append(f"Thin holder base ({holders}) — easy manipulation")
        if onchain.get("mintable"):
            pts -= 4
            warnings.append("Mintable supply — dilution risk")
        if onchain.get("hidden_owner"):
            pts -= 6
            warnings.append("Hidden owner detected")
        if onchain.get("freezable"):
            pts -= 4
            warnings.append("Contract can freeze transfers")
        if onchain.get("open_source"):
            pts += 2
        max_tax = max(onchain.get("buy_tax") or 0, onchain.get("sell_tax") or 0)
        if max_tax > 10:
            pts -= 8
            warnings.append(f"Very high tax ({max_tax:.0f}%)")
        elif max_tax > 5:
            pts -= 4
            warnings.append(f"High buy/sell tax ({max_tax:.0f}%)")
        if (onchain.get("creator_pct") or 0) > 10:
            pts -= 5
            warnings.append(f"Creator holds {onchain['creator_pct']:.0f}% of supply")

    # Flow asymmetry — buy/sell imbalance (DexScreener txns, données réelles)
    total_24h = buys_24h + sells_24h
    if total_24h >= 50:
        ratio = buys_24h / total_24h
        if ratio >= 0.62:
            pts += 6
            reasons.append(f"Buy-side flow dominance ({ratio*100:.0f}% buys 24h)")
        elif ratio <= 0.38:
            pts -= 6
            warnings.append(f"Sell-side flow dominance ({(1-ratio)*100:.0f}% sells 24h)")
    total_1h = buys_1h + sells_1h
    if total_1h >= 10 and buys_1h / total_1h >= 0.70:
        pts += 3
        reasons.append("Fresh buy pressure in the last hour")

    return max(-35, min(20, pts)), reasons, warnings, honeypot


def _detect_manipulation(
    liquidity: float,
    volume_24h: float,
    buys_24h: float,
    sells_24h: float,
    onchain: Dict[str, Any] | None,
) -> Dict[str, Any]:
    """
    Détection de fabrication de marché — le paradoxe transparence/manipulation :
    toute la donnée est publique, mais le buy-flow qui fait monter le score peut
    être entièrement fabriqué (bots, wash trading, churn coordonné).

    Retourne {penalty, flags, txns_per_holder, price_impact_1k_pct, ...}.
    """
    penalty = 0
    flags: List[str] = []
    oc = onchain or {}

    # Wash trading : volume >> liquidité. Le volume "transite" entre wallets
    # du même opérateur sans demande réelle. >15x est très rare en flux organique.
    vol_liq = volume_24h / max(liquidity, 1)
    if vol_liq > 15:
        penalty -= 8
        flags.append(f"Volume/LP extreme ({vol_liq:.0f}x) — wash trading probable")

    # Bot churn : beaucoup de transactions rapportées à une base de holders
    # réduite = les mêmes wallets tournent. Flux organique ~5-15 txns/holder/j.
    holders = oc.get("holder_count") or 0
    total_txns = buys_24h + sells_24h
    txns_per_holder = total_txns / holders if holders > 0 else None
    if txns_per_holder is not None and txns_per_holder > 25:
        penalty -= 6
        flags.append(f"{txns_per_holder:.0f} txns/holder — activité bot probable")

    # Churn équilibré : buys≈sells avec gros volume = carnet fabriqué pour
    # simuler de l'activité sans déplacer le prix.
    if total_txns >= 400:
        ratio = buys_24h / total_txns
        if 0.47 <= ratio <= 0.53:
            penalty -= 5
            flags.append("Buy/sell quasi équilibré sur gros volume — churn suspect")

    # LP "lockée" mais qui expire bientôt — la fenêtre de rug reste ouverte.
    lp_days = oc.get("lp_min_unlock_days")
    if lp_days is not None and (oc.get("lp_locked_pct") or 0) >= 40:
        if lp_days < 7:
            penalty -= 10
            flags.append(f"LP unlock dans {lp_days:.0f}j — fenêtre de rug imminente")
        elif lp_days < 30:
            penalty -= 5
            flags.append(f"LP lock expire dans {lp_days:.0f}j")

    # Liquidité illusoire : impact réel d'une sortie de $1k (pool AMM 50/50).
    impact_1k = 1000 / max(liquidity, 1) * 100
    if impact_1k > 5:
        flags.append(f"Sortie de $1k ≈ {impact_1k:.0f}% d'impact — liquidité illusoire")

    return {
        "penalty": penalty,
        "flags": flags,
        "vol_liq_ratio": round(vol_liq, 2),
        "txns_per_holder": round(txns_per_holder, 1) if txns_per_holder is not None else None,
        "price_impact_1k_pct": round(impact_1k, 2),
        "lp_min_unlock_days": lp_days,
    }


def _is_under_the_radar(
    onchain: Dict[str, Any] | None,
    social_buzz: float,
    trajectory: Dict[str, Any] | None,
    score: int,
) -> bool:
    """
    "Undervalued" = métriques/trajectoire fortes MAIS attention sociale quasi
    nulle — le marché n'a pas encore pricé l'intérêt. C'est la divergence
    fondamentaux/attention qui définit le sous-évalué, pas le score seul.
    """
    traj = trajectory or {}
    if (onchain or {}).get("honeypot") or score < 45:
        return False
    if social_buzz >= 0.15:
        return False
    return bool(
        (traj.get("holder_growth_pct") or 0) >= 20
        or (traj.get("liquidity_growth_pct") or 0) >= 25
        or (
            (traj.get("buy_ratio_avg") or 0) >= 0.55
            and (traj.get("tracked_hours") or 0) >= 24
        )
    )


def _compute_gem_score(
    liquidity: float,
    volume_24h: float,
    price_change_24h: float,
    age_hours: float,
    social_buzz: float = 0.0,
    tokenomics_safety: float = 50.0,
    onchain: Dict[str, Any] | None = None,
    buys_24h: float = 0.0,
    sells_24h: float = 0.0,
    buys_1h: float = 0.0,
    sells_1h: float = 0.0,
    narrative: str | None = None,
    narrative_momentum: float | None = None,
    trajectory: Dict[str, Any] | None = None,
) -> tuple[int, List[str], List[str]]:
    """
    Compute a 0-100 gem score.
    Higher = more promising hidden gem.
    """
    score = 0
    reasons: List[str] = []
    warnings: List[str] = []

    # 1. Liquidity (0-25 pts)
    if liquidity >= 500_000:
        score += 25
        reasons.append(f"High liquidity (${liquidity:,.0f})")
    elif liquidity >= 100_000:
        score += 18
        reasons.append(f"Good liquidity (${liquidity:,.0f})")
    elif liquidity >= 30_000:
        score += 10
        reasons.append(f"Moderate liquidity (${liquidity:,.0f})")
    else:
        score += 3
        warnings.append(f"Low liquidity (${liquidity:,.0f}) — high slippage risk")

    # 2. Volume / Liquidity ratio (0-20 pts) — high volume vs liquidity = interest
    vol_liq_ratio = volume_24h / max(liquidity, 1)
    if vol_liq_ratio >= 3.0:
        score += 20
        reasons.append(f"Very high volume/liquidity ratio ({vol_liq_ratio:.1f}x) — strong interest")
    elif vol_liq_ratio >= 1.0:
        score += 14
        reasons.append(f"Good volume/liquidity ratio ({vol_liq_ratio:.1f}x)")
    elif vol_liq_ratio >= 0.3:
        score += 8
    else:
        score += 2
        warnings.append("Low trading volume relative to liquidity")

    # 3. Age — newer tokens with traction are interesting (0-15 pts)
    if age_hours <= 72 and age_hours > 0:
        score += 15
        reasons.append(f"New token ({age_hours:.0f}h old) with early traction")
    elif age_hours <= 168:  # 1 week
        score += 10
        reasons.append(f"Recent token ({age_hours/24:.0f}d old)")
    elif age_hours <= 720:  # 30 days
        score += 5
    else:
        score += 2  # established token, less "hidden"

    # 4. Price change — moderate gains better than extreme (0-15 pts)
    if 5 <= price_change_24h <= 50:
        score += 15
        reasons.append(f"Healthy 24h gain ({price_change_24h:+.1f}%)")
    elif -10 <= price_change_24h <= 5:
        score += 10
        reasons.append(f"Stable price ({price_change_24h:+.1f}%) — accumulation phase?")
    elif price_change_24h > 100:
        score += 5
        warnings.append(f"Extreme 24h pump ({price_change_24h:+.1f}%) — FOMO risk")
    elif price_change_24h > 50:
        score += 8
        warnings.append(f"Large 24h gain ({price_change_24h:+.1f}%) — pullback risk")
    elif price_change_24h < -30:
        score += 3
        warnings.append(f"Sharp 24h drop ({price_change_24h:+.1f}%) — possible capitulation")

    # 5. Social buzz (0-15 pts)
    if social_buzz > 0.3:
        score += 15
        reasons.append(f"Strong social buzz (score: {social_buzz:.2f})")
    elif social_buzz > 0.1:
        score += 10
        reasons.append(f"Growing social attention (score: {social_buzz:.2f})")
    elif social_buzz > 0:
        score += 5

    # 6. Tokenomics safety (0-10 pts)
    if tokenomics_safety >= 80:
        score += 10
        reasons.append("Safe tokenomics (no major unlocks)")
    elif tokenomics_safety >= 60:
        score += 6
    elif tokenomics_safety < 30:
        score += 0
        warnings.append("Dangerous tokenomics — large unlock imminent")

    # 7. On-chain asymmetry (-35/+20 pts) — flow buy/sell + sécurité contrat
    oc_pts, oc_reasons, oc_warnings, honeypot = _score_onchain(
        onchain, buys_24h, sells_24h, buys_1h, sells_1h,
    )
    score += oc_pts
    reasons.extend(oc_reasons)
    warnings.extend(oc_warnings)

    # 8. Narrative momentum (-3/+5 pts) — le token surfe-t-il sur un thème chaud
    if narrative and narrative_momentum is not None:
        if narrative_momentum >= 5:
            score += 5
            reasons.append(f"Hot narrative: {narrative} sector {narrative_momentum:+.1f}% mcap 24h")
        elif narrative_momentum >= 2:
            score += 2
        elif narrative_momentum <= -10:
            score -= 3
            warnings.append(f"Narrative cooling off: {narrative} {narrative_momentum:+.1f}% 24h")

    # 9. Trajectory (-15/+15 pts) — croissance mesurée dans le temps, pas un snapshot
    tr_pts, tr_reasons, tr_warnings, _ = _score_trajectory(trajectory or {})
    score += tr_pts
    reasons.extend(tr_reasons)
    warnings.extend(tr_warnings)

    # 10. Manipulation detection (pénalités) — wash trading, bots, LP expirante
    manip = _detect_manipulation(liquidity, volume_24h, buys_24h, sells_24h, onchain)
    score += manip["penalty"]
    warnings.extend(manip["flags"])

    score = max(0, min(100, score))

    # 11. Under-the-radar bonus (+5) — fondamentaux forts, attention quasi nulle
    if _is_under_the_radar(onchain, social_buzz, trajectory, score):
        score = min(100, score + 5)
        reasons.append("Under the radar — métriques fortes, attention sociale quasi nulle")
    if honeypot:
        score = min(score, 15)  # un honeypot n'est pas tradable quelles que soient les métriques
    return score, reasons, warnings


async def _fetch_dex_trending() -> List[Dict[str, Any]]:
    """Fetch trending tokens from DexScreener.

    /token-boosts/top/v1 retourne des TOKENS (chainId + tokenAddress), pas des
    pairs — liquidity/volume/priceChange n'existent pas dans ce payload.
    On résout ensuite les pairs en batch via /latest/dex/tokens/{addresses}
    (≤30 par appel) et on garde la pair la plus liquide par token.
    """
    import httpx
    import time

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get("https://api.dexscreener.com/token-boosts/top/v1")
            r.raise_for_status()
            boosts = r.json()

        boosted = [i for i in boosts[:30] if i.get("tokenAddress")]
        if not boosted:
            return []
        addr_set = {i["tokenAddress"] for i in boosted}
        meta_by_addr = {i["tokenAddress"]: i for i in boosted}

        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                "https://api.dexscreener.com/latest/dex/tokens/"
                + ",".join(addr_set)
            )
            r.raise_for_status()
            pairs = r.json().get("pairs") or []

        # Meilleure pair par adresse de token boosté (base ou quote), par liquidité
        best: Dict[str, Dict[str, Any]] = {}
        for p in pairs:
            liq = float(p.get("liquidity", {}).get("usd", 0) or 0)
            for side in ("baseToken", "quoteToken"):
                tok = p.get(side) or {}
                addr = tok.get("address")
                if addr not in addr_set:
                    continue
                cur = best.get(addr)
                if cur is None or liq > cur["liq"]:
                    best[addr] = {"liq": liq, "pair": p, "tok": tok}

        now_ms = time.time() * 1000
        tokens = []
        for addr, entry in best.items():
            p = entry["pair"]
            tok = entry["tok"]
            meta = meta_by_addr.get(addr, {})
            created = p.get("pairCreatedAt")
            age_hours = (now_ms - created) / 3_600_000 if created else 168.0
            txns = p.get("txns") or {}
            tokens.append({
                "symbol": tok.get("symbol", ""),
                "name": tok.get("name", ""),
                "chain": p.get("chainId", ""),
                "pair_address": p.get("pairAddress", ""),
                "token_address": addr,
                "price": float(p.get("priceUsd", 0) or 0),
                "liquidity": entry["liq"],
                "volume_24h": float(p.get("volume", {}).get("h24", 0) or 0),
                "price_change_24h": float(p.get("priceChange", {}).get("h24", 0) or 0),
                "age_hours": age_hours,
                "buys_24h": float((txns.get("h24") or {}).get("buys", 0) or 0),
                "sells_24h": float((txns.get("h24") or {}).get("sells", 0) or 0),
                "buys_1h": float((txns.get("h1") or {}).get("buys", 0) or 0),
                "sells_1h": float((txns.get("h1") or {}).get("sells", 0) or 0),
                "url": p.get("url", ""),
                "socials": meta.get("links", {}),
                "description": meta.get("description", ""),
                "fdv": float(p.get("fdv") or p.get("marketCap") or 0),
            })
        return tokens
    except Exception as exc:
        logger.warning("dex_trending_fetch_failed", error=str(exc))
        return []


async def _fetch_dex_search(query: str = "trending") -> List[Dict[str, Any]]:
    """Fallback: search DexScreener for popular pairs."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.dexscreener.com/latest/dex/search",
                params={"q": query},
            )
            r.raise_for_status()
            data = r.json()

        pairs = data.get("pairs", [])[:20]
        tokens = []
        for p in pairs:
            txns = p.get("txns") or {}
            tokens.append({
                "symbol": p.get("baseToken", {}).get("symbol", ""),
                "name": p.get("baseToken", {}).get("name", ""),
                "chain": p.get("chainId", ""),
                "price": float(p.get("priceUsd", 0) or 0),
                "liquidity": float(p.get("liquidity", {}).get("usd", 0) or 0),
                "volume_24h": float(p.get("volume", {}).get("h24", 0) or 0),
                "price_change_24h": float(p.get("priceChange", {}).get("h24", 0) or 0),
                "age_hours": 0,
                "url": p.get("url", ""),
                "pair_address": p.get("pairAddress", ""),
                "token_address": (p.get("baseToken") or {}).get("address", ""),
                "buys_24h": float((txns.get("h24") or {}).get("buys", 0) or 0),
                "sells_24h": float((txns.get("h24") or {}).get("sells", 0) or 0),
                "buys_1h": float((txns.get("h1") or {}).get("buys", 0) or 0),
                "sells_1h": float((txns.get("h1") or {}).get("sells", 0) or 0),
                "fdv": float(p.get("fdv") or p.get("marketCap") or 0),
            })
        return tokens
    except Exception as exc:
        logger.warning("dex_search_fetch_failed", error=str(exc))
        return []


async def discover_hidden_gems(
    *,
    min_liquidity: float = 50_000,
    min_volume: float = 100_000,
    max_age_hours: float = 168,  # 1 week
    limit: int = 10,
) -> Dict[str, Any]:
    """
    Discover hidden gem tokens from DEX data.
    Scores and ranks tokens by gem_score.
    """
    # Fetch trending tokens
    tokens = await _fetch_dex_trending()
    if not tokens:
        tokens = await _fetch_dex_search()

    if not tokens:
        return {
            "gems": [],
            "summary": "No tokens found from DEX sources",
            "fetched_at": _now_iso(),
        }

    # Filter by minimum criteria
    filtered = [
        t for t in tokens
        if t.get("liquidity", 0) >= min_liquidity
        and t.get("volume_24h", 0) >= min_volume
    ]

    # Also include tokens below thresholds if they're very new (age check skipped since we don't have it)
    if not filtered:
        filtered = tokens  # Don't return empty if we have tokens

    # Enrich with social sentiment + tokenomics + on-chain security
    import asyncio as _asyncio
    from routers.social_sentiment import fetch_social_metrics
    from routers.tokenomics import fetch_tokenomics

    async def _enrich_token(t: dict) -> dict:
        sym = t.get("symbol", "")
        if not sym:
            return t
        try:
            social = await _asyncio.wait_for(fetch_social_metrics(sym), timeout=5.0)
            t["social_buzz"] = min(1.0, social.get("social_dominance", 0) / 10.0)
        except Exception:
            t["social_buzz"] = 0.0
        try:
            tokenomics = await _asyncio.wait_for(fetch_tokenomics(sym), timeout=5.0)
            unlock_pct = tokenomics.get("next_unlock_pct", 0)
            t["tokenomics_safety"] = max(0, 100 - unlock_pct * 5)
        except Exception:
            t["tokenomics_safety"] = 50.0
        return t

    filtered = await _asyncio.gather(*[_enrich_token(t) for t in filtered[:50]], return_exceptions=False)

    # On-chain security batché par chain (GoPlus + RugCheck fallback)
    try:
        security = await _asyncio.wait_for(
            fetch_onchain_security(filtered[:50]), timeout=20.0
        )
    except Exception:
        security = {}
    for t in filtered:
        t["onchain"] = security.get(t.get("token_address", "")) or {}

    # Narratives : classification + momentum sectoriel (CoinGecko categories)
    try:
        momentum = await _asyncio.wait_for(_fetch_narrative_momentum(), timeout=10.0)
    except Exception:
        momentum = {}
    for t in filtered:
        n = _classify_narrative(t.get("symbol", ""), t.get("name", ""), t.get("description", ""))
        t["narrative"] = n
        t["narrative_momentum"] = momentum.get(n) if n else None

    # Trajectoire longitudinale : on snapshot PUIS on charge l'historique
    # (le snapshot courant entre dans la série).
    await _asyncio.gather(
        *(_record_gem_snapshot(t) for t in filtered), return_exceptions=True
    )
    histories = await _asyncio.gather(
        *(_load_gem_history(t.get("chain", ""), t.get("token_address", ""))
          for t in filtered),
        return_exceptions=True,
    )
    for t, h in zip(filtered, histories):
        t["trajectory"] = _compute_trajectory(h) if isinstance(h, list) else {}

    # Plafonds théoriques : mcap des leaders de catégorie (CoinGecko, 24h cache)
    leader_caps = await _fetch_leader_mcaps()

    # Score each token
    candidates: List[GemCandidate] = []
    for t in filtered:
        score, reasons, warnings = _compute_gem_score(
            liquidity=t.get("liquidity", 0),
            volume_24h=t.get("volume_24h", 0),
            price_change_24h=t.get("price_change_24h", 0),
            age_hours=t.get("age_hours", 168),  # Default to 1 week if unknown
            social_buzz=t.get("social_buzz", 0),
            tokenomics_safety=t.get("tokenomics_safety", 50),
            onchain=t.get("onchain"),
            buys_24h=t.get("buys_24h", 0),
            sells_24h=t.get("sells_24h", 0),
            buys_1h=t.get("buys_1h", 0),
            sells_1h=t.get("sells_1h", 0),
            narrative=t.get("narrative"),
            narrative_momentum=t.get("narrative_momentum"),
            trajectory=t.get("trajectory"),
        )

        traj = t.get("trajectory") or {}
        oc = t.get("onchain") or {}
        _, _, _, moonshot = _score_trajectory(traj)
        moonshot = moonshot and not oc.get("honeypot")
        under_radar = _is_under_the_radar(oc, t.get("social_buzz", 0), traj, score)
        manipulation = _detect_manipulation(
            t.get("liquidity", 0), t.get("volume_24h", 0),
            t.get("buys_24h", 0), t.get("sells_24h", 0), oc,
        )

        candidates.append(GemCandidate(
            symbol=t.get("symbol", ""),
            name=t.get("name", ""),
            chain=t.get("chain", ""),
            price=t.get("price", 0),
            liquidity=t.get("liquidity", 0),
            volume_24h=t.get("volume_24h", 0),
            price_change_24h=t.get("price_change_24h", 0),
            age_hours=t.get("age_hours", 0),
            gem_score=score,
            reasons=reasons,
            warnings=warnings,
            social_buzz=t.get("social_buzz", 0),
            tokenomics_safety=t.get("tokenomics_safety", 50),
            onchain=t.get("onchain") or {},
            narrative=t.get("narrative"),
            narrative_momentum=t.get("narrative_momentum"),
            trajectory=traj,
            moonshot=moonshot,
            under_the_radar=under_radar,
            manipulation=manipulation,
            token_address=t.get("token_address"),
            upside=_estimate_upside(t.get("fdv", 0), t.get("narrative"), leader_caps),
        ))

    # Sort by gem_score descending
    candidates.sort(key=lambda c: c.gem_score, reverse=True)

    top_gems = candidates[:limit]
    moonshots = sum(1 for c in candidates if c.moonshot)

    # Score dans le snapshot le plus récent → calibration future (backtest)
    await _asyncio.gather(*(
        _stamp_gem_score(c.chain, c.token_address, c.gem_score)
        for c in candidates if c.token_address
    ), return_exceptions=True)

    # Push broadcast quand un flag moonshot se déclenche — dédupliqué 48h
    # (la trajectoire peut persister sur plusieurs cycles sans re-notifier).
    from utils.push_notify import broadcast_once
    await _asyncio.gather(*(
        broadcast_once(
            f"moonshot:{c.chain}:{c.token_address or c.symbol}",
            f"🚀 Moonshot — {c.symbol}",
            f"{c.name} ({c.chain}) : trajectoire explosive détectée. "
            f"Score {c.gem_score}/100"
            + (f", holders {c.trajectory.get('holder_growth_pct'):+.0f}%/24h"
               if c.trajectory and c.trajectory.get("holder_growth_pct") is not None else ""),
            {"type": "moonshot", "symbol": c.symbol, "chain": c.chain,
             "gem_score": c.gem_score, "url": next(
                 (t.get("url") for t in filtered if t.get("token_address") == c.token_address), None)},
            cooldown_seconds=48 * 3600,
        )
        for c in top_gems if c.moonshot
    ), return_exceptions=True)

    # Brief analyste LLM par gem shortlistée (cache 6h/token) — le commentaire
    # qualitatif qu'un coach écrirait, généré sur les données mesurées.
    from ml.gem_analyst import gem_llm_comment
    _raw_by_addr = {t.get("token_address"): t for t in filtered}
    llm_comments = await _asyncio.gather(*(
        gem_llm_comment({
            "symbol": c.symbol, "name": c.name, "chain": c.chain,
            "token_address": c.token_address, "gem_score": c.gem_score,
            "liquidity": c.liquidity, "volume_24h": c.volume_24h,
            "price_change_24h": c.price_change_24h, "onchain": c.onchain,
            "trajectory": c.trajectory, "manipulation": c.manipulation,
            "narrative": c.narrative, "social_buzz": c.social_buzz,
            "buys_24h": (_raw_by_addr.get(c.token_address) or {}).get("buys_24h", 0),
            "sells_24h": (_raw_by_addr.get(c.token_address) or {}).get("sells_24h", 0),
            "description": (_raw_by_addr.get(c.token_address) or {}).get("description", ""),
        })
        for c in top_gems
    ), return_exceptions=True)

    return {
        "gems": [
            {
                "symbol": c.symbol,
                "name": c.name,
                "chain": c.chain,
                "price": c.price,
                "liquidity": c.liquidity,
                "volume_24h": c.volume_24h,
                "price_change_24h": c.price_change_24h,
                "gem_score": c.gem_score,
                "social_buzz": c.social_buzz,
                "tokenomics_safety": c.tokenomics_safety,
                "onchain": c.onchain,
                "narrative": c.narrative,
                "narrative_momentum": c.narrative_momentum,
                "trajectory": c.trajectory,
                "moonshot": c.moonshot,
                "under_the_radar": c.under_the_radar,
                "manipulation": c.manipulation,
                "upside": c.upside,
                "llm_comment": c_llm if isinstance(c_llm, str) else None,
                "token_address": c.token_address,
                "reasons": c.reasons,
                "warnings": c.warnings,
                "url": next((t.get("url", "") for t in filtered if t.get("symbol") == c.symbol), ""),
            }
            for c, c_llm in zip(top_gems, llm_comments)
        ],
        "summary": (
            f"{len(top_gems)} hidden gems discovered (scanned {len(tokens)} tokens)"
            + (f" — {moonshots} moonshot trajectory" if moonshots else "")
        ),
        "scanned_count": len(tokens),
        "fetched_at": _now_iso(),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def gems_backtest(min_hours: float = 24) -> Dict[str, Any]:
    """
    Calibration du gem_score sur données réelles : pour chaque token tracké,
    compare le score enregistré au snapshot le plus ancien vs la performance
    prix mesurée depuis la détection. Buckets par tranche de score.

    C'est ce qui transforme le score d'heuristique en métrique calibrée —
    dès que l'historique ≥24h existe, on sait si le score prédit quoi que ce soit.
    """
    try:
        from utils.cache import cache
        r = await cache.client()
        tracked = await r.smembers(_GEM_TRACKED_SET)
    except Exception:
        return {"status": "unavailable", "buckets": [], "tokens": []}

    rows = []
    for key in tracked:
        chain, addr = key.split(":", 1)
        hist = await _load_gem_history(chain, addr)
        if len(hist) < 4:
            continue
        newest, oldest = hist[0], hist[-1]
        span_h = (newest["ts"] - oldest["ts"]) / 3600
        if span_h < min_hours:
            continue
        entry, exit_ = oldest.get("price"), newest.get("price")
        if not entry or not exit_:
            continue
        # Score au moment le plus ancien disponible (proxy du "score à détection")
        score0 = next(
            (s.get("score") for s in reversed(hist) if s.get("score") is not None),
            None,
        )
        rows.append({
            "chain": chain, "address": addr[:12] + "…" if len(addr) > 14 else addr,
            "score": score0, "tracked_hours": round(span_h, 1),
            "perf_pct": round((exit_ - entry) / entry * 100, 1),
        })

    buckets = []
    for lo, hi, label in [(80, 101, "80+"), (60, 80, "60-79"), (0, 60, "<60")]:
        sel = [x for x in rows if x["score"] is not None and lo <= x["score"] < hi]
        if not sel:
            continue
        perfs = [x["perf_pct"] for x in sel]
        buckets.append({
            "bucket": label, "count": len(sel),
            "avg_perf_pct": round(sum(perfs) / len(perfs), 1),
            "win_rate_pct": round(sum(1 for p in perfs if p > 0) / len(perfs) * 100, 1),
            "best": round(max(perfs), 1), "worst": round(min(perfs), 1),
        })

    scored = [x for x in rows if x["score"] is not None]
    return {
        "status": "ok" if len(scored) >= 5 else "collecting",
        "note": None if len(scored) >= 5 else (
            "Calibration en cours — le score n'est horodaté dans les snapshots "
            "que depuis le déploiement du tracking ; les buckets se remplissent "
            "à mesure que l'historique ≥24h s'accumule."
        ),
        "tracked_tokens": len(rows),
        "scored_snapshots": len(scored),
        "buckets": buckets,
        "tokens": sorted(rows, key=lambda x: x["perf_pct"], reverse=True)[:20],
        "fetched_at": _now_iso(),
    }
