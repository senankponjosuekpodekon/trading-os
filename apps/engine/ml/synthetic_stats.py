"""Mesure d'asymétrie BOOM/CRASH — la réalité vs le contrat Deriv.

Deriv documente les indices Boom/Crash comme un drift constant + des spikes
dans le sens opposé (~1 spike tous les N ticks, N = 300/500/1000 selon
l'indice). La stratégie "drift-harvest" (vendre dans le sens du drift avec
un SL calibré sur les spikes) n'a de sens que si la fréquence/taille RÉELLE
des spikes laisse une espérance positive :

    E(par tick) = drift_moyen − spike_freq × spike_taille_moyenne

Ce module mesure ces trois quantités sur les bougies 1m Deriv (le spike
est contenu dans une bougie — on le détecte par le range anormal) et publie
un verdict exploitable par symbole. Suivi assuré par cron_synthetic_stats
(snapshots horaires + alerte broadcast si le verdict bascule).

Note : la bougie 1m agrège ~30 ticks — on mesure des spikes PAR BOUGIE et on
normalise en équivalent "par 1000 bougies" (~1000×30 ticks ≈ horizon du
contrat). C'est une approximation documentée, pas la fréquence tick exacte.
"""
from __future__ import annotations

import time
from typing import Optional

import numpy as np
import pandas as pd

from utils.logger import get_logger

logger = get_logger(__name__)

# Fréquence de spikes contractuelle par famille d'indice (ticks)
CONTRACT_SPIKE_EVERY_N = {
    "BOOM1000": 1000, "CRASH1000": 1000,
    "BOOM500": 500, "CRASH500": 500,
    "BOOM300": 300, "CRASH300": 300,
    "JUMP75": 30,  # Jump indices : ~3 spikes / 30 ticks en moyenne (vol 75)
}
# Approximation : ticks par bougie 1m (~1 tick / 2s)
TICKS_PER_CANDLE = 30
# Un spike = bougie dont le range dépasse K × range médian
SPIKE_RANGE_MULT = 3.0


def measure_spikes(df: pd.DataFrame, symbol: str) -> dict:
    """Mesure drift + distribution des spikes sur des bougies 1m.

    Retourne un dict avec fréquence mesurée, taille moyenne, drift par
    bougie, espérance par 1000 bougies et verdict EXPLOITABLE / DANGEROUS /
    NEUTRAL. Jamais de raise — données insuffisantes → verdict UNKNOWN.
    """
    if df is None or len(df) < 200:
        return {"symbol": symbol, "verdict": "INSUFFICIENT_DATA", "n_candles": 0 if df is None else len(df)}

    close = df["close"].astype(float)
    rng = (df["high"].astype(float) - df["low"].astype(float))
    rets = close.pct_change().dropna() * 100.0  # %

    med_range = float(rng.median())
    if med_range <= 0:
        return {"symbol": symbol, "verdict": "UNKNOWN", "reason": "zero_range"}

    # Direction attendue des spikes : BOOM/JUMP → spikes baissiers,
    # CRASH → spikes haussiers (les indices Jump ont les deux sens,
    # traités comme BOOM côté structure dominante).
    is_crash = symbol.startswith("CRASH")
    ret_signed = rets.values
    spike_mask = (rng.iloc[1:].values > SPIKE_RANGE_MULT * med_range)
    if is_crash:
        spike_mask &= ret_signed > 0
    else:
        spike_mask &= ret_signed < 0

    n_candles = len(rets)
    n_spikes = int(spike_mask.sum())
    spike_sizes = np.abs(ret_signed[spike_mask]) if n_spikes else np.array([])
    drift_rets = ret_signed[~spike_mask]

    spikes_per_1000 = n_spikes / n_candles * 1000.0
    avg_spike_pct = float(spike_sizes.mean()) if n_spikes else 0.0
    med_spike_pct = float(np.median(spike_sizes)) if n_spikes else 0.0
    max_spike_pct = float(spike_sizes.max()) if n_spikes else 0.0
    p95_spike_pct = float(np.percentile(spike_sizes, 95)) if n_spikes >= 10 else max_spike_pct

    drift_pct_per_candle = float(drift_rets.mean()) if len(drift_rets) else 0.0
    drift_direction = "DOWN" if drift_pct_per_candle < 0 else "UP"
    # Le drift travaille pour un SELL sur CRASH, un BUY sur BOOM —
    # l'espérance exprimée est celle de la position côté drift.
    trade_side = "SELL" if is_crash else "BUY"
    drift_in_favor = abs(drift_pct_per_candle)

    # Espérance nette par 1000 bougies : drift capté − coût des spikes.
    # Hypothèse conservative : chaque spike traverse le SL calibré à p95.
    exp_drift_1000 = drift_in_favor * 1000.0
    exp_cost_1000 = spikes_per_1000 * p95_spike_pct
    expectancy_net = exp_drift_1000 - exp_cost_1000

    contract_n = CONTRACT_SPIKE_EVERY_N.get(symbol)
    # Conversion bougie→ticks : contract exprimé en spikes/1000 ticks,
    # nous mesurons spikes/1000 bougies (~×30 ticks) → fréquence attendue
    # par 1000 bougies ≈ 1000 bougies × 30 ticks / N_ticks.
    expected_per_1000c = (1000.0 * TICKS_PER_CANDLE / contract_n) if contract_n else None
    freq_ratio = (spikes_per_1000 / expected_per_1000c) if expected_per_1000c else None

    if n_spikes < 5:
        verdict = "INSUFFICIENT_DATA"
    elif expectancy_net > 0 and (freq_ratio is None or freq_ratio < 1.5):
        verdict = "EXPLOITABLE"
    elif expectancy_net > 0:
        verdict = "FRAGILE"          # edge positif mais spikes plus fréquents que prévu
    else:
        verdict = "DANGEROUS"        # les spikes coûtent plus que le drift ne paie

    return {
        "symbol": symbol,
        "n_candles": n_candles,
        "n_spikes": n_spikes,
        "spikes_per_1000_candles": round(spikes_per_1000, 2),
        "contract_expected_per_1000c": round(expected_per_1000c, 2) if expected_per_1000c else None,
        "freq_vs_contract": round(freq_ratio, 2) if freq_ratio else None,
        "avg_spike_pct": round(avg_spike_pct, 3),
        "median_spike_pct": round(med_spike_pct, 3),
        "p95_spike_pct": round(p95_spike_pct, 3),
        "max_spike_pct": round(max_spike_pct, 3),
        "drift_pct_per_candle": round(drift_pct_per_candle, 5),
        "drift_direction": drift_direction,
        "trade_side": trade_side,
        "suggested_sl_pct": round(p95_spike_pct * 1.2, 3),   # SL au-delà du p95 des spikes
        "expectancy_drift_per_1000c": round(exp_drift_1000, 3),
        "expectancy_cost_per_1000c": round(exp_cost_1000, 3),
        "expectancy_net_per_1000c": round(expectancy_net, 3),
        "verdict": verdict,
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


async def measure_symbol(symbol: str, limit: int = 2000) -> dict:
    """Fetch les bougies 1m Deriv et mesure l'asymétrie."""
    try:
        from routers.scan_fetchers import fetch_deriv_klines
        df = await fetch_deriv_klines(symbol, "1m", limit=limit)
        return measure_spikes(df, symbol)
    except Exception as exc:
        logger.warning("synthetic_stats_failed", symbol=symbol, error=str(exc))
        return {"symbol": symbol, "verdict": "ERROR", "error": str(exc)[:200]}


async def measure_all(symbols: Optional[list[str]] = None) -> dict[str, dict]:
    """Mesure tous les symboles BOOM/CRASH/JUMP connus."""
    if symbols is None:
        symbols = [s for s in CONTRACT_SPIKE_EVERY_N if not s.startswith("JUMP")]
    out = {}
    for sym in symbols:
        out[sym] = await measure_symbol(sym)
    return out


# ── Persistance + suivi ──────────────────────────────────────────────
_STATS_TTL = 7200          # stats fraîches 2h
_HISTORY_MAX = 24 * 30     # ~30 jours de snapshots horaires


async def store_stats(stats: dict[str, dict]) -> None:
    """Persiste le dernier snapshot + historique horodaté (Redis)."""
    try:
        from utils.cache import cache
        r = await cache.client()
        import json
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for sym, st in stats.items():
            await r.set(f"synthetic:stats:{sym}", json.dumps(st, default=str), ex=_STATS_TTL)
        await r.rpush("synthetic:stats_history",
                      json.dumps({"ts": ts, "stats": {s: v.get("verdict") for s, v in stats.items()}}, default=str))
        await r.ltrim("synthetic:stats_history", -_HISTORY_MAX, -1)
    except Exception as exc:
        logger.debug("synthetic_stats_store_failed", error=str(exc))


async def get_stored(symbol: str) -> Optional[dict]:
    try:
        from utils.cache import cache
        import json
        r = await cache.client()
        raw = await r.get(f"synthetic:stats:{symbol}")
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def get_history(limit: int = 168) -> list:
    try:
        from utils.cache import cache
        import json
        r = await cache.client()
        rows = await r.lrange("synthetic:stats_history", -limit, -1)
        return [json.loads(x) for x in rows]
    except Exception:
        return []
