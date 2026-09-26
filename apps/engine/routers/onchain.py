"""
Sprint 7 — Données on-chain / marchés dérivés.
Fournit le contexte crypto : funding rate, open interest, spot-perp basis, BTC dominance.
"""
from fastapi import APIRouter, HTTPException
import httpx
import asyncio
from typing import Optional

from utils.rate_limiter import rate_limit
from utils.http import retry_async

router = APIRouter()

BINANCE_SPOT = "https://api.binance.com/api/v3"
BINANCE_FUT = "https://fapi.binance.com/fapi/v1"
COINGECKO_GLOBAL = "https://api.coingecko.com/api/v3/global"

_cache: dict[str, tuple[float, any]] = {}
CACHE_TTL = 300  # 5 min


def _get(key: str):
    import time
    if key in _cache:
        ts, val = _cache[key]
        if time.monotonic() - ts < CACHE_TTL:
            return val
    return None


def _set(key: str, val: any):
    import time
    _cache[key] = (time.monotonic(), val)


def _binance_symbol(symbol: str) -> str:
    base = symbol.split("/")[0].split("-")[0].strip().upper()
    if base.endswith("USDT") or base.endswith("USDC"):
        return base
    return f"{base}USDT"


@rate_limit(max_concurrent=5, min_delay=0.1)
async def _binance_get(url: str, params: Optional[dict] = None):
    async def _do():
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, max_retries=1, base_delay=0.5, source="binance")


@router.get("/funding/{symbol:path}")
async def funding_rate(symbol: str):
    """Dernier funding rate Binance Futures pour un symbole."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"funding:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _binance_get(f"{BINANCE_FUT}/fundingRate", params={"symbol": bin_sym, "limit": 1})
        if not data:
            raise HTTPException(status_code=404, detail=f"No funding data for {symbol}")
        entry = data[0]
        rate = float(entry.get("fundingRate", 0))
        result = {
            "symbol": symbol,
            "funding_rate": round(rate * 100, 4),  # %
            "annualized": round(rate * 100 * 3 * 365, 2),  # 3x par jour
            "timestamp": entry.get("fundingTime"),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Funding rate unavailable: {e}") from e


@router.get("/open-interest/{symbol:path}")
async def open_interest(symbol: str):
    """Open interest Binance Futures."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"oi:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        data = await _binance_get(f"{BINANCE_FUT}/openInterest", params={"symbol": bin_sym})
        result = {
            "symbol": symbol,
            "open_interest": float(data.get("openInterest", 0)),
            "timestamp": data.get("closeTime"),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Open interest unavailable: {e}") from e


@router.get("/spot-perp-basis/{symbol:path}")
async def spot_perp_basis(symbol: str):
    """Écart prix perpétuel vs spot (premium/discount)."""
    bin_sym = _binance_symbol(symbol)
    cache_key = f"basis:{bin_sym}"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        spot, perp = await asyncio.gather(
            _binance_get(f"{BINANCE_SPOT}/ticker/price", params={"symbol": bin_sym}),
            _binance_get(f"{BINANCE_FUT}/ticker/price", params={"symbol": bin_sym}),
        )
        spot_price = float(spot.get("price", 0))
        perp_price = float(perp.get("price", 0))
        if spot_price <= 0:
            raise ValueError("spot price missing")
        basis = (perp_price - spot_price) / spot_price * 100
        result = {
            "symbol": symbol,
            "spot_price": spot_price,
            "perp_price": perp_price,
            "basis_pct": round(basis, 3),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Basis unavailable: {e}") from e


@router.get("/btc-dominance")
async def btc_dominance():
    """BTC dominance from CoinGecko (+ proxy de variation 24h)."""
    cache_key = "btc_dominance"
    cached = _get(cache_key)
    if cached:
        return cached
    try:
        async def _do():
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(COINGECKO_GLOBAL)
                r.raise_for_status()
                glob = r.json()
                # Variation BTC vs marché total → proxy de la variation de dominance
                r2 = await client.get(
                    "https://api.coingecko.com/api/v3/simple/price",
                    params={"ids": "bitcoin", "vs_currencies": "usd",
                            "include_24hr_change": "true"},
                )
                btc_chg = r2.json().get("bitcoin", {}).get("usd_24h_change", 0) if r2.status_code == 200 else 0
                return glob, float(btc_chg or 0)
        (data, btc_chg) = await retry_async(_do, max_retries=1, base_delay=0.5, source="coingecko")
        gdata = data.get("data", {})
        btc = float(gdata.get("market_cap_percentage", {}).get("btc", 0))
        total_chg = float(gdata.get("market_cap_change_percentage_24h_usd", 0) or 0)
        # Si BTC monte plus vite que le marché → dominance monte (approximation)
        dom_chg = btc_chg - total_chg
        result = {
            "btc_dominance": round(btc, 2),
            "dominance_pct": round(btc, 2),
            "change_24h_pct": round(dom_chg, 2),
            "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        }
        _set(cache_key, result)
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"BTC dominance unavailable: {e}") from e


CRYPTO_BASES = {"BTC", "ETH", "SOL", "BNB", "AVAX", "XRP", "LINK", "ADA", "DOT", "MATIC"}


def is_crypto_symbol(symbol: str) -> bool:
    return symbol.endswith("/USDT") and symbol.split("/")[0] in CRYPTO_BASES


def onchain_bonus(
    context: dict,
    signal_direction: str,
    fear_greed_value: Optional[int] = None,
) -> tuple[int, list[str]]:
    """
    Bonus/malus de score basé sur le contexte on-chain (Fear&Greed + Funding Rate).
    signal_direction : 'BUY' | 'SELL'. Max : ±25 pts.
    """
    bonus = 0
    reasons: list[str] = []

    # Fear & Greed (contrarian)
    if fear_greed_value is not None:
        if fear_greed_value < 20:
            if signal_direction == "BUY":
                bonus += 20
                reasons.append(f"On-chain: Fear&Greed extreme fear ({fear_greed_value}) — contrarian BUY")
            else:
                bonus -= 15
                reasons.append(f"On-chain: Fear&Greed extreme fear ({fear_greed_value}) — SELL affaibli")
        elif fear_greed_value > 80:
            if signal_direction == "SELL":
                bonus += 20
                reasons.append(f"On-chain: Fear&Greed extreme greed ({fear_greed_value}) — contrarian SELL")
            else:
                bonus -= 15
                reasons.append(f"On-chain: Fear&Greed extreme greed ({fear_greed_value}) — BUY affaibli")

    # Funding rate (squeeze)
    funding = (context or {}).get("funding_rate") or {}
    rate = funding.get("funding_rate")
    if rate is not None:
        if rate < -0.01 and signal_direction == "BUY":
            bonus += 15
            reasons.append(f"On-chain: funding négatif ({rate}%) — shorts surpeuplés, long squeeze")
        elif rate > 0.05 and signal_direction == "SELL":
            bonus += 15
            reasons.append(f"On-chain: funding élevé ({rate}%) — longs surpeuplés, short squeeze")

    bonus = max(-25, min(25, bonus))
    return bonus, reasons


def _build_interpretation(
    funding_pct: Optional[float],
    basis_pct: Optional[float],
    dominance: Optional[float],
    dominance_chg: Optional[float],
    mempool_count: Optional[int],
    fee_sat_vb: Optional[float],
    gas_gwei: Optional[float],
) -> dict:
    """
    Synthèse interprétative du contexte marché crypto.
    score -100 (risk-off / squeeze baissier probable) → +100 (risk-on alts).
    """
    score = 0
    signals: list[dict] = []

    # Funding — surcharge de longs/shorts (le signal le plus actionnable)
    if funding_pct is not None:
        if funding_pct > 0.05:
            score -= 25
            signals.append({"metric": "funding", "value": funding_pct, "impact": "bearish",
                            "read": f"Funding {funding_pct:+.3f}% — longs surpeuplés, risque de squeeze baissier"})
        elif funding_pct > 0.01:
            score -= 10
            signals.append({"metric": "funding", "value": funding_pct, "impact": "mild_bearish",
                            "read": f"Funding {funding_pct:+.3f}% — biais long marqué"})
        elif funding_pct < -0.01:
            score += 20
            signals.append({"metric": "funding", "value": funding_pct, "impact": "bullish",
                            "read": f"Funding {funding_pct:+.3f}% — shorts surpeuplés, fuel haussier"})
        else:
            signals.append({"metric": "funding", "value": funding_pct, "impact": "neutral",
                            "read": f"Funding {funding_pct:+.3f}% — positionnement équilibré"})

    # Basis — premium perp = spéculation levier
    if basis_pct is not None:
        if basis_pct > 0.15:
            score -= 10
            signals.append({"metric": "basis", "value": basis_pct, "impact": "bearish",
                            "read": f"Perp premium {basis_pct:+.2f}% — levier spéculatif excessif"})
        elif basis_pct < -0.05:
            score += 8
            signals.append({"metric": "basis", "value": basis_pct, "impact": "bullish",
                            "read": f"Perp discount {basis_pct:+.2f}% — peur ou accumulation spot"})
        else:
            signals.append({"metric": "basis", "value": basis_pct, "impact": "neutral",
                            "read": f"Basis {basis_pct:+.2f}% — perp aligné spot"})

    # BTC dominance — rotation BTC vs alts
    if dominance_chg is not None:
        if dominance_chg <= -0.3:
            score += 15
            signals.append({"metric": "dominance", "value": dominance_chg, "impact": "alt_favorable",
                            "read": f"Dominance BTC {dominance_chg:+.2f}%/24h — rotation vers les alts"})
        elif dominance_chg >= 0.3:
            score -= 15
            signals.append({"metric": "dominance", "value": dominance_chg, "impact": "btc_favorable",
                            "read": f"Dominance BTC {dominance_chg:+.2f}%/24h — fuite vers BTC, alts sous pression"})
        else:
            signals.append({"metric": "dominance", "value": dominance or 0, "impact": "neutral",
                            "read": f"Dominance BTC {dominance or 0:.1f}% stable"})

    # Mempool BTC — congestion = demande de settlement, volatilité possible
    if mempool_count is not None and mempool_count > 80_000:
        signals.append({"metric": "mempool", "value": mempool_count, "impact": "info",
                        "read": f"Mempool chargée ({mempool_count:,} tx) — forte demande, volatilité possible"})
    elif fee_sat_vb is not None and fee_sat_vb <= 2:
        signals.append({"metric": "mempool", "value": fee_sat_vb, "impact": "info",
                        "read": f"Réseau calme (fee {fee_sat_vb:.0f} sat/vB)"})

    # Gas ETH — activité on-chain réelle
    if gas_gwei is not None and gas_gwei > 40:
        score += 5
        signals.append({"metric": "gas", "value": gas_gwei, "impact": "bullish",
                        "read": f"Gas ETH {gas_gwei:.0f} gwei — forte activité on-chain"})

    score = max(-100, min(100, score))
    if score >= 30:
        regime, advice = "RISK_ON_ALTS", "Contexte favorable aux altcoins et à la prise de risque — fenêtre adaptée à l'exploration hidden gems."
    elif score >= 10:
        regime, advice = "RISK_ON", "Contexte légèrement favorable — signaux BUY du scanner plus fiables."
    elif score <= -30:
        regime, advice = "SQUEEZE_RISK", "Marché déséquilibré (surcharge détectée) — réduire la taille, méfiance sur les LONGS."
    elif score <= -10:
        regime, advice = "RISK_OFF", "Contexte défavorable aux alts — privilégier BTC/majors, prudence sur les gems."
    else:
        regime, advice = "NEUTRAL", "Pas de biais dominant — laisser les signaux techniques guider."

    return {"score": score, "regime": regime, "signals": signals, "advice": advice}


async def _mempool_stats() -> dict:
    """Congestion BTC via mempool.space (gratuit, sans clé)."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get("https://mempool.space/api/mempool")
            mp = r.json() if r.status_code == 200 else {}
            r2 = await client.get("https://mempool.space/api/v1/fees/recommended")
            fees = r2.json() if r2.status_code == 200 else {}
        return {
            "mempool_count": mp.get("count"),
            "fee_fastest": fees.get("fastestFee"),
        }
    except Exception:
        return {"mempool_count": None, "fee_fastest": None}


async def _eth_gas_gwei() -> Optional[float]:
    """Gas ETH médian via BlockCypher (gratuit, sans clé)."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get("https://api.blockcypher.com/v1/eth/main")
            if r.status_code == 200:
                wei = float(r.json().get("medium_gas_price", 0))
                return round(wei / 1e9, 1) if wei else None
    except Exception:
        pass
    return None


@router.get("/market-interpretation")
async def market_interpretation(symbol: str = "BTC/USDT"):
    """
    GET /onchain/market-interpretation — Synthèse lisible du contexte marché :
    funding, basis, dominance BTC, mempool, gas ETH → régime + score + conseil.
    """
    cache_key = f"interpretation:{symbol}"
    cached = _get(cache_key)
    if cached:
        return cached

    funding, basis, dom, mempool, gas = await asyncio.gather(
        funding_rate(symbol),
        spot_perp_basis(symbol),
        btc_dominance(),
        _mempool_stats(),
        _eth_gas_gwei(),
        return_exceptions=True,
    )

    def _v(res, key):
        return res.get(key) if isinstance(res, dict) else None

    interp = _build_interpretation(
        funding_pct=_v(funding, "funding_rate"),
        basis_pct=_v(basis, "basis_pct"),
        dominance=_v(dom, "dominance_pct"),
        dominance_chg=_v(dom, "change_24h_pct"),
        mempool_count=_v(mempool, "mempool_count"),
        fee_sat_vb=_v(mempool, "fee_fastest"),
        gas_gwei=gas if isinstance(gas, float) else None,
    )

    # Push sur changement de régime notable (SQUEEZE_RISK, RISK_OFF, RISK_ON_ALTS)
    # — dédupliqué 4h via Redis, no-op si le régime n'a pas changé.
    global _last_regime
    new_regime = interp["regime"]
    if _last_regime and new_regime != _last_regime and new_regime in (
        "SQUEEZE_RISK", "RISK_OFF", "RISK_ON_ALTS",
    ):
        from utils.push_notify import broadcast_once
        _regime_labels = {
            "SQUEEZE_RISK": "⚠️ Marché déséquilibré",
            "RISK_OFF": "🔴 Régime défavorable",
            "RISK_ON_ALTS": "🟢 Fenêtre altcoins",
        }
        await broadcast_once(
            f"regime:{new_regime}",
            f"{_regime_labels[new_regime]} — {new_regime}",
            f"Régime onchain {_last_regime} → {new_regime} (score {interp['score']:+d}). {interp['advice']}",
            {"type": "regime_change", "from": _last_regime, "to": new_regime,
             "score": interp["score"]},
            cooldown_seconds=4 * 3600,
        )
    _last_regime = new_regime

    result = {
        "symbol": symbol,
        **interp,
        "components": {
            "funding_rate": funding if isinstance(funding, dict) else None,
            "basis": basis if isinstance(basis, dict) else None,
            "btc_dominance": dom if isinstance(dom, dict) else None,
            "mempool": mempool,
            "gas_gwei": gas if isinstance(gas, float) else None,
        },
    }
    _set(cache_key, result)
    return result


_last_regime: str | None = None


async def _coingecko_markets(gecko_ids: list) -> dict:
    """Batch CoinGecko /coins/markets — volume 24h + variation 7j par id."""
    if not gecko_ids:
        return {}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={
                    "vs_currency": "usd",
                    "ids": ",".join(gecko_ids[:200]),
                    "price_change_percentage": "7d",
                },
            )
            r.raise_for_status()
            return {c["id"]: c for c in r.json()}
    except Exception:
        return {}


def _coach_comment(name: str, mcap_tvl: float, vol_mcap: float | None,
                   trend_7d: float | None, tvl_chg: float | None) -> str:
    """
    Commentaire automatique façon "analyste" : lit les ratios et dit ce qu'ils
    signifient concrètement pour CE protocole — pas un score brut.
    """
    parts = []
    if mcap_tvl < 0.4:
        parts.append(f"le marché valorise {name} à {mcap_tvl:.0%} de sa TVL — décote structurelle marquée")
    elif mcap_tvl < 0.8:
        parts.append(f"mcap = {mcap_tvl:.0%} de la TVL — valorisation modérée")
    else:
        parts.append(f"mcap {mcap_tvl:.1f}x la TVL — déjà pricé au-dessus des fonds bloqués")

    if vol_mcap is not None:
        if vol_mcap > 0.15:
            parts.append("volume/mcap élevé — forte activité pour cette taille")
        elif vol_mcap < 0.02:
            parts.append("volume/mcap très faible — peu d'intérêt marché actuellement")

    if trend_7d is not None:
        if trend_7d > 25:
            parts.append(f"+{trend_7d:.0f}% sur 7j — la repricing a déjà commencé")
        elif trend_7d < -20:
            parts.append(f"{trend_7d:.0f}% sur 7j — baisse forte, peut signaler une value trap")
        else:
            parts.append(f"prix stable sur 7j ({trend_7d:+.0f}%) — la découverte n'a pas encore eu lieu")

    if tvl_chg is not None:
        if tvl_chg > 5:
            parts.append("TVL en croissance — du capital entre dans le protocole")
        elif tvl_chg < -8:
            parts.append("TVL en sortie — le ratio bas peut refléter une perte de confiance")

    return " · ".join(parts)


def _undervalued_score(mcap_tvl: float, vol_mcap: float | None,
                       trend_7d: float | None, tvl_chg: float | None) -> int:
    """Score 0-100 — même raisonnement qu'un coach : mcap/tvl + volume/mcap
    + tendance 7j + dynamique TVL. Screening, pas signal d'achat."""
    s = 0
    if mcap_tvl < 0.3:
        s += 40
    elif mcap_tvl < 0.6:
        s += 30
    elif mcap_tvl < 1.0:
        s += 20
    else:
        s += 10
    if vol_mcap is not None:
        s += 25 if vol_mcap > 0.15 else 15 if vol_mcap > 0.08 else 8 if vol_mcap > 0.04 else 0
    if trend_7d is not None:
        if trend_7d > 25:
            s -= 15  # déjà repricé — plus "undervalued"
        elif trend_7d < -30:
            s -= 10  # possible value trap
        elif -10 <= trend_7d <= 15:
            s += 15  # bon marché ET stable
        else:
            s += 5
    if tvl_chg is not None:
        if tvl_chg > 5:
            s += 10
        elif tvl_chg < -8:
            s -= 10
    return max(0, min(100, s))


@router.get("/undervalued")
async def undervalued_protocols(limit: int = 15):
    """
    GET /onchain/undervalued — Protocoles établis potentiellement sous-évalués.

    Combine mcap/TVL (DefiLlama) + volume/mcap + tendance 7j (CoinGecko) —
    le même raisonnement qu'un analyste ("cap/tvl bon, volume/cap bon"),
    mais mesuré en continu sur tous les protocoles indexés.
    Chaque ligne porte un commentaire explicatif généré automatiquement.
    """
    cache_key = "undervalued:protocols"
    cached = _get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get("https://api.llama.fi/protocols")
            r.raise_for_status()
            protocols = r.json()
    except Exception:
        raise HTTPException(502, "DefiLlama unreachable") from None

    rows = []
    for p in protocols:
        tvl = float(p.get("tvl") or 0)
        mcap = float(p.get("mcap") or 0)
        if tvl < 20_000_000 or mcap < 5_000_000:
            continue
        ratio = mcap / tvl
        if ratio > 1.5:
            continue
        rows.append({
            "name": p.get("name"),
            "symbol": (p.get("symbol") or "").upper() or None,
            "category": p.get("category"),
            "tvl": round(tvl),
            "mcap": round(mcap),
            "mcap_tvl": round(ratio, 2),
            "tvl_change_1d_pct": p.get("change_1d"),
            "gecko_id": p.get("gecko_id"),
        })

    rows.sort(key=lambda x: x["mcap_tvl"])

    # Plafond théorique par catégorie : mcap du leader DefiLlama de la même
    # catégorie / mcap du protocole. Honnête : "si X atteint le leadership de
    # sa catégorie" — jamais une promesse de performance.
    cat_leader: dict = {}
    for p in protocols:
        cat, mc = p.get("category"), float(p.get("mcap") or 0)
        if cat and mc > cat_leader.get(cat, 0):
            cat_leader[cat] = mc
    for r in rows:
        leader = cat_leader.get(r["category"] or "", 0)
        r["upside_x"] = round(leader / r["mcap"], 1) if leader > r["mcap"] else None

    # Enrichissement CoinGecko : volume/mcap + tendance 7j pour les meilleurs
    # candidats (ceux qu'on va retourner), via gecko_id DefiLlama → CoinGecko.
    top = rows[: max(limit, 30)]
    markets = await _coingecko_markets([r["gecko_id"] for r in top if r.get("gecko_id")])
    for row in top:
        g = markets.get(row.get("gecko_id") or "")
        vol_24h = float(g.get("total_volume") or 0) if g else 0
        row["volume_24h"] = round(vol_24h) if vol_24h else None
        row["vol_mcap"] = round(vol_24h / row["mcap"], 3) if vol_24h and row["mcap"] else None
        row["trend_7d_pct"] = (
            round(float(g["price_change_percentage_7d_in_currency"]), 1)
            if g and g.get("price_change_percentage_7d_in_currency") is not None else None
        )
        row["undervalued_score"] = _undervalued_score(
            row["mcap_tvl"], row["vol_mcap"], row["trend_7d_pct"], row["tvl_change_1d_pct"],
        )
        row["comment"] = _coach_comment(
            row["name"], row["mcap_tvl"], row["vol_mcap"],
            row["trend_7d_pct"], row["tvl_change_1d_pct"],
        )
        row.pop("gecko_id", None)

    top.sort(key=lambda x: x.get("undervalued_score", 0), reverse=True)
    result = {
        "undervalued": top[:limit],
        "scanned_count": len(protocols),
        "note": (
            "undervalued_score combine mcap/tvl, volume/mcap, tendance 7j et "
            "dynamique TVL ; upside_x = plafond théorique vs leader de catégorie. "
            "Heuristique de screening pour due diligence — "
            "un ratio bas peut aussi refléter un protocole en déclin, pas un signal d'achat."
        ),
        "fetched_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
    }
    _set(cache_key, result)
    return result


# ── Yield / staking / LP opportunities ───────────────────────────────────────

def _yield_score(apy: float, tvl: float, apy_base: float | None,
                 apy_reward: float | None, il_risk: str | None,
                 exposure: str | None, pred_class: str | None) -> tuple[int, list[str]]:
    """Score risque-ajusté 0-100 d'une pool. Un APY élevé ne suffit pas :
    TVL faible, rendement purement inflationniste (reward), IL fort ou
    prédiction baissière = pénalités."""
    import math
    flags: list[str] = []
    s = min(45.0, math.log10(max(apy, 0.1)) * 25)          # APY plafonne le gain
    s += min(35.0, math.log10(max(tvl, 1)) * 5)             # TVL = confiance
    if tvl < 2_000_000:
        s -= 15
        flags.append("TVL faible — sortie difficile / risque de drain")
    if apy_reward and apy > 0 and (apy_reward / apy) > 0.7:
        s -= 20
        flags.append("APY surtout incentive (token émis) — inflation probable")
    if apy_base is not None and apy_base <= 0 and apy > 0:
        s -= 10
        flags.append("aucun rendement réel (frais) — 100% récompenses")
    if (il_risk or "").lower() == "yes":
        s -= 8
        flags.append("risque d'impermanent loss")
    if (exposure or "").lower() == "multi":
        s -= 5
        flags.append("exposition multi-actifs — corrélation/IL plus complexe")
    if (pred_class or "").lower() in ("stable/down", "down"):
        s -= 15
        flags.append("modèle DefiLlama prédit un APY en baisse")
    return max(0, min(100, round(s))), flags


def _yield_comment(p: dict, score: int, flags: list[str]) -> str:
    bits = [f"{p.get('project')} ({p.get('chain')}) — APY {p.get('apy')}% sur {p.get('symbol')}"]
    if score >= 65:
        bits.append("rendement solide et durable en théorie")
    elif score >= 40:
        bits.append("rendement correct avec réserves")
    else:
        bits.append("opportunité risquée — due diligence requise")
    if flags:
        bits.append(flags[0])
    return " · ".join(bits)


@router.get("/yield-opportunities")
async def yield_opportunities(limit: int = 15, min_tvl: float = 1_000_000):
    """
    GET /onchain/yield-opportunities — pools staking/LP triées par score
    risque-ajusté (DefiLlama yields : APY, TVL, split base/reward, IL).
    L'APY seul ne suffit pas : on pénalise l'inflation d'incentives, la TVL
    faible, l'IL et les prédictions baissières.
    """
    cache_key = f"yield:opportunities:{min_tvl}"
    cached = _get(cache_key)
    if cached:
        return dict(cached, opportunities=(cached.get("opportunities") or [])[:limit])
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get("https://yields.llama.fi/pools")
            r.raise_for_status()
            pools = r.json().get("data", [])
    except Exception:
        raise HTTPException(502, "DefiLlama yields unreachable") from None

    rows = []
    for p in pools:
        apy = p.get("apy")
        tvl = float(p.get("tvlUsd") or 0)
        if apy is None or tvl < min_tvl:
            continue
        apy = float(apy)
        if not 0.5 <= apy <= 300:  # outliers / APY absurdes exclus
            continue
        score, flags = _yield_score(
            apy, tvl, p.get("apyBase"), p.get("apyReward"),
            p.get("ilRisk"), p.get("exposure"),
            (p.get("predictions") or {}).get("predictedClass"),
        )
        row = {
            "pool": p.get("pool"), "project": p.get("project"),
            "chain": p.get("chain"), "symbol": p.get("symbol"),
            "tvl": round(tvl), "apy": round(apy, 2),
            "apy_base": round(float(p["apyBase"]), 2) if p.get("apyBase") is not None else None,
            "apy_reward": round(float(p["apyReward"]), 2) if p.get("apyReward") is not None else None,
            "il_risk": p.get("ilRisk"), "stablecoin": bool(p.get("stablecoin")),
            "score": score, "risk_flags": flags,
        }
        row["comment"] = _yield_comment(row, score, flags)
        rows.append(row)

    rows.sort(key=lambda x: x["score"], reverse=True)
    result = {
        "opportunities": rows[:100],
        "scanned_count": len(pools),
        "note": (
            "Score risque-ajusté = APY plafonné + confiance TVL − inflation "
            "d'incentives − IL − prédiction baissière. Un APY élevé sur TVL "
            "faible est pénalisé, pas récompensé. Screening — pas du conseil."
        ),
        "fetched_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
    }
    _set(cache_key, result)
    return dict(result, opportunities=result["opportunities"][:limit])


# ── Airdrop candidates ────────────────────────────────────────────────────────

@router.get("/airdrop-candidates")
async def airdrop_candidates(limit: int = 15, min_tvl: float = 50_000_000):
    """
    GET /onchain/airdrop-candidates — protocoles majeurs sans token (ou
    mcap négligeable vs TVL). Pattern historique : Uniswap, dYdX, Arbitrum,
    EigenLayer ont récompensé leurs utilisateurs précoces. Un protocole à
    forte TVL sans token = candidat plausible à un futur airdrop.
    """
    cache_key = f"airdrop:candidates:{min_tvl}"
    cached = _get(cache_key)
    if cached:
        return dict(cached, candidates=(cached.get("candidates") or [])[:limit])
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get("https://api.llama.fi/protocols")
            r.raise_for_status()
            protocols = r.json()
    except Exception:
        raise HTTPException(502, "DefiLlama unreachable") from None

    import math
    # Noms de protocoles ayant déjà un token listé (pour exclure les sous-modules
    # type "Aave V3" quand "Aave" a un gecko_id)
    tokenized_bases = {
        (p.get("name") or "").lower().split()[0]
        for p in protocols
        if p.get("gecko_id") and p.get("name")
    }
    # Émetteurs custodials/CEX-adjacents — jamais des candidats airdrop
    custodial = {"binance", "coinbase", "bitfinex", "bybit", "okx", "kraken",
                 "crypto.com", "robinhood", "wbtc", "upbit", "gemini"}

    rows = []
    for p in protocols:
        tvl = float(p.get("tvl") or 0)
        mcap = float(p.get("mcap") or 0)
        if tvl < min_tvl:
            continue
        if (p.get("category") or "") in ("CEX", "CeFi"):
            continue
        first_word = (p.get("name") or "").lower().split()[0] if p.get("name") else ""
        if first_word in custodial:
            continue
        # Token déjà listé (gecko_id propre ou via le protocole parent)
        if p.get("gecko_id") or first_word in tokenized_bases:
            continue
        if mcap > 0 and mcap / tvl > 0.02:
            continue
        score = min(100, round(math.log10(tvl) * 12))
        if p.get("change_7d") and p["change_7d"] > 0:
            score += 5
        rows.append({
            "name": p.get("name"),
            "category": p.get("category"),
            "chains": p.get("chains") or [],
            "tvl": round(tvl),
            "mcap": round(mcap) if mcap else 0,
            "tokenless": mcap <= 0,
            "url": p.get("url"),
            "twitter": p.get("twitter"),
            "tvl_change_7d_pct": p.get("change_7d"),
            "score": min(100, score),
            "comment": (
                f"{p.get('name')} — {p.get('category')} · TVL ${tvl/1e6:,.0f}M, "
                + ("aucun token listé" if mcap <= 0 else f"mcap/TVL {mcap/tvl:.1%} (quasi tokenless)")
                + " — l'usage précoce de protocoles dans ce profil a historiquement "
                  "été récompensé par des airdrops"
            ),
        })

    rows.sort(key=lambda x: x["tvl"], reverse=True)
    result = {
        "candidates": rows[:100],
        "scanned_count": len(protocols),
        "note": (
            "Heuristique : TVL élevée + token absent/quasi absent = profil "
            "historique des gros airdrops. Aucune garantie — un airdrop "
            "n'est jamais annoncé à l'avance."
        ),
        "fetched_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).isoformat(),
    }
    _set(cache_key, result)
    return dict(result, candidates=result["candidates"][:limit])


@router.get("/context/{symbol:path}")
async def onchain_context(symbol: str):
    """Agrège les données on-chain pour un symbole crypto."""
    if not is_crypto_symbol(symbol):
        return {}

    results = await asyncio.gather(
        funding_rate(symbol),
        open_interest(symbol),
        spot_perp_basis(symbol),
        btc_dominance(),
        return_exceptions=True,
    )
    return {
        "funding_rate": results[0] if not isinstance(results[0], Exception) else None,
        "open_interest": results[1] if not isinstance(results[1], Exception) else None,
        "spot_perp_basis": results[2] if not isinstance(results[2], Exception) else None,
        "btc_dominance": results[3] if not isinstance(results[3], Exception) else None,
    }
