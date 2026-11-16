# B1 — Mesures (non interprétées)

Reproduction : `python3 scripts/leverage_backtest.py signals.csv candles.csv`
(exports lecture seule des tables `signals`, `candles`).

Univers : 1061 signaux résolus exportés → 918 éligibles FUTURES+MARGIN avec
bougies → 783 trades rejoués, **31 jours distincts** (block bootstrap par jour).

## (0) Validation du benchmark

Chemin = première bougie **strictement postérieure** à l'horodatage d'entrée
(la bougie d'entrée contient du range pré-entrée → biais identifié : avant
correction l'écart théorie/mesure était de 12 pts).

| Mesure | Valeur |
|---|---|
| Théorie P(TP avant SL) = SL/(TP+SL), moyennée par signal | 56.8% |
| Aléatoire mesuré (tirages résolus, 50 par signal) | 57.5% |
| Écart | **0.7 pts** (< 5 → benchmark de prix validé) |
| Bougies ambiguës TP+SL (même bougie, hors entrée) | 2/783 (0.3%) |
| Encadrement ordre intrabar ×1 | pess. −0.466% / opt. −0.466% |
| Expirés : détecteur / aléatoire | 53.4% / 85.8% |

**⚠ Validation incomplète** : elle porte sur les ~14% de tirages résolus.
Voir (iv) — le prix d'entrée du signal ≠ close de bougie pour ~2/3 des
signaux, donc l'appariement n'est pas encore interprétable.

## (i) WR corrigé — sur les résolus uniquement

| Groupe | TP | SL | Expirés | WR résolus = TP/(TP+SL) |
|---|---|---|---|---|
| Détecteur | 59 | 304 | 416 | **16.3%** |
| Aléatoire apparié | 9.0% | 5.2% | 85.8% (des tirages) | **57.5%** (= théorie) |

## (a) Benchmark apparié (n=779, 50 tirages/signal, moyennés)

Même direction, mêmes distances TP/SL, même durée, même venue, mêmes bougies.

| Groupe | n | Espérance | IC95 | Esp. R |
|---|---|---|---|---|
| Détecteur | 779 | −0.463% | [−0.652, −0.325] | −0.56R |
| Aléatoire apparié | 779 | −0.025% | [−0.032, −0.020] | −0.06R |
| **Différence** | — | **−0.438%** | **[−0.623, −0.303]** | −0.50R |
| Variante direction 50/50 | 779 | −0.023% | [−0.031, −0.018] | −0.06R |
| Différence vs 50/50 | — | −0.441% | [−0.624, −0.306] | — |

IC95 : block bootstrap par jour, 31 jours. **Non interprétable** — voir (iv).

## (iii) Décomposition par type de sortie (×1, en R)

| Groupe | Exit | Part | R moyen | Contribution à l'espérance |
|---|---|---|---|---|
| Détecteur | TP | 59 (7.6%) | +0.52 | +0.040 |
| Détecteur | SL | 304 (39.0%) | −1.05 | −0.410 |
| Détecteur | EXPIRED | 416 (53.4%) | −0.36 | −0.194 |
| **Détecteur** | **TOTAL** | 779 | | **−0.565** |
| Aléatoire | TP | 9.0% | +0.46 | +0.042 |
| Aléatoire | SL | 5.2% | −1.08 | −0.056 |
| Aléatoire | EXPIRED | 85.8% | −0.06 | −0.048 |
| **Aléatoire** | **TOTAL** | 38837 tirages | | **−0.062** |

Valorisation d'un expiré : exit au close de la dernière bougie du path →
R = (move − coûts) / distance_SL. L'expiré du détecteur (−0.36R) est bien
pire que l'expiré aléatoire (−0.06R) — cohérent avec des signaux qui partent
souvent dans le rouge avant expiration.

## (ii) Concordance prod (execution_status) vs rejeu — discordance massive

| prod ↓ / rejeu → | EXPIRED | SL | TP | total |
|---|---|---|---|---|
| CLOSED_BREAKEVEN | 3 | 0 | 3 | 6 |
| CLOSED_LOSS | 47 | 4 | 4 | 55 |
| CLOSED_WIN | 67 | 32 | 27 | 126 |
| EXPIRED | 299 | 268 | 25 | 592 |

- 53% des `CLOSED_WIN` prod se rejouent EXPIRED/SL ; 45% des `EXPIRED` prod
  se rejouent SL.
- Hypothèse d'explication : la résolution prod tournait pendant que le
  cache bougies était cassé (1 bougie → EXPIRED en masse) ; les bougies ont
  été reconstituées après coup → le rejeu voit des touches SL que la prod
  n'a jamais vues.
- Conséquence : `execution_status` prod ≠ vérité terrain ; le rejeu sur
  bougies est la mesure la plus fiable des deux, sous réserve de (iv).

## (iv) Écart prix d'entrée signal vs close de la bougie d'entrée

| Mesure | Valeur |
|---|---|
| n | 753 |
| Médiane de l'écart (en × distance SL) | **0.665×SL** |
| p90 | 1.654×SL |
| Part des signaux avec écart > 0.5×SL | **69.3%** |

→ Pour les deux tiers des signaux, le `entryPrice` enregistré diffère du
prix des bougies de plus de la moitié du risque. Sources possibles : feed de
prix différent (Yahoo vs Oanda), timestamp de génération ≠ prix de clôture,
prix périmé. **Tant que cet écart n'est pas expliqué, la comparaison
détecteur vs aléatoire (qui entre au close de bougie) n'est pas appariée.**

## (v) Ventilation (a) par classe d'actif — l'univers n'est plus EUR/GBP

| Classe | n | Détect. R | Aléat. R | Diff. R | Détect. % | Aléat. % |
|---|---|---|---|---|---|---|
| commodité | 279 | −0.92 | −0.03 | −0.89 | −1.090% | −0.031% |
| forex | 483 | −0.37 | −0.08 | −0.29 | −0.094% | −0.018% |
| crypto | 17 | −0.23 | −0.03 | −0.20 | −0.690% | −0.122% *(n<30)* |

Les commodités (~36% des trades, surtout des expirés) portent la majeure
partie de la différence. Aucun IC global ne doit servir de verdict.

## (b) Coûts par venue (×1, en R, par poste)

| Venue | n | R brut | spread | swap | slippage | taker | funding | R net |
|---|---|---|---|---|---|---|---|---|
| MARGIN (CFD) | 762 | −0.51 | −0.06 | 0.00 | — | — | — | −0.57 |
| FUTURES | 21 | −0.19 | — | — | −0.01 | −0.02 | −0.00 | −0.22 *(n<30)* |
| SPOT | 0 | — | — | — | — | — | — | — |

- MARGIN : spread 0.02% A/R + swap 0.005%/jour. Taker/funding crypto non
  appliqués (sans objet sur CFD).
- FUTURES : taker 0.05%×2 + slippage 0.02%×2 + **funding = constante
  0.01%/8h** (pas de série historique).
- Les coûts représentent ~10% de la dégradation (R brut −0.51 → net −0.57) :
  **le problème est dans le brut et les expirés, pas les coûts.** Une table
  `asset_cost_profile` n'optimiserait que ~10% ; priorité = fusionner les
  constantes backtest/prod dans une config unique.

## Levier — mis de côté

C'est ×1 multiplié + coûts croissants : ×2 −0.93%, ×3 −1.40%, ×5 −2.33%
(ruin 97.8%), ×10 −4.66% (ruin 100%). N'apporte plus d'information.

## (c) Statuts BUY vs SELL — setups distincts

`signal_logs` (génération, n=3973) : les « ouverts » n'y sont pas des statuts
suivis — 1137/1141 BUY forex y sont aussi « ouverts » (résolution figée par
le bug bougies). Ne pas comparer les SELL à cette table.

Funnel SELL hors BRVM : **48 générés → 10 persistés → 2 résolus**.
Taux de résolution BUY ~17% → attendu sur 10 SELL ≈ 1.7 ≈ 2 observés.
**Le « manque de SELL résolus » est expliqué** — pas de biais de survie
mesurable à cette étape.

Reste vrai : le ratio passe de 4.4:1 (setups distincts) → 24:1 (signal_logs)
→ ~105:1 (signals persistés) → les SELL se perdent **entre génération et
persistance**, et les rejets gate ne sont pas persistés. Chantier réel :
persister chaque rejet avec sa raison.

| Étape | BUY | SELL | ratio |
|---|---|---|---|
| Setups distincts (scan_history) | 1161 | 263 | 4.4:1 |
| signal_logs | 3816 | 157 | 24:1 |
| signals persistés | ~1050 | ~10 | ~105:1 |
| Résolus | ~185 | ~2 | ~90:1 |

- SELL non-BRVM ouverts : XAU, XAG, WTI, BRENT, AUD/USD, EUR/USD, NZD/USD,
  V75 — couverture bougies absente (AUD/NZD/V75 = 0 bougie) ou trop courte
  (commodités depuis le 12 nov seulement).
- SELL sur BRVM (109) et actions = signaux de **sortie** (actifs non
  shortables) — comptés à part, non résolus comme shorts.

## (d) Couverture crypto

`signal_logs` Crypto : 46 BUY (10 TP, 5 SL, 1 expiré, 30 ouverts), **0 SELL**.
`signals` Crypto : 31 BUY (1 W, 1 L, 29 expirés), 0 SELL.

- Résolus crypto : **n ≈ 2–15** selon la table → **non concluant**.
- 0 SELL crypto généré sur toute la période.
- Rejeu offline (klines Binance 1h/4h, top 10-20 perps, 3-6 mois) : faisable,
  effort ~1 jour ; limites = pas de contexte dérivés >30 jours, pas de carnet
  historique, gate dérivés non rejouable. Non implémenté.

## Limites

- **31 jours distincts** = vrai n du bootstrap ; signaux 1h corrélés,
  n_effectif << 783.
- Pipeline partiellement cassé sur la période (cache bougies, throttling) ;
  `execution_status` prod en partie non fiable (voir concordance).
- **(a) non interprétable** : écart médian prix d'entrée = 0.665×SL (iv) ;
  la validation (0) ne couvre que les tirages résolus (~14%).
- Univers = forex + commodités + crypto, pas seulement EUR/GBP ; ~53% des
  trades rejoués sont des expirés (survivorship sur les persistés).
- **Aucune conclusion sur les cryptos (n < 30).**
- Rejets gate non persistés → non mesurables.
- Constantes de coûts dupliquées backtest/prod (à fusionner en config).
- Ce document rapporte des mesures, aucune conclusion « edge ».
