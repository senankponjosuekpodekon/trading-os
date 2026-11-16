# B1 — Mesures (non interprétées)

Reproduction : `python3 scripts/leverage_backtest.py signals.csv candles.csv`
(exports lecture seule des tables `signals`, `candles`).

Univers : 1061 signaux résolus exportés → 918 éligibles FUTURES+MARGIN avec
bougies → 783 trades rejoués, **31 jours distincts** (block bootstrap par jour).

## (0) Validation du benchmark

Biais corrigé : le chemin démarre désormais sur la **première bougie
strictement postérieure à l'horodatage d'entrée**. La bougie d'entrée ne
compte que si elle résout seule (exit immédiat) ; un toucher des deux niveaux
sur cette bougie suit l'hypothèse d'ordre testée.

| Mesure | Valeur |
|---|---|
| Théorie P(TP avant SL) = SL/(TP+SL), moyennée par signal | 56.8% |
| Aléatoire mesuré (tirages résolus, 50 par signal) | 57.5% |
| Écart | **0.7 pts** (< 5 → validé) |
| Bougies ambiguës TP+SL (même bougie, hors entrée) | 2/783 (0.3%) |
| Encadrement ordre intrabar ×1 | pess. −0.466% / opt. −0.466% |

Avant correction : théorie 60.8% vs mesure 48.9% (écart 12 pts, bougie
d'entrée incluse — cause identifiée du biais).

## (a) Benchmark apparié (n=779 signaux, 50 tirages/signal, moyennés)

Même direction, mêmes distances TP/SL, même durée d'expiration, même venue,
mêmes bougies, mêmes coûts.

| Groupe | n | WR | Espérance | IC95 | Esp. R | Expirés |
|---|---|---|---|---|---|---|
| Détecteur | 779 | 14.1% | −0.463% | [−0.652, −0.325] | −0.56R | 53.4% |
| Aléatoire apparié | 779 | 14.1% | −0.025% | [−0.032, −0.020] | −0.06R | 85.8% |
| **Différence (détect − aléat)** | — | — | **−0.438%** | **[−0.623, −0.303]** | −0.50R | — |
| Variante direction 50/50 | 779 | 17.2% | −0.023% | [−0.031, −0.018] | −0.06R | — |
| Différence vs 50/50 | — | — | −0.441% | [−0.624, −0.306] | — | — |

IC95 : block bootstrap par jour, 31 jours.

## (b) Coûts par venue (×1, en R, par poste)

| Venue | n | R brut | spread | swap | slippage | taker | funding | R net |
|---|---|---|---|---|---|---|---|---|
| MARGIN (CFD) | 762 | −0.51 | −0.06 | 0.00 | — | — | — | −0.57 |
| FUTURES | 21 | −0.19 | — | — | −0.01 | −0.02 | −0.00 | −0.22 |
| SPOT | 0 | — | — | — | — | — | — | — |

- MARGIN : appliqués = spread 0.02% A/R + swap 0.005%/jour. Taker et funding
  crypto **non appliqués** (sans objet sur CFD).
- FUTURES : taker 0.05%×2 + slippage 0.02%×2 + **funding = constante
  0.01%/8h** (pas de série historique appliquée). n=21 → non concluant.
- Écart −0.17R théorique vs −0.57R mesuré (MARGIN) : −0.06R spread + swap
  résiduel + R brut réel (−0.51R) inférieur au −0.17R de la formule
  WR=50%×RR — l'écart vient du taux d'expiration élevé, pas des coûts.
  Les 21 FUTURES (2.7% de l'échantillon) ne peuvent expliquer le résiduel.

## Levier (rappel — mêmes trades, coûts par venue)

| Levier | n | Espérance | IC95 | Liq | Ruin (bankroll 10×) |
|---|---|---|---|---|---|
| ×1 | 783 | −0.47% | [−0.66, −0.33] | 0 | 0% |
| ×2 | 783 | −0.93% | [−1.32, −0.65] | 0 | 7.1% |
| ×3 | 783 | −1.40% | [−1.98, −0.98] | 0 | 62.2% |
| ×5 | 783 | −2.33% | [−3.29, −1.63] | 0 | 97.8% |
| ×10 | 783 | −4.66% | [−6.58, −3.27] | 0 | 100% |

## (c) Statuts BUY vs SELL — setups distincts

Funnel mesuré : `scan_history` distincts → `signal_logs` → `signals` → résolus.

### signal_logs (log de génération, n=3973)

| Marché | BUY total | BUY résolu TP | BUY résolu SL | BUY expiré | BUY ouvert | SELL total | SELL TP | SELL SL | SELL expiré | SELL ouvert |
|---|---|---|---|---|---|---|---|---|---|---|
| BRVM | 178 | 0 | 0 | 0 | 178 | 109 | 0 | 0 | 0 | 109 |
| Commodities | 1391 | 0 | 0 | 0 | 1391 | 33 | 0 | 0 | 0 | 33 |
| Crypto | 46 | 10 | 5 | 1 | 30 | 0 | 0 | 0 | 0 | 0 |
| Forex | 1141 | 0 | 0 | 4 | 1137 | 14 | 0 | 0 | 0 | 14 |
| Indices | 20 | 0 | 0 | 0 | 20 | 0 | — | — | — | — |
| Synthetic | 0 | — | — | — | — | 1 | 0 | 0 | 0 | 1 |
| UNKNOWN | 1040 | 0 | 0 | 1 | 1039 | 0 | — | — | — | — |
| **Total** | **3816** | **10** | **5** | **6** | **3795** | **157** | **0** | **0** | **0** | **157** |

### signals (persistés/dédupliqués, n=1064)

| Marché | BUY résolu W | BUY résolu L | BUY BE | BUY expiré | BUY actif | SELL W | SELL L | SELL expiré | SELL actif |
|---|---|---|---|---|---|---|---|---|---|
| Forex | 124 | 50 | 6 | 312 | 0 | 0 | 0 | 1 | 0 |
| Commodities | 1 | 2 | 0 | 500 | 2 | 0 | 2 | 6 | 1 |
| Crypto | 1 | 1 | 0 | 29 | 0 | 0 | 0 | 0 | 0 |
| Indices | 0 | 0 | 0 | 25 | 0 | 0 | 0 | 0 | 0 |
| Synthetic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |

- Ratio direction : `signal_logs` 3816/157 = **24:1** ; `signals` ≈ **105:1** ;
  setups distincts `scan_history` ≈ **4.4:1** (1161/263).
- SELL ouverts non-BRVM : XAU, XAG, WTI, BRENT, AUD/USD, EUR/USD, NZD/USD, V75.
- Couverture bougies de ces symboles : AUD/USD, NZD/USD, V75 = **0 bougie** ;
  BRENT/WTI/XAG = depuis le 12 nov seulement ; EUR/USD s'arrête au 20 sept
  alors que des SELLs EUR/USD datent jusqu'au 9 nov → **irrésolubles**.
- SELL sur actifs non shortables (BRVM 109, actions) : signaux de **sortie**,
  pas des shorts — comptés à part, non résolus comme shorts.
- Âge SELL ouverts : même plage que BUY (août → nov) — pas bloqués plus longtemps.
- Rejets par gate : non mesurables dans `signal_logs` (les rejetés n'y sont pas
  persistés) — pas de statut « rejeté » dans les données.
- Test de symétrie (rejeu détecteur sur 1/prix) : **non réalisé** — nécessite
  ré-exécution du détecteur, hors scope lecture seule.

## (d) Couverture crypto

`signal_logs`, market=Crypto :

| Direction | n | TP | SL | Expiré | Ouvert |
|---|---|---|---|---|---|
| BUY | 46 | 10 | 5 | 1 | 30 |
| SELL | 0 | — | — | — | — |

`signals`, Crypto : 31 BUY (1 W, 1 L, 29 expirés), 0 SELL.

- Résolus crypto : **15 dans signal_logs / 2 dans signals** — non concluant
  (n < 30). 0 SELL crypto généré.
- Cause de la faiblesse : fenêtre de données crypto couverte en bougies très
  courte (perp uniquement) + 94% des signaux crypto persistés sont EXPIRED.
- Rejeu hors ligne (Binance klines 1h/4h, top 10-20 perps, 3-6 mois) :
  faisable, effort estimé **~1 journée** (export klines public + harness
  détecteur existant). Écarts avec la prod : pas de contexte dérivés
  (funding/OI/retail) au-delà de ~30 jours, pas de carnet d'ordres
  historique, gate dérivés non rejouable.

## Limites

- **31 jours distincts** = le vrai n (block bootstrap par jour ; les signaux
  1h se chevauchent, n_effectif << 783).
- Pipeline partiellement cassé sur la période (throttling, tracking défectueux).
- Échantillon = signaux **résolus/persistés** uniquement → biais de survie ;
  les expirés dominent (420/783 rejoués).
- Périmètre = détecteur EMA principalement EUR/GBP 1h — **pas « le système »**.
- **Aucune conclusion sur les cryptos (n ≈ 2-15 résolus selon la table).**
- Benchmark validé sur tirages résolus ; les signaux à expiration très courte
  ne contribuent pas à la validation (0).
- « Rejeté par gate » non mesurable : les rejets ne sont pas persistés.
- Aucune conclusion « edge » tirée : ce document rapporte des mesures.
