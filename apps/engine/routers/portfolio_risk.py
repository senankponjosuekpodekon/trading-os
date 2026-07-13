"""
Risque portefeuille — clustering et exposition par groupe d'actifs corrélés.
Évite d'afficher N signaux corrélés comme s'ils étaient indépendants.
"""
from typing import Optional

# Clusters de corrélation — actifs fortement corrélés entre eux
ASSET_CLUSTERS: dict[str, str] = {
    # Crypto majors (corrélation ~0.85+ en marché directionnel)
    "BTC/USDT":   "CRYPTO_MAJOR",
    "ETH/USDT":   "CRYPTO_MAJOR",
    "SOL/USDT":   "CRYPTO_MAJOR",
    "BNB/USDT":   "CRYPTO_MAJOR",
    "AVAX/USDT":  "CRYPTO_MAJOR",
    "ADA/USDT":   "CRYPTO_MAJOR",
    "XRP/USDT":   "CRYPTO_MAJOR",
    "LINK/USDT":  "CRYPTO_MAJOR",
    "DOT/USDT":   "CRYPTO_MAJOR",
    "MATIC/USDT": "CRYPTO_MAJOR",
    "ATOM/USDT":  "CRYPTO_MAJOR",
    "LTC/USDT":   "CRYPTO_MAJOR",
    # Forex majors
    "EUR/USD":    "FOREX",
    "EUR/USDT":   "FOREX",
    "GBP/USD":    "FOREX",
    "GBP/USDT":   "FOREX",
    "USD/JPY":    "FOREX",
    # Métaux précieux
    "XAU/USD":    "METALS",
    "PAXG/USDT":  "METALS",
    "WTI/USD":    "COMMODITIES",
}

# Seuil d'alerte : à partir de N signaux dans le même cluster + même direction
CLUSTER_ALERT_THRESHOLD = 3

CLUSTER_LABELS: dict[str, str] = {
    "CRYPTO_MAJOR": "Crypto majors",
    "FOREX":        "Forex",
    "METALS":       "Métaux précieux",
    "COMMODITIES":  "Matières premières",
    "BRVM":         "BRVM",
}


def get_cluster(symbol: str) -> str:
    if symbol in ASSET_CLUSTERS:
        return ASSET_CLUSTERS[symbol]
    # Fallback BRVM
    return "BRVM"


def analyze_portfolio_risk(results: list[dict]) -> dict:
    """
    Analyse les signaux actifs (BUY/SELL) et produit un rapport de risque portefeuille.
    Retourne :
    - clusters : dict par cluster avec nb de BUY/SELL et liste des symboles
    - alerts   : liste des alertes de concentration
    - summary  : résumé global
    """
    active = [r for r in results if r.get("signal") in ("BUY", "SELL")]

    # Agréger par cluster
    clusters: dict[str, dict] = {}
    for r in active:
        cluster = get_cluster(r["symbol"])
        sig = r["signal"]
        if cluster not in clusters:
            clusters[cluster] = {
                "label":   CLUSTER_LABELS.get(cluster, cluster),
                "buy":     [],
                "sell":    [],
                "total":   0,
            }
        clusters[cluster][sig.lower()].append({
            "symbol":     r["symbol"],
            "confidence": r.get("confidence", 0),
            "signal":     sig,
        })
        clusters[cluster]["total"] += 1

    # Générer les alertes
    alerts: list[dict] = []
    for cluster_key, data in clusters.items():
        n_buy  = len(data["buy"])
        n_sell = len(data["sell"])

        if n_buy >= CLUSTER_ALERT_THRESHOLD:
            alerts.append({
                "cluster":   cluster_key,
                "label":     data["label"],
                "direction": "BUY",
                "count":     n_buy,
                "symbols":   [x["symbol"] for x in data["buy"]],
                "severity":  "HIGH" if n_buy >= 5 else "MEDIUM",
                "message":   (
                    f"{n_buy} signaux BUY simultanés sur {data['label']} — "
                    f"exposition concentrée, ce n'est pas {n_buy} paris indépendants."
                ),
            })

        if n_sell >= CLUSTER_ALERT_THRESHOLD:
            alerts.append({
                "cluster":   cluster_key,
                "label":     data["label"],
                "direction": "SELL",
                "count":     n_sell,
                "symbols":   [x["symbol"] for x in data["sell"]],
                "severity":  "HIGH" if n_sell >= 5 else "MEDIUM",
                "message":   (
                    f"{n_sell} signaux SELL simultanés sur {data['label']} — "
                    f"exposition concentrée short."
                ),
            })

        # Signaux mixtes (BUY + SELL dans le même cluster = contradiction)
        if n_buy >= 1 and n_sell >= 1:
            alerts.append({
                "cluster":   cluster_key,
                "label":     data["label"],
                "direction": "MIXED",
                "count":     n_buy + n_sell,
                "symbols":   [x["symbol"] for x in data["buy"] + data["sell"]],
                "severity":  "LOW",
                "message":   (
                    f"Signaux mixtes sur {data['label']} "
                    f"({n_buy} BUY / {n_sell} SELL) — actifs corrélés en contradiction."
                ),
            })

    # Résumé global
    total_active = len(active)
    n_buy_total  = sum(len(d["buy"])  for d in clusters.values())
    n_sell_total = sum(len(d["sell"]) for d in clusters.values())
    dominant_dir = "BUY" if n_buy_total > n_sell_total else ("SELL" if n_sell_total > n_buy_total else "MIXED")

    risk_level = "LOW"
    if any(a["severity"] == "HIGH" for a in alerts):
        risk_level = "HIGH"
    elif alerts:
        risk_level = "MEDIUM"

    return {
        "clusters":       clusters,
        "alerts":         alerts,
        "risk_level":     risk_level,
        "total_active":   total_active,
        "total_buy":      n_buy_total,
        "total_sell":     n_sell_total,
        "dominant_dir":   dominant_dir,
        "summary": (
            f"{total_active} signaux actifs · "
            f"{n_buy_total} BUY / {n_sell_total} SELL · "
            f"Risque {risk_level}"
            + (f" · {len(alerts)} alerte(s)" if alerts else "")
        ),
    }
