# Les Variables qui Font Bouger les Marchés

## Vue d'ensemble — Ce que la machine peut capturer

Tout signal de marché appartient à l'une de ces 5 grandes familles :

```
Prix & Volume      →  ce qui s'est passé
Technique          →  ce que les patterns disent
Fondamental        →  ce que l'entreprise/économie vaut
Sentiment          →  ce que les gens pensent
Macro / Externe    →  ce que le monde fait
```

---

## 1. Variables Prix & Volume (OHLCV)

La matière première brute. Tout le reste en dérive.

| Variable | Description | Machine-friendly |
|---|---|---|
| `open, high, low, close` | Bougie classique | ✅ Direct |
| `volume` | Conviction derrière le mouvement | ✅ Direct |
| `vwap` | Prix moyen pondéré au volume | ✅ Calculable |
| `spread` | Bid/Ask difference | ✅ sur Forex/Crypto |
| `tick_count` | Nombre de transactions par bougie | ✅ sur certains brokers |
| `delta` | Volume acheteur - vendeur | ✅ Order flow |
| `open_interest` | Positions ouvertes (futures) | ✅ sur dérivés |

**Ce qu'un trader rentable fait ici** : il ne regarde pas la bougie isolée — il lit le **contexte** (la bougie dans une structure, à un niveau clé, avec un volume anormal).

---

## 2. Variables Techniques (Indicateurs Dérivés)

Transformations mathématiques des prix.

### Tendance
| Indicateur | Rôle | Signal |
|---|---|---|
| `EMA(20), EMA(50), EMA(200)` | Direction tendance | Croisements |
| `SMA` | Tendance lissée | Support/résistance dynamique |
| `ADX` | Force de la tendance | ADX > 25 = tendance forte |
| `Ichimoku` | Tendance + support + signal | Complexe mais complet |
| `Supertrend` | Trend following | Buy/Sell direct |

### Momentum
| Indicateur | Rôle | Signal |
|---|---|---|
| `RSI(14)` | Survente/surachat | < 30 / > 70 |
| `MACD` | Momentum + direction | Croisements signal |
| `Stochastique` | Momentum cyclique | < 20 / > 80 |
| `CCI` | Déviation par rapport à la moyenne | Extrêmes |
| `Williams %R` | Momentum inversé | Survente/surachat |
| `ROC` | Vitesse du changement de prix | Divergences |

### Volatilité
| Indicateur | Rôle | Signal |
|---|---|---|
| `ATR(14)` | Amplitude des mouvements | Dimensionner le stop |
| `Bollinger Bands` | Volatilité + mean reversion | Squeezes / breakouts |
| `Keltner Channel` | ATR-based channel | Breakout de canal |
| `VIX` (indices) | Peur du marché | > 30 = panique |
| `HV` (historical vol) | Volatilité réalisée | Compare à IV |

### Volume
| Indicateur | Rôle | Signal |
|---|---|---|
| `OBV` | On Balance Volume | Divergence prix/volume |
| `CMF` | Chaikin Money Flow | Pression achat/vente |
| `MFI` | Money Flow Index | RSI du volume |
| `Volume Profile` | Distribution du volume par prix | Niveaux clés |

### Structure de prix
| Variable | Description |
|---|---|
| `Support / Résistance` | Niveaux historiques de réaction |
| `Pivot Points` | Niveaux probabilistes quotidiens |
| `Fibonacci` | Retracements 38.2%, 50%, 61.8% |
| `Swing highs/lows` | Structure de marché (CHoCH, BOS) |
| `Fair Value Gaps` | Déséquilibres à combler (SMC) |
| `Order Blocks` | Zones d'accumulation institutionnelle |

---

## 3. Variables Fondamentales

### Pour les actions (BRVM, actions US)
| Variable | Source | Fréquence |
|---|---|---|
| `EPS` (bénéfice/action) | Rapports trimestriels | Trimestrielle |
| `P/E ratio` | Prix / EPS | Temps réel |
| `Revenue growth` | CA trimestriel | Trimestrielle |
| `Debt/Equity` | Bilan | Annuelle |
| `Free Cash Flow` | État de trésorerie | Trimestrielle |
| `ROE, ROA` | Rentabilité | Annuelle |
| `Dividende yield` | Dividende / Prix | Temps réel |
| `Book value` | Valeur comptable | Annuelle |

### Pour le Forex
| Variable | Impact |
|---|---|
| `Taux d'intérêt banque centrale` | ⭐⭐⭐ Majeur |
| `Inflation (CPI, PCE)` | ⭐⭐⭐ Majeur |
| `PIB (croissance)` | ⭐⭐⭐ Majeur |
| `Emploi (NFP, chômage)` | ⭐⭐ Important |
| `Balance commerciale` | ⭐⭐ Important |
| `PMI (activité économique)` | ⭐⭐ Important |

### Pour la Crypto
| Variable | Impact |
|---|---|
| `On-chain : exchange flows` | Pression vente/achat |
| `Hash rate` | Santé du réseau |
| `Active addresses` | Adoption |
| `Whale movements` | Manipulation potentielle |
| `Funding rate (futures)` | Sentiment leveragé |
| `Long/Short ratio` | Positionnement marché |
| `Fear & Greed Index` | Sentiment global |

---

## 4. Variables Sentiment

Ce que les humains pensent — souvent un leading indicator.

| Variable | Source | Machine-friendly |
|---|---|---|
| `News sentiment score` | NLP sur actualités | ✅ GPT / BERT |
| `Social media volume` | Twitter/X, Reddit | ✅ APIs |
| `Google Trends` | Intérêt de recherche | ✅ API |
| `Put/Call ratio` | Options market | ✅ données options |
| `Insider transactions` | Achats/ventes dirigeants | ✅ SEC/EDGAR |
| `Analyst ratings` | Consensus buy/sell | ✅ scraping |
| `Fear & Greed Index` | CNN / Crypto | ✅ API |
| `Short interest` | % flottant shorté | ✅ pour actions US |

---

## 5. Variables Macro / Externes

Le contexte global qui écrase tout le reste.

| Variable | Impact sur |
|---|---|
| `Décisions FED / BCE / BCEAO` | Tout |
| `Calendrier économique` (NFP, CPI, PMI) | Forex, indices |
| `Prix des matières premières` (pétrole, or, cacao) | Actions liées, Forex |
| `Corrélations inter-marchés` | DXY vs Gold vs BTC |
| `Saison des résultats` | Actions |
| `Cycles de marché` | Bull/Bear macro |
| `Géopolitique` | Volatilité soudaine |

---

## Ce que fait un Trader Très Rentable vs la Machine

| | Trader Rentable | Machine (algo) |
|---|---|---|
| **Force** | Contexte, intuition, adaptation | Vitesse, constance, absence d'émotion |
| **Faiblesse** | Fatigue, biais cognitifs, lenteur | Rigide, aveugle au contexte narratif |
| **Ce qu'il lit** | Structure + confluences + catalyseur | Signaux quantifiables uniquement |
| **Timing** | Attendre le setup parfait | Exécuter toutes les conditions remplies |
| **Risk** | Sizing instinctif adaptatif | Sizing mathématique fixe |
| **Edge** | Comprendre pourquoi le marché bouge | Détecter quand le marché a bougé |

**La vérité** : les meilleurs systèmes algorithmiques **copient le raisonnement** du trader rentable en le rendant explicite et reproductible.

---

## Architecture pour un Système Adaptatif

C'est ici que ta question devient critique : **comment rester adaptatif sans tout casser ?**

```
Couche 1 — Statique (jamais changée)
├── Calcul des indicateurs (EMA, RSI, ATR...)
├── Détection de structure (swing high/low)
└── Gestion du risque (% capital, ATR stop)

Couche 2 — Configurable (changée par l'utilisateur)
├── Stratégie : règles IF/THEN éditables
├── Paramètres : periods, thresholds, timeframes
└── Univers d'actifs scanné

Couche 3 — Adaptative (ML/IA)
├── Ajustement des seuils selon le régime de marché
├── Scoring de confiance des signaux
└── Détection de régime (trending / ranging / volatile)
```

### Régimes de marché — la clé de l'adaptation

```typescript
type MarketRegime = 
  | 'trending_bull'     // ADX > 25, prix > EMA200
  | 'trending_bear'     // ADX > 25, prix < EMA200
  | 'ranging'           // ADX < 20, prix entre supports
  | 'high_volatility'   // ATR > 2x moyenne
  | 'accumulation'      // volume croissant, prix stable

// Chaque régime active une stratégie différente
const strategyMap: Record<MarketRegime, Strategy> = {
  trending_bull:   TrendFollowingStrategy,
  ranging:         MeanReversionStrategy,
  high_volatility: ReducedSizeStrategy,
  accumulation:    WatchlistOnlyStrategy,
  ...
}
```

---

## Recommandation pour l'AI Investment OS

### Variables à implémenter en priorité (MVP)

```
Phase 1 — Fondation (Semaine 1-2)
├── OHLCV brut
├── EMA(20, 50, 200)
├── RSI(14)
├── ATR(14)
└── Volume relatif (vs moyenne 20j)

Phase 2 — Enrichissement (Semaine 3-4)
├── MACD
├── Bollinger Bands
├── Détection swing highs/lows
├── Calendrier économique (news à éviter)
└── Détection de régime (trending/ranging)

Phase 3 — Avancé (Post-MVP)
├── Sentiment NLP (actualités)
├── On-chain data (crypto)
├── Fondamentaux BRVM
└── Scoring ML de confiance
```

### Règle d'or pour l'adaptabilité

> **Ne jamais hardcoder une règle dans le moteur.**
> Toujours la stocker en base de données comme configuration.

```typescript
// ❌ À ne jamais faire
if (rsi < 30 && ema20 > ema50) signal = 'BUY'

// ✅ Architecture adaptative
const rules = await strategyRepo.getRules(strategyId)
const signal = ruleEngine.evaluate(indicators, rules)
```

Cela permet de changer une stratégie sans redéployer, de tester plusieurs stratégies en parallèle (A/B), et d'ajouter des nouvelles règles via l'interface utilisateur — **sans toucher au code**.