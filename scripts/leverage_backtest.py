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
TAKER_RT = 2 * 0.0005    # taker aller-retour (FUTURES/SPOT-like)
SLIP_RT = 2 * 0.0002     # slippage aller-retour
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


def asset_class(sym: str) -> str:
    b = sym.split("/")[0].upper()
    if b in CRYPTO:
        return "crypto"
    if b in ("XAU", "XAG", "WTI", "BRENT", "NG", "CL", "UKOIL", "USOIL"):
        return "commodité"
    if "/" in sym and len(b) == 3:
        return "forex"
    return "autre"


def ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "").split(".")[0]).timestamp()


def _ts_iso(t: float) -> str:
    return datetime.fromtimestamp(t).isoformat()


# Fiche instrument (docs/instrument_spec.md) : si un CSV instrument_profile
# est passé en 3e argument, les coûts viennent de la fiche — source unique,
# fini les constantes dupliquées backtest/prod.
_PROFILE_COSTS: dict = {}


def _load_profiles(path: str) -> None:
    for r in load(path):
        carry = float(r.get("carry_rate") or 0)
        per_8h = carry / 3.0 if r.get("carry_freq") == "daily" else carry
        _PROFILE_COSTS[r["symbol"]] = {
            "rt_frac": float(r.get("spread_rt") or 0)
                       + float(r.get("taker_rt") or 0)
                       + float(r.get("slippage_rt_obs") or 0),
            "per_8h": per_8h,
        }


def cost_for(symbol: str) -> dict:
    return _PROFILE_COSTS.get(symbol, COSTS[venue(symbol)])


def _tf_seconds(tf: str) -> int:
    """'1h'->3600, '4h'->14400, '15m'->900, '1d'->86400."""
    tf = (tf or "1h").lower()
    n = int(tf[:-1] or 1)
    return n * {"m": 60, "h": 3600, "d": 86400}[tf[-1]]


def load(path):
    with open(path) as f:
        return list(csv.DictReader(f))


def liq_distance(leverage: float) -> float:
    return max(0.0, 1.0 / leverage - MM_BUFFER)


def replay(sig, candles, L, order="pessimistic"):
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
    # La bougie d'entrée (open_time == t_entry) contient du range AVANT le
    # moment d'entrée → SL/TP "touchés" avant que la position existe. On
    # n'évalue que les bougies strictement postérieures ; la bougie
    # d'entrée est rapportée à part (ambiguous_entry).
    path = [c for c in candles
            if ts(c["open_time"]) > t_entry and ts(c["open_time"]) <= t_end]
    entry_candle = next((c for c in candles if ts(c["open_time"]) == t_entry), None)
    # Bougie d'entrée : son range inclut l'avant-entrée. Si un seul des deux
    # niveaux est touché → exit indiscutable (l'hypothèse d'ordre ne change
    # rien). Si les DEUX sont touchés → ordre intrabar décide (pessimiste=SL,
    # optimiste=TP). Sinon → path normal.
    if entry_candle:
        hi0, lo0 = float(entry_candle["high"]), float(entry_candle["low"])
        hit_sl0 = (lo0 <= sl if long_ else hi0 >= sl) if sl else False
        hit_tp0 = (hi0 >= tp if long_ else lo0 <= tp) if tp else False
        if hit_sl0 and hit_tp0:
            first = "SL" if order == "pessimistic" else "TP"
            return _close_trade(entry, sl if first == "SL" else tp, first,
                                long_, sig, t_entry, L, sl)
        elif hit_sl0:
            return _close_trade(entry, sl, "SL", long_, sig, t_entry, L, sl)
        elif hit_tp0:
            return _close_trade(entry, tp, "TP", long_, sig, t_entry, L, sl)
    if not path:
        return None

    exit_px = None
    reason = None
    ambiguous = 0
    for c in path:
        hi, lo = float(c["high"]), float(c["low"])
        # Bougie ambiguë : TP ET SL touchés dans la même bougie → l'ordre
        # intrabar choisi décide du résultat. Sur TP 0.15%/SL 0.25% 1h,
        # c'est fréquent → on borne avec les deux hypothèses.
        hit_sl = (lo <= sl if long_ else hi >= sl) if sl else False
        hit_tp = (hi >= tp if long_ else lo <= tp) if tp else False
        if hit_sl and hit_tp:
            ambiguous += 1
            if order == "optimistic":
                hit_sl = False  # hypothèse favorable : TP touché d'abord
        if long_:
            if lo <= liq_px and order == "pessimistic":
                exit_px, reason = liq_px, "LIQUIDATED"
            elif hit_sl:
                exit_px, reason = sl, "SL"
            elif hit_tp:
                exit_px, reason = tp, "TP"
        else:
            if hi >= liq_px and order == "pessimistic":
                exit_px, reason = liq_px, "LIQUIDATED"
            elif hit_sl:
                exit_px, reason = sl, "SL"
            elif hit_tp:
                exit_px, reason = tp, "TP"
        if reason:
            break
    if not reason:
        exit_px, reason = float(path[-1]["close"]), "EXPIRED"
    return _close_trade(entry, exit_px, reason, long_, sig,
                        ts(path[-1]["open_time"]), L, sl, ambiguous)


def _close_trade(entry, exit_px, reason, long_, sig, t_end, L, sl, ambiguous=0):
    """PnL net % marge + R multiple + durée, coûts par venue."""
    move = (exit_px - entry) / entry if long_ else (entry - exit_px) / entry
    dur_h = max(0.0, (t_end - ts(sig["entry_ts"])) / 3600.0)
    c = cost_for(sig["symbol"])
    fees = c["rt_frac"] * L * 100
    holding = math.floor(dur_h / 8) * c["per_8h"] * L * 100
    sl_dist = abs(entry - sl) / entry if sl else None
    d = liq_distance(L)
    r_mult = None
    if sl_dist and sl_dist > 0:
        net_frac = move - c["rt_frac"] - math.floor(dur_h / 8) * c["per_8h"]
        if reason == "LIQUIDATED":
            net_frac = -d
        r_mult = net_frac / sl_dist
    if reason == "LIQUIDATED":
        return (-100.0 - fees - holding, reason, dur_h, r_mult, ambiguous)
    return (move * L * 100 - fees - holding, reason, dur_h, r_mult, ambiguous)


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
    # WR correct : TP/(TP+SL) parmi les RÉSOLUS uniquement (les expirés
    # n'ont pas de win/loss). trades = (pnl, day, r, reason).
    res_tp = sum(1 for t in trades if t[3] == "TP") if len(trades[0]) > 3 else None
    res_sl = sum(1 for t in trades if t[3] == "SL") if len(trades[0]) > 3 else None
    res_exp = sum(1 for t in trades if t[3] == "EXPIRED") if len(trades[0]) > 3 else None
    if res_tp is not None and (res_tp + res_sl) > 0:
        wr_res = res_tp / (res_tp + res_sl) * 100
        wr_txt = (f"  WR résolus={wr_res:5.1f}% (TP={res_tp} SL={res_sl} "
                  f"exp={res_exp})")
    else:
        wr_txt = f"  wins={sum(1 for p in pnls if p > 0)}"
    r_txt = f"  expR={exp_r:+.2f}R" if exp_r is not None else ""
    print(f"{label:<10} n={n:<4} exp={exp:+7.3f}%  "
          f"IC95=[{lo:+6.3f},{hi:+6.3f}]{r_txt}{wr_txt}  eq={eq:+8.1f}$  "
          f"maxDD={max_dd:7.1f}$  liq={liqs:<3} streak={worst_streak:<3} "
          f"ruin={ruins/BOOTSTRAP_N*100:5.1f}%  (jours={n_days})")
    return {"exp": exp, "exp_r": exp_r, "ci": (lo, hi), "eq": eq,
            "max_dd": max_dd, "liq": liqs, "streak": worst_streak,
            "ruin_pct": ruins / BOOTSTRAP_N}


def main():
    signals = load(sys.argv[1])
    candles_raw = load(sys.argv[2])
    if len(sys.argv) > 3:
        _load_profiles(sys.argv[3])
        print(f"instrument_profile chargé : {len(_PROFILE_COSTS)} symboles")
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
    n_ambiguous = 0
    for s in eligible:
        r = replay(s, candles[(s["symbol"], s["timeframe"])], 1)
        if r is None:
            continue
        c = cost_for(s["symbol"])
        hold_frac = math.floor(r[2] / 8) * c["per_8h"] * 100
        spot_trades.append((r[0] + hold_frac, day_of(s), r[3], r[1]))
        reasons[r[1]] = reasons.get(r[1], 0) + 1
        if r[4] > 0:
            n_ambiguous += 1
    print(f"Exits observés (chemin rejoué) : {reasons}")
    print(f"Bougies ambiguës TP+SL : {n_ambiguous}/{len(spot_trades)} trades "
          f"({n_ambiguous/max(len(spot_trades),1)*100:.0f}%) — l'ordre intrabar "
          f"pèse directement sur le verdict\n")

    # Encadrement : hypothèse optimiste (TP avant SL quand les deux sont
    # touchés) vs pessimiste. Si les deux bornes donnent le même signe,
    # le verdict est robuste à l'ordre intrabar.
    opt_trades = []
    for s in eligible:
        r = replay(s, candles[(s["symbol"], s["timeframe"])], 1, order="optimistic")
        if r is None:
            continue
        c = cost_for(s["symbol"])
        hold_frac = math.floor(r[2] / 8) * c["per_8h"] * 100
        opt_trades.append((r[0] + hold_frac, day_of(s), r[3], r[1]))
    print("=== ENCADREMENT ORDRE INTRABAR (×1) ===")
    res_pess = metrics(spot_trades, "×1 pess.")
    res_opt = metrics(opt_trades, "×1 opt.")

    # (a) BENCHMARK APPARIÉ : par signal, N_DRAWS entrées aléatoires —
    # MÊME direction (99% BUY), mêmes distances TP/SL, même durée
    # d'expiration, même venue/coûts, mêmes bougies. Moyenné par signal
    # → différence détecteur − aléatoire, IC95% block bootstrap par jour.
    N_DRAWS = 50
    rng = random.Random(7)

    def _random_draw(s, cs):
        """Tire une entrée aléatoire appariée au signal s sur cs."""
        i = rng.randrange(0, len(cs) - 1)
        new_entry = float(cs[i]["close"])
        old_entry = float(s["entryPrice"] or 0)
        long_ = s["signal"] == "BUY"
        fake = dict(s)
        if old_entry and s["stopLoss"]:
            sl_d = abs(float(s["stopLoss"]) - old_entry)
            fake["stopLoss"] = str(new_entry - sl_d if long_ else new_entry + sl_d)
        if old_entry and s["takeProfit1"]:
            tp_d = abs(float(s["takeProfit1"]) - old_entry)
            fake["takeProfit1"] = str(new_entry + tp_d if long_ else new_entry - tp_d)
        fake["entryPrice"] = str(new_entry)
        fake["entry_ts"] = cs[i]["open_time"]
        dur = ts(s["end_ts"] or s["entry_ts"]) - ts(s["entry_ts"])
        fake["end_ts"] = cs[min(i + 100, len(cs) - 1)]["open_time"] \
            if dur <= 0 else _ts_iso(ts(fake["entry_ts"]) + dur)
        # borne au-delà des bougies disponibles → clamp
        if ts(fake["end_ts"]) > ts(cs[-1]["open_time"]):
            fake["end_ts"] = cs[-1]["open_time"]
        return replay(fake, cs, 1)

    det_by_sig, rand_by_sig, rand_dir_by_sig = {}, {}, {}
    theory_list, expired_stats = [], []
    for s in eligible:
        cs = candles[(s["symbol"], s["timeframe"])]
        if len(cs) < 10:
            continue
        r_det = replay(s, cs, 1)
        if r_det is None:
            continue
        # draws appariés : même direction
        rs = [r for r in (_random_draw(s, cs) for _ in range(N_DRAWS)) if r]
        if not rs:
            continue
        det_by_sig[s["id"]] = (r_det, day_of(s))
        tp_f = sum(1 for r in rs if r[1] == "TP") / len(rs)
        sl_f = sum(1 for r in rs if r[1] == "SL") / len(rs)
        rand_by_sig[s["id"]] = (sum(r[0] for r in rs) / len(rs),
                                sum(r[3] or 0 for r in rs) / len(rs), day_of(s),
                                tp_f, sl_f, rs)
        # (0) validation : théorie marche aléatoire vs mesure, sur tirages
        # résolus uniquement (TP/SL — les expirés n'ont pas de WR défini)
        tp_d = abs(float(s["takeProfit1"] or 0) - float(s["entryPrice"])) \
            if s["takeProfit1"] else 0
        sl_d = abs(float(s["stopLoss"] or 0) - float(s["entryPrice"])) \
            if s["stopLoss"] else 0
        resolved_draws = [r for r in rs if r[1] in ("TP", "SL")]
        if tp_d > 0 and sl_d > 0 and resolved_draws:
            p_theory = sl_d / (tp_d + sl_d)
            n_tp = sum(1 for r in resolved_draws if r[1] == "TP")
            theory_list.append((p_theory, n_tp / len(resolved_draws)))
        det_exp = 1 if r_det[1] == "EXPIRED" else 0
        rand_exp = sum(1 for r in rs if r[1] == "EXPIRED") / len(rs)
        expired_stats.append((det_exp, rand_exp))
        # variante 50/50 : direction tirée au hasard → isole le biais BUY
        rs50 = []
        for _ in range(N_DRAWS):
            f = dict(s); f["signal"] = rng.choice(["BUY", "SELL"])
            r = _random_draw(f, cs)
            if r:
                rs50.append(r)
        if rs50:
            rand_dir_by_sig[s["id"]] = (sum(r[0] for r in rs50) / len(rs50),
                                        sum(r[3] or 0 for r in rs50) / len(rs50), day_of(s))

    def _paired_table(det, rand, label):
        diffs = [(det[k][0][0] - rand[k][0], det[k][1]) for k in det if k in rand]
        print(f"\n=== {label} (n={len(diffs)} signaux) ===")
        metrics([(det[k][0][0], det[k][1], det[k][0][3], det[k][0][1])
                 for k in det], "DÉTECT.")
        metrics([(rand[k][0], rand[k][2], rand[k][1], "")
                 for k in det if k in rand], "ALÉAT.")
        # WR résolus aléatoire : moyenne des fractions TP/(TP+SL) par signal
        wr_rand = [rand[k][3] / (rand[k][3] + rand[k][4])
                   for k in det if k in rand and len(rand[k]) > 4
                   and rand[k][3] + rand[k][4] > 0]
        if wr_rand:
            print(f"  ALÉAT. WR résolus (TP/(TP+SL)) : "
                  f"{sum(wr_rand)/len(wr_rand)*100:.1f}%")
        det_r = [det[k][0][3] for k in det if det[k][0][3] is not None]
        rand_r = [rand[k][1] for k in det if k in rand and det[k][0][3] is not None]
        # différence appariée — block bootstrap par jour
        days = {}
        for i, (_, d) in enumerate(diffs):
            days.setdefault(d, []).append(i)
        day_list = list(days.values())
        rng2 = random.Random(42)
        means = []
        for _ in range(BOOTSTRAP_N):
            idx = [i for day in rng2.choices(day_list, k=len(day_list)) for i in day]
            means.append(sum(diffs[i][0] for i in idx) / len(idx))
        means.sort()
        d_exp = sum(x[0] for x in diffs) / len(diffs)
        lo, hi = means[int(.025 * BOOTSTRAP_N)], means[int(.975 * BOOTSTRAP_N)]
        dr = sum(det_r) / len(det_r) if det_r else 0
        ar = sum(rand_r) / len(rand_r) if rand_r else 0
        print(f"  différence détect−aléat : {d_exp:+.3f}% IC95[{lo:+.3f},{hi:+.3f}] "
              f"(jours={len(day_list)})  |  R brut : détect {dr:+.2f}R vs aléat {ar:+.2f}R")

    # (0) VALIDATION DU BENCHMARK : WR aléatoire mesuré vs théorie
    # SL/(TP+SL), signal par signal puis moyennée — sur tirages résolus.
    if theory_list:
        t_th = sum(p for p, _ in theory_list) / len(theory_list)
        t_me = sum(m for _, m in theory_list) / len(theory_list)
        gap = abs(t_me - t_th) * 100
        print(f"=== (0) VALIDATION BENCHMARK ===")
        print(f"  théorie moyenne P(TP avant SL) : {t_th*100:.1f}%  |  "
              f"aléatoire mesuré (tirages résolus) : {t_me*100:.1f}%  "
              f"→ écart {gap:.1f} pts (n={len(theory_list)} signaux ×{N_DRAWS})")
        if gap > 5:
            print("  ⚠ écart >5 pts — causes testées : bougie d'entrée exclue ✓, "
                  "spread inclus ✓ ; résiduel probable = volatilité réelle "
                  "≠ marche aléatoire iid + horizon tronqué par expiration")
    if expired_stats:
        de = sum(x for x, _ in expired_stats) / len(expired_stats)
        re = sum(x for _, x in expired_stats) / len(expired_stats)
        print(f"  expirés : détecteur {de*100:.1f}%  vs  aléatoire {re*100:.1f}%\n")

    _paired_table(det_by_sig, rand_by_sig, "APPARIÉ (même direction, mêmes TP/SL/durée/coûts)")
    _paired_table(det_by_sig, rand_dir_by_sig, "VARIANTE direction 50/50")

    # (iii) DÉCOMPOSITION PAR TYPE DE SORTIE — l'essentiel de l'écart se
    # joue dans les expirés (53% détect. vs 86% aléat.), il faut voir
    # comment chaque exit contribue à l'espérance.
    print("\n=== DÉCOMPOSITION PAR TYPE DE SORTIE (×1, en R) ===")
    print(f"{'groupe':10} {'exit':9} {'n/part':>8} {'R moyen':>9} {'contrib.':>9}")
    for label, get_trades in (
        ("DÉTECT.", lambda k: [(det_by_sig[k][0][1], det_by_sig[k][0][3])]),
        ("ALÉAT.",  lambda k: [(r[1], r[3]) for r in rand_by_sig[k][5]]),
    ):
        agg = {}
        tot = 0
        for k in det_by_sig:
            if label == "ALÉAT." and k not in rand_by_sig:
                continue
            for reason, r_val in get_trades(k):
                agg.setdefault(reason, []).append(r_val or 0)
                tot += 1
        exp_total = sum(sum(v) for v in agg.values()) / max(tot, 1)
        for reason in ("TP", "SL", "EXPIRED", "LIQUIDATED"):
            if reason not in agg:
                continue
            v = agg[reason]
            part = len(v) / tot
            contrib = sum(v) / tot
            print(f"{label:10} {reason:9} {len(v):>4}({part*100:4.1f}%) "
                  f"{sum(v)/len(v):>9.2f} {contrib:>9.3f}")
        print(f"{label:10} {'TOTAL':9} {tot:>8} {'':>9} {exp_total:>9.3f}")

    # (ii) CONCORDANCE prod vs rejeu — la table signals dit ~68% de winners
    # résolus, le rejeu ~30% : croiser les deux statuts signal par signal.
    print("\n=== CONCORDANCE prod (execution_status) vs rejeu ===")
    xtab = {}
    for s in eligible:
        k = s["id"]
        if k not in det_by_sig:
            continue
        prod = s["execution_status"]
        replayed = det_by_sig[k][0][1]
        xtab.setdefault(prod, {})
        xtab[prod][replayed] = xtab[prod].get(replayed, 0) + 1
    replayed_set = sorted({r for v in xtab.values() for r in v})
    print(f"{'prod':18}" + "".join(f"{r:>11}" for r in replayed_set) + f"{'total':>8}")
    for prod, v in sorted(xtab.items()):
        print(f"{prod:18}" + "".join(f"{v.get(r,0):>11}" for r in replayed_set)
              + f"{sum(v.values()):>8}")

    # (iv) ÉCART PRIX D'ENTRÉE — le détecteur entre au prix du signal,
    # l'aléatoire au close de bougie. Si les deux sources diffèrent,
    # TP/SL sont décalés. Mesure : |entryPrice − close(bougie entrée)|
    # en unités de distance SL.
    print("\n=== ÉCART entryPrice signal vs close bougie d'entrée (en ×SL) ===")
    gaps = []
    for s in eligible:
        k = s["id"]
        if k not in det_by_sig:
            continue
        cs = candles[(s["symbol"], s["timeframe"])]
        t_e = ts(s["entry_ts"])
        tf_s = _tf_seconds(s["timeframe"])
        ec = next((c for c in cs
                   if ts(c["open_time"]) <= t_e < ts(c["open_time"]) + tf_s), None)
        if not ec:
            continue
        e, sl_ = float(s["entryPrice"]), float(s["stopLoss"] or 0)
        sd = abs(e - sl_) / e if sl_ else 0
        if sd <= 0:
            continue
        gaps.append(abs(e - float(ec["close"])) / e / sd)
    if gaps:
        gaps.sort()
        med = gaps[len(gaps)//2]
        p90 = gaps[int(len(gaps)*0.9)]
        over = sum(1 for g in gaps if g > 0.5)
        print(f"  n={len(gaps)}  médiane={med:.3f}×SL  p90={p90:.3f}×SL  "
              f">0.5×SL={over} ({over/len(gaps)*100:.1f}%)")

    # (iv-bis) Écart SIGNÉ par rapport à la direction : pour un BUY,
    # entryPrice > close ⇒ l'entrée est plus HAUTE que le chemin ⇒ SL plus
    # proche mécaniquement. adverse = + (défavorable), par classe.
    print("\n=== ÉCART SIGNÉ (adverse = entrée au-dessus du close pour BUY) ===")
    print(f"{'classe':10} {'n':>4} {'médiane×SL':>11} {'part adverse':>13}")
    by_class = {}
    for s in eligible:
        k = s["id"]
        if k not in det_by_sig:
            continue
        cs = candles[(s["symbol"], s["timeframe"])]
        t_e = ts(s["entry_ts"])
        tf_s = _tf_seconds(s["timeframe"])
        ec = next((c for c in cs
                   if ts(c["open_time"]) <= t_e < ts(c["open_time"]) + tf_s), None)
        if not ec:
            continue
        e, sl_ = float(s["entryPrice"]), float(s["stopLoss"] or 0)
        sd = abs(e - sl_) / e if sl_ else 0
        if sd <= 0:
            continue
        long_ = s["signal"] == "BUY"
        signed = (e - float(ec["close"])) / e / sd
        adverse = signed if long_ else -signed
        by_class.setdefault(asset_class(s["symbol"]), []).append(adverse)
    for cl, vals in sorted(by_class.items()):
        vals.sort()
        adv = sum(1 for v in vals if v > 0)
        print(f"{cl:10} {len(vals):>4} {vals[len(vals)//2]:>11.3f} "
              f"{adv/len(vals)*100:>12.1f}%")

    # (iv-ter) REJEU REBASÉ : le détecteur entre au CLOSE de la bougie
    # d'entrée, avec les MÊMES distances TP/SL (comme l'aléatoire). Si le
    # WR résolus remonte vers ~50%, l'écart de feed explique le "pire que
    # le hasard".
    print("\n=== REJEU REBASÉ (entry = close bougie, distances conservées) ===")
    rebase_stats = []
    for s in eligible:
        k = s["id"]
        if k not in det_by_sig:
            continue
        cs = candles[(s["symbol"], s["timeframe"])]
        t_e = ts(s["entry_ts"])
        tf_s = _tf_seconds(s["timeframe"])
        ec = next((c for c in cs
                   if ts(c["open_time"]) <= t_e < ts(c["open_time"]) + tf_s), None)
        if not ec:
            continue
        e0 = float(s["entryPrice"])
        new_e = float(ec["close"])
        long_ = s["signal"] == "BUY"
        f = dict(s)
        if s["stopLoss"]:
            d_sl = abs(float(s["stopLoss"]) - e0)
            f["stopLoss"] = str(new_e - d_sl if long_ else new_e + d_sl)
        if s["takeProfit1"]:
            d_tp = abs(float(s["takeProfit1"]) - e0)
            f["takeProfit1"] = str(new_e + d_tp if long_ else new_e - d_tp)
        f["entryPrice"] = str(new_e)
        r = replay(f, cs, 1)
        if r:
            c = cost_for(s["symbol"])
            rebase_stats.append((r[0] + math.floor(r[2]/8)*c["per_8h"]*100,
                                 day_of(s), r[3], r[1], s["execution_status"]))
    metrics([(t[0], t[1], t[2], t[3]) for t in rebase_stats], "REBASÉ")
    # concordance rebasée
    xtab2 = {}
    for t in rebase_stats:
        prod, replayed = t[4], t[3]
        xtab2.setdefault(prod, {})
        xtab2[prod][replayed] = xtab2[prod].get(replayed, 0) + 1
    rset = sorted({r for v in xtab2.values() for r in v})
    print("  concordance rebasée :")
    print(f"  {'prod':18}" + "".join(f"{r:>11}" for r in rset) + f"{'total':>8}")
    for prod, v in sorted(xtab2.items()):
        print(f"  {prod:18}" + "".join(f"{v.get(r,0):>11}" for r in rset)
              + f"{sum(v.values()):>8}")

    # (v) VENTILATION PAR CLASSE — l'univers n'est plus EUR/GBP : ~500
    # expirés commodités. Pas d'IC global comme verdict.
    print("\n=== VENTILATION (a) PAR CLASSE D'ACTIF ===")
    print(f"{'classe':10} {'n':>4} {'détect R':>9} {'aléat R':>9} {'diff R':>8} "
          f"{'détect %':>9} {'aléat %':>8}")
    classes = {}
    for s in eligible:
        k = s["id"]
        if k in det_by_sig and k in rand_by_sig:
            classes.setdefault(asset_class(s["symbol"]), []).append(k)
    for cl, ks in sorted(classes.items()):
        n = len(ks)
        dr = sum(det_by_sig[k][0][3] or 0 for k in ks) / n
        ar = sum(rand_by_sig[k][1] for k in ks) / n
        dp = sum(det_by_sig[k][0][0] for k in ks) / n
        ap = sum(rand_by_sig[k][0] for k in ks) / n
        flag = " (n<30)" if n < 30 else ""
        print(f"{cl:10} {n:>4} {dr:>9.2f} {ar:>9.2f} {dr-ar:>8.2f} "
              f"{dp:>9.3f} {ap:>8.3f}{flag}")

    # (b) COÛTS PAR VENUE — décomposition en R, poste par poste.
    # MARGIN/CFD : spread + swap (pas de taker/funding). FUTURES : taker +
    # slippage + funding(constante 0.01%/8h — pas de série historique).
    print("\n=== COÛTS PAR VENUE (×1, par poste, en R) ===")
    print(f"{'venue':8} {'n':>4} {'R brut':>8} {'spread':>7} {'swap':>7} "
          f"{'slippage':>9} {'taker':>7} {'funding':>8} {'R net':>8}")
    for v in ("MARGIN", "FUTURES", "SPOT"):
        rows = []
        for s in eligible:
            if venue(s["symbol"]) != v:
                continue
            r = replay(s, candles[(s["symbol"], s["timeframe"])], 1)
            if r is None or r[3] is None:
                continue
            e, sl_ = float(s["entryPrice"]), float(s["stopLoss"] or 0)
            sd = abs(e - sl_) / e if sl_ else 0
            if sd <= 0:
                continue
            c = COSTS[v]  # décomposition par poste, niveau venue
            dur_f = r[2]
            gross_r = (r[0] + math.floor(dur_f / 8) * c["per_8h"] * 100
                       + c["rt_frac"] * 100) / (sd * 100)  # R avant tout coût
            comp = {"spread": 0.0, "swap": 0.0, "slippage": 0.0,
                    "taker": 0.0, "funding": 0.0}
            if v == "MARGIN":
                comp["spread"] = c["rt_frac"] / sd  # spread payé à l'entrée ≈ rt_frac
                comp["swap"] = math.floor(dur_f / 8) * c["per_8h"] / sd
            elif v == "FUTURES":
                comp["taker"] = TAKER_RT / sd
                comp["slippage"] = SLIP_RT / sd
                comp["funding"] = math.floor(dur_f / 8) * c["per_8h"] / sd
            else:  # SPOT : taker seul
                comp["taker"] = c["rt_frac"] / sd
            rows.append((gross_r, comp, r[3]))
        if not rows:
            print(f"{v:8}    0 —")
            continue
        n = len(rows)
        g = sum(r[0] for r in rows) / n
        comps = {k: sum(r[1][k] for r in rows) / n for k in
                 ("spread", "swap", "slippage", "taker", "funding")}
        net = sum(r[2] for r in rows) / n
        flag = "  (non concluant, n<30)" if n < 30 else ""
        print(f"{v:8} {n:>4} {g:>8.2f} {comps['spread']:>7.2f} {comps['swap']:>7.2f} "
              f"{comps['slippage']:>9.2f} {comps['taker']:>7.2f} {comps['funding']:>8.2f} "
              f"{net:>8.2f}{flag}")
    print("  MARGIN : funding N/A sur CFD (swap à la place) — source funding\n"
          "  FUTURES = constante 0.01%/8h, pas de série historique appliquée.\n")

    res = {"SPOT×1": res_pess}

    for L in LEVERAGES[1:]:
        trades = []
        reasons = {}
        for s in eligible:
            r = replay(s, candles[(s["symbol"], s["timeframe"])], L)
            if r is None:
                continue
            trades.append((r[0], day_of(s), r[3], r[1]))
            reasons[r[1]] = reasons.get(r[1], 0) + 1
        res[f"×{L}"] = metrics(trades, f"LEV×{L}")
        # verdict overlap handled below via res
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
