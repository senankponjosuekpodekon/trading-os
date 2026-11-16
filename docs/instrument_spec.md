# Spec — Fiche instrument (`instrument_profile`)

Statut : proposition. Source : audit Carver §1 (fiche instrument obligatoire)
convergente avec le besoin mesuré B1 — constantes de coûts dupliquées
backtest/prod, et bug (iv) feed génération ≠ feed résolution.

## Pourquoi

Trois problèmes mesurés convergent vers une même brique :

1. **Coûts** : `scripts/leverage_backtest.py` maintient des constantes par
   *classe* (spread 0.02% pour tout CFD, taker 0.05% pour toute crypto)
   alors que le spread dépend de la paire et le funding du perp. L'écart
   coût théorique vs mesuré (~10% du problème) vient de là.
2. **Feed** (iv) : un signal ne sait pas quel provider l'a émis ni lequel
   le résout → décalage adverse médian 0.5–1.3×SL, 98.9% sur commodités.
3. **Résolution irrégulière** : symboles sans bougies (AUD/NZD/V75 = 0),
   couverture récente (BRENT/WTI depuis le 12 nov) → STILL_OPEN.

L'existant : `assets` (symbol, name, marketId, baseCurrency, metadata
vide), `markets` (name, type), `utils/asset_config.py` (config par
*marketType*, cache 60 s via `/api/admin/markets/engine`), `COSTS` du
backtest, `liq_distance()`.

## Modèle proposé

Une ligne par instrument, dans une table `instrument_profile` (clé
`assets.symbol`), lue par engine + API + backtest — **une seule source**.

### Identité

| Champ | Type | Exemple | Note |
|---|---|---|---|
| symbol | text PK | `EUR/USD` | = `assets.symbol` |
| venue | enum | `SPOT` `MARGIN` `FUTURES` `SYNTHETIC` | = `venue()` actuel, promu en donnée |
| asset_class | enum | `forex` `commodité` `crypto` `indice` `action` `brvm` `synthetic` | |
| quote_currency | text | `USD`, `USDT` | déjà `baseCurrency` — y référer, ne pas dupliquer |
| shortable | bool | false pour BRVM/actions | les SELL non-shortables = signaux de sortie, pas des shorts |

### Contrat

| Champ | Type | Exemple |
|---|---|---|
| multiplier | numeric | 1 (crypto/CFD), 100 oz (XAU CFD selon broker) |
| tick_size | numeric | 0.0001 forex 5d, 0.01 XAU, 0.1 BTC |
| lot_min | numeric | min d'ordre accepté par le broker/exchange |
| notional_min | numeric | notionnel minimum (Binance ~5–10 USDT) |
| max_leverage | numeric | perps uniquement |

### Coûts — en unité de risque (SR cost, Carver §3.2)

| Champ | Type | Note |
|---|---|---|
| spread_rt | numeric | aller-retour, fraction du prix (0.0002 ≈ 0.02%) |
| taker_rt | numeric | crypto/perp |
| maker_rt | numeric | pour l'exécution passive |
| slippage_rt_obs | numeric | **observé** sur le journal d'exécution, pas constant |
| carry_source | enum | `funding` (perp) / `swap` (CFD) / `none` (spot) |
| carry_freq | text | `8h` funding, `daily` swap |
| carry_rate | numeric | taux courant (funding live) ou constante documentée |

### Prix et résolution — le fix (iv)

| Champ | Type | Note |
|---|---|---|
| price_source_scan | text | provider qui produit `entryPrice` |
| price_source_resolve | text | provider prioritaire pour la résolution |
| feed_offset_obs | numeric | écart moyen mesuré entre les deux feeds (en %), recalculé périodiquement |

Règle cible : `price_source_resolve == price_source_scan` quand le provider
couvre les deux ; sinon `feed_offset_obs` mesuré et appliqué aux niveaux
TP/SL. Chaque signal persiste son `price_source` en `metadata`.

### Perpétuels

| Champ | Type | Note |
|---|---|---|
| liq_buffer | numeric | buffer maintenance (défaut `MM_BUFFER`=1.5%) |
| liq_distance | dérivé | `max(0, 1/L − liq_buffer)` — formule existante, pas redondante |

### Risque et gouvernance

| Champ | Type | Note |
|---|---|---|
| tradable | bool | couvre « pas de bougies / pas de feed » → n'émet pas de signal |
| candles_since | date | début de couverture réelle — explique les STILL_OPEN |
| capital_max_exchange | numeric | plafond de capital par venue (Goldilocks) |
| updated_at | ts | fraîcheur de la fiche |

## Consommateurs

| Consommateur | Usage |
|---|---|
| `leverage_backtest.py` | `COSTS` ← fiche, plus de constantes dupliquées |
| Quality gate | spread attendu vs distance TP (couche execution) |
| Signal tracker | provider de résolution + feed_offset |
| Sizing engine (futur) | multiplier, tick, σ — `N = capital·τ/(mult·prix·σ)` |
| Signal carry (futur) | carry_source + carry_freq par instrument |
| UI | badge venue déjà affiché → tooltip coûts/levier |

## Implémentation — séquence

1. **Schéma** : table `instrument_profile`, backfill depuis `assets` +
   `venue()` + `COSTS` actuels comme valeurs de départ (constantes
   marquées `source='default'`).
2. **Lecture unifiée** : un loader `instrument_profile` côté engine (cache
   60 s, pattern `asset_config.py`) et côté backtest.
3. **Mesure continue** : `feed_offset_obs` et `slippage_rt_obs` recalculés
   par cron depuis le journal d'exécution + la comparaison bougie/prix
   (job offline, pas de write prod sur les signaux).
4. **Non objectifs** : pas de sizing, pas de levier, pas de changement de
   gate à cette étape — la fiche sert la *mesure*.

## Ouverts

- Multiplicateurs CFD dépendent du broker (Oanda vs Deriv) — une fiche
  par (instrument, broker) si multi-broker un jour.
- `carry_rate` funding est variable : stocker la valeur courante
  + timestamp, ou référencer la collecte phase A (futures_data).
- FDM/IDM : corrélations estimées sur historique court → lissage
  obligatoire avant tout usage (multiplicateur arrondi, fenêtre min).
