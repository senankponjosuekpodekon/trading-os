#!/usr/bin/env python3
"""B1 — Backtest levier sur signaux résolus (méthodologie honnête).

Règles (cadrage validé) :
  - Rejeu du CHEMIN de bougies (high/low), pas du résultat final. Un signal
    marqué WIN peut avoir touché la liquidation avant le TP.
  - Ordre intrabar pessimiste : liquidation puis SL testés AVANT le TP dans
    une même bougie.
  - Coûts sur notionnel : taker 0.05%×2, slippage 0.02%×2, funding 0.01%/8h
    tant que la position est ouverte (toujours débité = conservateur).
  - Périmètre : signaux FUTURES (crypto perp) + MARGIN (forex/commodités).
    SPOT exclu du levier ; la baseline = mêmes trades en ×1 spot (frais,
    pas de funding).
  - Liquidation isolated : distance ≈ (100/L - 1.5)% adverse (buffer
    maintenance margin) → ×5 ≈ 18.5%, ×10 ≈ 8.5%.
  - Métriques : espérance/trade, equity curve, max drawdown, liquidations,
    pire série perdante, risque de ruine, bootstrap IC95%.
    IC ×1 vs ×3 qui se chevauchent → "indéterminé", pas "×3 gagne".

Usage:
  python3 leverage_backtest.py signals.csv candles.csv
"""

import csv
import math
import random
import sys
from datetime import datetime

# Coûts PAR VENUE — un CFD forex ne paie ni taker ni funding crypto.
#   FUTURES : taker 0.05%×2 + slippage 0.02%×2 + funding 0.01%/8h (notionnel)
#   MARGIN  : spread ~0.02% aller-retour + financing ~0.005%/jour (CFD Oanda)
#   SPOT    : taker 0.1%×2 (pas de funding, pas de levier)
COSTS = {
    "FUTURES": {"rt_frac": 2 * (0.0005 + 0.0002), "per_8h": 0.0001},
    "MARGIN":  {"rt_frac": 0.0002,                "per_8h": 0.005 / 24 / 8},
    "SPOT":    {"rt_frac": 2 * 0.001,             "per_8h": 0.0},
}
MM_BUFFER = 0.015        # 1.5% buffer maintenance margin
LEVERAGES = [1, 2, 3, 5, 10]
STAKE = 100.0            # USDT de marge par trade
BANKROLL = 1000.0        # 10 stakes — risque de ruine mesuré dessus
BOOTSTRAP_N = 10_000

# Crypto = perp Binance (FUTURES) ; forex/commodités/métaux = CFD (MARGIN)
CRYPTO = {"BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOT",
          "MATIC", "NEAR", "DOGE", "LTC", "ATOM", "UNI", "TRX"}
SPOT_ONLY = {"BRVM"}


def venue(symbol: str) -> str:
    base = symbol.split("/")[0].upper()
    if base in SPOT_ONLY:
        return "SPOT"
    return "FUTURES" if base in CRYPTO else "MARGIN"


def ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "").split(".")[0]).timestamp()


def load(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def liq_distance(leverage: float) -> float:
    return max(0.0, 1.0 / leverage - MM_BUFFER)


def replay(sig, candles, L):
    """Rejoue le trade au levier L. Retourne (pnl_pct_marge, exit_reason, durée_h)."""
    entry = float(sig["entryPrice"] or 0)
    if entry <= 0:
        return None
    long_ = sig["signal"] == "BUY"
    sl = float(sig["stopLoss"] or 0) or None
    tp = float(sig["takeProfit1"] or 0) or None
    d = liq_distance(L)
    liq_px = entry * (1 - d) if long_ else entry * (1 + d)

    t_entry, t_end = ts(sig["entry_ts"]), ts(sig["end_ts"] or sig["entry_ts"])
    path = [c for c in candles
            if ts(c["open_time"]) >= t_entry and ts(c["open_time"]) <= t_end]
    if not path:
        return None

    exit_px = None
    reason = None
    for c in path:
        hi, lo = float(c["high"]), float(c["low"])
        # Ordre pessimiste : liquidation d'abord, puis SL, puis TP
        if long_:
            if lo <= liq_px:
                exit_px, reason = liq_px, "LIQUIDATED"
            elif sl and lo <= sl:
                exit_px, reason = sl, "SL"
            elif tp and hi >= tp:
                exit_px, reason = tp, "TP"
        else:
            if hi >= liq_px:
                exit_px, reason = liq_px, "LIQUIDATED"
            elif sl and hi >= sl:
                exit_px, reason = sl, "SL"
            elif tp and lo <= tp:
                exit_px, reason = tp, "TP"
        if reason:
            break
    if not reason:
        exit_px, reason = float(path[-1]["close"]), "EXPIRED"

    move = (exit_px - entry) / entry if long_ else (entry - exit_px) / entry
    dur_h = (ts(path[-1]["open_time"]) - t_entry) / 3600.0

    # Coûts sur notionnel → ×L en % de marge — modèle par venue
    c = COSTS[venue(sig["symbol"])]
    gross = move * L * 100
    fees = c["rt_frac"] * L * 100
    holding = math.floor(dur_h / 8) * c["per_8h"] * L * 100
    # R multiple : PnL net en fraction du risque prix (distance SL)
    sl_dist = abs(entry - sl) / entry if sl else None
    r_mult = None
    if sl_dist and sl_dist > 0:
        net_frac = move - c["rt_frac"] - math.floor(dur_h / 8) * c["per_8h"]
        if reason == "LIQUIDATED":
            net_frac = -d
        r_mult = net_frac / sl_dist

    if reason == "LIQUIDATED":
        return (-100.0 - fees - holding, reason, dur_h, r_mult)
    return (gross - fees - holding, reason, dur_h, r_mult)


def metrics(trades, label):
    """trades = [(pnl_pct_marge, day_str, r_units)]. IC95% par BLOCK BOOTSTRAP
    sur les jours : 176/191 signaux sont EUR/GBP 1h, corrélés dans le temps —
    un bootstrap iid sous-estimerait la variance."""
    if not trades:
        print(f"{label}: aucun trade rejoué")
        return None
    pnls = [t[0] for t in trades]
    n = len(pnls)
    eq, peak, max_dd = 0.0, 0.0, 0.0
    worst_streak = streak = 0
    liqs = 0
    for p in pnls:
        eq += p * STAKE / 100
        peak = max(peak, eq)
        max_dd = max(max_dd, peak - eq)
        if p < 0:
            streak += 1
            worst_streak = max(worst_streak, streak)
        else:
            streak = 0
        if p <= -100:
            liqs += 1
    exp = sum(pnls) / n
    r_units = [t[2] for t in trades if t[2] is not None]
    exp_r = sum(r_units) / len(r_units) if r_units else None

    # Block bootstrap : on ré-échantillonne des JOURS entiers (clusters) —
    # les trades d'un même jour sont corrélés (même régime, même paire).
    days = {}
    for i, t in enumerate(trades):
        days.setdefault(t[1], []).append(i)
    day_list = list(days.values())
    n_days = len(day_list)
    rng = random.Random(42)
    means, ruins = [], 0
    for _ in range(BOOTSTRAP_N):
        idx = [i for day in rng.choices(day_list, k=n_days) for i in day]
        sample = [pnls[i] for i in idx]
        means.append(sum(sample) / len(sample))
        eq2 = BANKROLL
        pk = eq2
        dd = 0.0
        for p in sample:
            eq2 += p * STAKE / 100
            pk = max(pk, eq2)
            dd = max(dd, pk - eq2)
            if eq2 <= 0:
                break
        if eq2 <= 0 or dd >= BANKROLL:
            ruins += 1
    means.sort()
    lo, hi = means[int(0.025 * BOOTSTRAP_N)], means[int(0.975 * BOOTSTRAP_N)]
    wins = sum(1 for p in pnls if p > 0)
    r_txt = f"  expR={exp_r:+.2f}R" if exp_r is not None else ""
    print(f"{label:<10} n={n:<4} WR={wins/n*100:5.1f}%  exp={exp:+7.3f}%  "
          f"IC95=[{lo:+6.3f},{hi:+6.3f}]{r_txt}  eq={eq:+8.1f}$  "
          f"maxDD={max_dd:7.1f}$  liq={liqs:<3} streak={worst_streak:<3} "
          f"ruin={ruins/BOOTSTRAP_N*100:5.1f}%  (jours={n_days})")
    return {"exp": exp, "exp_r": exp_r, "ci": (lo, hi), "eq": eq,
            "max_dd": max_dd, "liq": liqs, "streak": worst_streak,
            "ruin_pct": ruins / BOOTSTRAP_N}


def main():
    signals = load(sys.argv[1])
    candles_raw = load(sys.argv[2])
    candles = {}
    for c in candles_raw:
        candles.setdefault((c["symbol"], c["timeframe"]), []).append(c)

    eligible = [s for s in signals if venue(s["symbol"]) in ("FUTURES", "MARGIN")
                and (s["symbol"], s["timeframe"]) in candles]
    skipped = len(signals) - len(eligible)
    print(f"Signaux exportés : {len(signals)} — éligibles FUTURES+MARGIN avec bougies : "
          f"{len(eligible)} (skippés : {skipped})\n")

    def day_of(s):
        return (s["entry_ts"] or "")[:10]

    # Baseline ×1 avec le coût propre à chaque venue (CFD = spread,
    # pas de funding — corrige le biais taker+funding sur 92% de l'échantillon)
    spot_trades, reasons = [], {}
    for s in eligible:
        r = replay(s, candles[(s["symbol"], s["timeframe"])], 1)
        if r is None:
            continue
        # Venue-cost déjà dans r[0] ; à ×1 le funding perp ne s'applique
        # qu'aux FUTURES — déjà géré par COSTS[venue]. On retire juste
        # la part "holding" pour avoir l'équivalent spot pur.
        c = COSTS[venue(s["symbol"])]
        hold_frac = math.floor(r[2] / 8) * c["per_8h"] * 100
        spot_trades.append((r[0] + hold_frac, day_of(s), r[3]))
        reasons[r[1]] = reasons.get(r[1], 0) + 1
    print(f"Exits observés (chemin rejoué) : {reasons}\n")
    res = {"SPOT×1": metrics(spot_trades, "×1 net")}

    for L in LEVERAGES[1:]:
        trades = []
        reasons = {}
        for s in eligible:
            r = replay(s, candles[(s["symbol"], s["timeframe"])], L)
            if r is None:
                continue
            trades.append((r[0], day_of(s), r[3]))
            reasons[r[1]] = reasons.get(r[1], 0) + 1
        res[f"×{L}"] = metrics(trades, f"LEV×{L}")
        if L == LEVERAGES[-1]:
            print(f"  exits ×{L} : {reasons}")

    print("\n=== VERDICT ===")
    base = res.get("SPOT×1")
    for L in LEVERAGES[1:]:
        r = res.get(f"×{L}")
        if not r or not base:
            continue
        # Les IC se chevauchent → honnêtement indéterminé
        overlap = r["ci"][0] <= base["ci"][1] and base["ci"][0] <= r["ci"][1]
        verdict = ("AMÉLIORE" if r["exp"] > base["exp"] else "DÉGRADE") \
                  if not overlap else "INDÉTERMINÉ (IC chevauchants)"
        print(f"×{L} vs SPOT : {verdict} — exp {r['exp']:+.2f}% vs {base['exp']:+.2f}%, "
              f"liquidations {r['liq']}, ruin {r['ruin_pct']*100:.1f}%")

    # Gate B2 explicite (fixé avant résultat) :
    # go = espérance > 0 après coûts ET IC95% exclut 0, sur ≥30 signaux
    print("\n=== GATE B2 (fixé a priori : exp>0 après coûts, IC95>0, n≥30) ===")
    for k, r in res.items():
        if not r:
            continue
        go = r["exp"] > 0 and r["ci"][0] > 0 and len(eligible) >= 30
        print(f"{k:<10} {'GO' if go else 'NO-GO'} (exp {r['exp']:+.2f}%, IC {r['ci'][0]:+.2f})")


if __name__ == "__main__":
    main()
