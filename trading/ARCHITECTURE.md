# AI Investment OS — Document d'Architecture Complet

> Version 1.0 — Juillet 2026 | Auteur : Josue / Stiamond | Statut : Architecture validée — MVP à bootstrapper

---

## Table des Matières

1. [Vision Produit](#1-vision-produit)
2. [Personas](#2-personas)
3. [Domain Model](#3-domain-model)
4. [Les 6 Moteurs](#4-les-6-moteurs)
5. [Variables de Marché](#5-variables-de-marché)
6. [Stratégies et Marchés](#6-stratégies-et-marchés)
7. [LLM · RAG · Workflow Engine](#7-llm--rag--workflow-engine)
8. [Stack Technique](#8-stack-technique)
9. [Architecture Système](#9-architecture-système)
10. [Schéma Base de Données](#10-schéma-base-de-données)
11. [Contrat API](#11-contrat-api)
12. [Parcours Utilisateur](#12-parcours-utilisateur)
13. [Roadmap MVP 30 Jours](#13-roadmap-mvp-30-jours)
14. [Règles Métier](#14-règles-métier)
15. [Glossaire](#15-glossaire)

---

## 1. Vision Produit

### Mission

> **Un système intelligent qui aide l'investisseur à prendre de meilleures décisions en appliquant une stratégie définie — sans remplacer son jugement.**

L'application n'est **pas** :
- ❌ Un broker (elle ne détient pas l'argent)
- ❌ Un robot de trading automatique
- ❌ Un chatbot généraliste

Elle **est** :
- ✅ Un OS d'investissement — plusieurs moteurs spécialisés coordonnés par l'IA
- ✅ Un assistant de décision — le trader reste maître de chaque ordre
- ✅ Un journal intelligent — chaque décision est tracée et analysée

### Problème résolu

Un investisseur ou trader passe aujourd'hui 2 à 3 heures par jour à :
- Ouvrir TradingView sur 10 actifs différents
- Calculer manuellement la taille de sa position
- Vérifier s'il y a une news avant d'entrer
- Chercher un setup qui correspond à sa stratégie
- Noter ses trades dans un tableur

Notre système supprime ces tâches répétitives. L'utilisateur reçoit une liste de setups qualifiés chaque matin, avec l'explication, le calcul du risque, et le contexte de marché — prêts à être exécutés ou ignorés en connaissance de cause.

### Positionnement marché

- **Marché primaire** : BRVM (Bourse Régionale Valeurs Mobilières — Afrique de l'Ouest)
- **Marchés secondaires** : Forex, Crypto, Indices synthétiques (V75)
- **Angle différenciant** : Aucun outil IA sérieux n'existe pour la BRVM. Premier entrant sur 60M+ d'investisseurs potentiels en Afrique de l'Ouest.
- **Business model** : SaaS — Freemium → 19$/mois (Starter) → 49$/mois (Pro) → 199$/mois (Fund)

---

## 2. Personas

### Persona 1 — Le Trader Expérimenté

- **Profil** : 3 à 10 ans d'expérience, trade la BRVM et/ou le Forex
- **Douleur** : Perd du temps à analyser, rate des setups, trade sous émotion
- **Objectif** : Appliquer sa stratégie de façon systématique, ne plus rater d'opportunité
- **Usage** : Configure sa stratégie TKL, reçoit les alertes, décide lui-même d'exécuter
- **Valeur perçue** : Gain de temps + discipline imposée par le système

### Persona 2 — Le Trader Débutant

- **Profil** : Moins de 2 ans, en apprentissage actif
- **Douleur** : Ne sait pas identifier un bon setup, fait des erreurs émotionnelles
- **Objectif** : Apprendre tout en tradant, éviter les erreurs classiques
- **Usage** : Lit les explications IA de chaque signal, fait du paper trading
- **Valeur perçue** : Formation par l'exemple + sécurité du paper trading

### Persona 3 — L'Investisseur Long Terme

- **Profil** : Professionnel, investit sur la BRVM, horizon 6–24 mois
- **Douleur** : Pas le temps de suivre les marchés au quotidien
- **Objectif** : Être alerté des bonnes opportunités sur des actifs de qualité
- **Usage** : Scanner sur timeframe 1D/1W, 2–3 alertes par mois, focus fondamentaux BRVM
- **Valeur perçue** : Sérénité + optimisation du timing d'entrée

---

## 3. Domain Model

### Objets Métier

```
Utilisateur         →  possède plusieurs Portefeuilles
Portefeuille        →  contient du Cash + des Positions
Position            →  référence un Actif + quantité + prix d'entrée + SL + TP
Trade               →  cycle complet d'une Position (Ouverture → Fermeture)
Actif               →  appartient à un Marché (BRVM / Forex / Crypto / Synthetic)
Bougie (Candle)     →  OHLCV d'un Actif sur un Timeframe donné
Indicateur          →  valeur calculée à partir des Bougies (EMA, RSI, ATR...)
Stratégie           →  ensemble de Règles + paramètres de Risque
Règle               →  condition IF/THEN sur des Indicateurs
Signal              →  résultat de l'évaluation d'une Stratégie sur un Actif
Régime              →  état du marché (trending_bull, ranging, high_volatility...)
Notification        →  alerte envoyée à l'Utilisateur
Journal (Entry)     →  trace d'une décision avec contexte complet
Backtest            →  simulation d'une Stratégie sur données historiques
```

### Relations

```
Utilisateur
    │ possède (1→N)
    ▼
Portefeuille
    │ contient (1→N)
    ▼
Position ────────────────── référence ──► Actif
    │                                       │
    │ génère                            appartient
    ▼                                       ▼
Trade                                   Marché
    │                                       │
    │ enregistré dans                  contient (N)
    ▼                                       ▼
Journal                                 Bougies
                                            │
                                        calcul ▼
Stratégie ──── appliquée à ──────► Indicateurs
    │                                       │
    │ évalue + régime                  utilisés par
    ▼                                       ▼
Signal ◄──────────────────────── Régime Marché
    │
    │ déclenche
    ▼
Notification
```

### Event Storming

```
Utilisateur créé → Portefeuille créé → Stratégie configurée
        ↓
Actif ajouté au scanner → Données marché téléchargées
        ↓
Indicateurs calculés → Régime détecté → Stratégie évaluée
        ↓
Signal généré → Risk Engine consulté → Signal approuvé / bloqué
        ↓
Notification envoyée → Utilisateur décide
        ↓
Position ouverte (paper ou réelle) → Position surveillée
        ↓
SL ou TP atteint → Trade fermé → Journal enregistré
        ↓
Performance calculée → Rapport IA généré
```

### Use Cases

**Utilisateur**
- Créer un portefeuille paper trading
- Configurer une stratégie avec ses propres règles
- Consulter les signaux du jour
- Lire l'explication IA d'un signal
- Ouvrir / fermer une position (paper)
- Consulter ses performances
- Poser une question à l'assistant IA
- Lancer un backtest sur une stratégie

**Système (automatique)**
- Scanner tous les actifs toutes les heures
- Calculer les indicateurs
- Détecter le régime de marché
- Évaluer les stratégies
- Filtrer par le Risk Engine
- Surveiller les positions ouvertes
- Fermer les positions au SL/TP
- Générer les rapports hebdomadaires IA

---

## 4. Les 6 Moteurs

L'architecture repose sur **6 moteurs indépendants à responsabilité unique**. Chacun peut être modifié, remplacé ou amélioré sans toucher aux autres.

```
Données brutes → Market Engine → Technical Engine → Strategy Engine
                                                           ↓
                              Execution Engine ← Portfolio Engine ← Risk Engine
```

### Market Engine

**Responsabilité unique** : collecter et normaliser les données de marché. Il ne calcule rien, ne prend aucune décision, fournit uniquement des Candles propres.

```
Sources supportées
├── Binance API      → Crypto (BTC, ETH, BNB...)
├── Alpha Vantage    → Forex, Actions US (500 req/jour gratuit)
├── Deriv API        → Indices synthétiques (V75, V25, V100)
├── BRVM Scraper     → Actions BRVM (scraping brvm.org après clôture 17h30)
├── Yahoo Finance    → Actions mondiales (yfinance)
└── Economic Calendar→ Événements macro (Forex Factory)

Architecture connecteurs (Strategy Pattern — interchangeables)

interface MarketConnector:
    get_ohlcv(symbol, timeframe, limit) → List[Candle]
    get_assets()                        → List[Asset]
    get_realtime_price(symbol)          → float

class BinanceConnector(MarketConnector): ...
class AlphaVantageConnector(MarketConnector): ...
class DerivConnector(MarketConnector): ...   ← V75
class BRVMConnector(MarketConnector): ...    ← scraper
```

### Technical Engine

**Responsabilité unique** : transformer les données brutes en indicateurs. Il reçoit des Candles, retourne des valeurs numériques, ne génère jamais de signal.

```
Phase 1 (MVP)            Phase 2                  Phase 3
─────────────────        ─────────────────        ─────────────────
EMA(20, 50, 200)         MACD                     Volume Profile
RSI(14)                  Bollinger Bands           Order Blocks
ATR(14)                  Stochastique              Fair Value Gaps
Volume relatif           ADX                       Ichimoku
VWAP                     Swing High/Low detection  On-chain metrics
                         Pivot Points              Sentiment NLP score
                         Régime detection          Commodity correlation
```

### Strategy Engine

**Responsabilité unique** : évaluer les règles d'une stratégie sur les indicateurs. Il reçoit des indicateurs + règles JSON, retourne un Signal avec score de confiance. Il ne connaît ni le portefeuille ni le risque.

```python
def evaluate_strategy(strategy, indicators) -> Signal:
    results = [evaluate_rule(r, indicators) for r in strategy.rules]
    passed  = all(results) if strategy.logic == "AND" else any(results)
    if not passed:
        return Signal(type="NEUTRAL", confidence=0)
    confidence = compute_confidence(indicators, strategy)
    return Signal(type=strategy.signal, confidence=confidence)
```

### Risk Engine

**Responsabilité unique** : valider ou bloquer un signal. Il est **prioritaire sur tous les autres moteurs** — même un signal à 95% de confiance peut être bloqué.

```
Règles de blocage
├── News à fort impact dans les 30 prochaines minutes
├── Exposition totale portefeuille > 20% du capital
├── Drawdown journalier > 3% du capital
├── ATR × 1.5 > cash disponible / 100
├── Régime = high_volatility ET confiance < 80%
└── Même actif déjà en position ouverte

Calculs automatiques (si signal approuvé)
├── Stop Loss   = prix_entrée − (ATR × multiplicateur_stratégie)
├── Take Profit = prix_entrée + (stop_distance × ratio_RR)
└── Taille      = (capital × risque_pct) / stop_distance
```

### Portfolio Engine

**Responsabilité unique** : connaître l'état du portefeuille en temps réel.

```
Données maintenues
├── Capital total et cash disponible
├── Valeur des positions ouvertes (mark-to-market)
├── PnL : journalier / hebdomadaire / mensuel / global
├── Drawdown maximum (HWM)
├── Allocation par actif / secteur / marché
├── Win rate, ratio gain/perte moyen
└── Historique complet des trades
```

### Execution Engine

**Responsabilité unique** : exécuter les ordres. Il ne réfléchit jamais. Il reçoit un ordre validé et l'exécute.

```
Modes (MVP → Prod)
├── Paper Trading   → simule en base de données, zéro broker
├── Manuel          → crée la fiche trade, l'utilisateur exécute lui-même
└── Broker connecté → Interactive Brokers, Deriv, XTB (v2 post-MVP)
```

---

## 5. Variables de Marché

### Les 5 Familles

```
1. Prix & Volume (OHLCV)     →  ce qui s'est passé
2. Technique (indicateurs)   →  ce que les patterns disent
3. Fondamental               →  ce que l'entreprise / l'économie vaut
4. Sentiment                 →  ce que les acteurs pensent
5. Macro / Externe           →  ce que le monde fait
```

### Pourquoi on ne peut pas tout utiliser en même temps

**Raison 1 — Malédiction de la dimensionnalité** : plus de variables = plus de fausses corrélations. 10 variables bien choisies battent 100 variables bruyantes (overfitting).

**Raison 2 — Disponibilité réelle** : la moitié des variables n'existent tout simplement pas pour la BRVM (pas de données fondamentales digitales, pas de VIX local, pas d'options).

**Raison 3 — Coût computationnel** : appeler l'API OpenAI sur 50 actifs en temps réel = 100 secondes. Impossible. Solution : traitement asynchrone non-bloquant.

**Raison 4 — Fréquence naturelle** : recalculer les fondamentaux toutes les heures est inutile — ils changent trimestriellement.

### Variables — Phase 1 (MVP)

| Variable | Calcul | Signaux dérivés |
|---|---|---|
| `EMA(20,50,200)` | Moyenne exponentielle | alignement haussier, golden/death cross |
| `RSI(14)` | Ratio gains/pertes 14j | survente < 30, surachat > 70, divergences |
| `ATR(14)` | Amplitude moyenne 14j | stop sizing, régime volatilité |
| `volume_ratio` | volume / moy_volume_20j | > 2.0 = signal fort, < 0.5 = éviter |
| `VWAP` | Prix × volume / volume total | support/résistance intraday |

### Variables — Phase 2

| Variable | Calcul | Usage |
|---|---|---|
| `MACD` | EMA12 − EMA26, signal EMA9 | momentum + direction |
| `Bollinger Bands` | SMA20 ± 2σ | mean reversion, breakout, squeeze |
| `ADX(14)` | Force de tendance | > 25 trending, < 20 ranging |
| `Swing Highs/Lows` | N bougies de chaque côté | structure marché, BOS, CHoCH |
| `Régime` | f(ADX, EMA200, ATR) | sélection automatique de stratégie |
| `Calendrier éco` | Forex Factory scraping | bloquer signaux avant news |

### Variables — Phase 3 (Post-MVP)

| Variable | Source | Impact |
|---|---|---|
| `Sentiment NLP` | NewsAPI + GPT | ± 10 pts confiance |
| `On-chain` | Glassnode / CryptoQuant | crypto uniquement |
| `Fondamentaux BRVM` | brvm.org scraping | P/E, dividende, secteur |
| `ML Scoring` | scikit-learn | score adaptatif par régime |

### Matières Premières — Critique pour BRVM

| Matière | Actifs BRVM affectés | Corrélation | Source |
|---|---|---|---|
| Cacao | SUCRIVOIRE, agro CI | ⭐⭐⭐ Directe | Alpha Vantage CC=F |
| Caoutchouc | SAPH | ⭐⭐⭐ Directe | TOCOM API |
| Café | Filières agro CI | ⭐⭐ Forte | Alpha Vantage KC=F |
| Coton | CFDT, textiles | ⭐⭐ Forte | Quandl |
| Pétrole | Transport, énergie | ⭐⭐ Indirecte | Alpha Vantage CL=F |
| Or | Mines (peu sur BRVM) | ⭐ Faible | Alpha Vantage GC=F |
| XOF/EUR | Tous import/export | ⭐⭐⭐ Majeur | BCEAO / Forex API |

```python
# Intégration dans le scoring
def commodity_context_score(asset, commodities) -> float:
    if asset.sector == "agro_cacao":
        trend = commodities["cocoa"]["trend"]
        if trend == "up":   return +0.2
        if trend == "down": return -0.3
    if asset.sector == "agro_rubber":
        if commodities["rubber"]["trend"] == "up": return +0.2
    return 0.0
```

### Scoring Final — Tout Ensemble

```python
def compute_signal_confidence(technical, regime, fundamental,
                               sentiment, commodity, calendar) -> Signal:
    score = technical.base_score        # 0–100, base technique

    score += regime.adjustment          # trending: +10 | ranging+trend_strat: -20
    score += fundamental.score * 15     # max +15 (phase 3)
    score += sentiment.score * 10       # -10 à +10 (phase 3)
    score += commodity.score * 10       # max +10 (phase 3)

    # Blocages absolus Risk Engine
    if calendar.high_impact_imminent:   return Signal(type="BLOCKED", reason="news")
    if regime == "high_volatility" and score < 80:
                                        return Signal(type="BLOCKED", reason="volatility")

    if score >= 75: return Signal(type="BUY",   confidence=score)
    if score <= 25: return Signal(type="SELL",  confidence=100 - score)
    if score >= 55: return Signal(type="WATCH", confidence=score)
    return Signal(type="NEUTRAL", confidence=score)
```

---

## 6. Stratégies et Marchés

### Principe fondamental

> **Les règles de stratégie ne sont jamais hardcodées dans le code. Elles sont stockées en base de données au format JSON et évaluées dynamiquement.**

```typescript
// ❌ À ne jamais faire
if (rsi < 30 && ema20 > ema50) return "BUY"

// ✅ Architecture adaptative
const rules  = await strategyRepo.getRules(strategyId)
const signal = ruleEngine.evaluate(indicators, rules)
```

Avantages : changer une stratégie sans redéployer, A/B test plusieurs stratégies, interface utilisateur pour créer ses propres règles.

### Structure d'une Stratégie (JSON)

```json
{
  "id": "tkl-v1",
  "name": "TKL v1",
  "markets": ["BRVM", "FOREX", "CRYPTO"],
  "instruments": ["*"],
  "regimes": ["trending_bull"],
  "timeframes": ["1h", "4h", "1d"],
  "rules": {
    "logic": "AND",
    "conditions": [
      { "indicator": "ema_alignment",  "operator": "==", "value": true },
      { "indicator": "rsi",            "operator": "<",  "value": 40 },
      { "indicator": "vol_ratio",      "operator": ">",  "value": 1.2 },
      { "indicator": "above_ema200",   "operator": "==", "value": true }
    ],
    "signal": "BUY",
    "confidence_base": 70
  },
  "risk_params": {
    "stop_atr_multiplier": 1.5,
    "tp_rr_ratio": 2.0,
    "max_risk_pct": 1.0,
    "max_concurrent_trades": 3
  }
}
```

### Bibliothèque de Stratégies

| Stratégie | Marché | Régime optimal | Logique |
|---|---|---|---|
| **TKL v1** | BRVM / Forex / Crypto | trending_bull | EMA alignées + RSI < 40 + volume |
| **Mean Reversion** | Crypto / Forex | ranging | Bollinger Lower + RSI < 30 |
| **Breakout ATR** | Tous | trending | Cassure niveau + ATR × 1.5 |
| **V75 Scalp** | Synthetic (V75) | any | RSI extremes + Bollinger + SMC |
| **DCA BRVM** | BRVM | any | Fondamentaux + prix sous fair value |
| **Momentum Crypto** | Crypto | trending_bull | MACD + RSI > 50 + volume × 2 |

### Cas Particulier — V75 (Volatility Index 75 — Deriv)

```
Caractéristiques uniques
├── Volatilité synthétique artificielle fixe à 75%
├── Tourne 24h/24, 7j/7 — pas de gaps, pas de news
├── Aucune corrélation avec les marchés réels
└── Connecteur : Deriv API (Binary.com)

Variables UTILES sur V75        Variables INUTILES sur V75
────────────────────────        ──────────────────────────
RSI                  ✅         Calendrier économique  ❌
Bollinger Bands      ✅         Sentiment news         ❌
ATR                  ✅         Fondamentaux           ❌
Swing structure SMC  ✅         Corrélations macro     ❌
Volume interne       ✅         EMA200 long terme      ⚠️

Stratégie : Mean Reversion + SMC sur timeframes courts (5m, 15m)
```

### Sélection automatique de stratégie par régime

```python
STRATEGY_REGIME_MAP = {
    "trending_bull":  ["tkl-v1", "breakout-atr", "momentum-crypto"],
    "trending_bear":  ["short-tkl", "breakout-atr-short"],
    "ranging":        ["mean-reversion", "v75-scalp"],
    "high_volatility": [],          # aucune stratégie active
    "accumulation":   ["dca-brvm"],
}

def select_strategies(regime, asset):
    compatible = STRATEGY_REGIME_MAP.get(regime, [])
    return [s for s in compatible if asset.market in s.markets]
```

---

## 7. LLM · RAG · Workflow Engine

### LLM — Rôle précis

> **Le LLM explique. Il ne décide jamais. Les règles décident, le LLM commente.**

```
Usages
├── Expliquer un signal en langage naturel
├── Résumer les actualités d'un actif (dernières 24h)
├── Commenter les performances du portefeuille
├── Répondre aux questions libres de l'utilisateur
└── Générer le rapport hebdomadaire personnalisé

Architecture abstraite (provider swappable)
class AIProvider(ABC):
    explain_signal(signal, context) → str
    summarize_news(news_items)      → str
    analyze_performance(trades)     → str

class OpenAIProvider(AIProvider): ...    ← GPT-4o (défaut)
class ClaudeProvider(AIProvider): ...    ← Anthropic (swap sans toucher au code)
class MistralProvider(AIProvider): ...   ← moins cher si volume élevé
```

### RAG — Base de Connaissances Financière

```
Documents indexés (pgvector — pas de Qdrant séparé au MVP)
├── Actualités financières    ← NewsAPI → embeddings quotidiens
├── Rapports annuels BRVM     ← PDFs → chunking → embeddings
├── Journal de trading user   ← chaque trade vectorisé
├── Définitions des stratégies← règles et logique
└── Notes de recherche        ← Goldman, JPMorgan publics

Pipeline RAG
Question utilisateur
    ↓
Embedding (text-embedding-3-small)
    ↓
Recherche vectorielle pgvector (cosine similarity)
    ↓
Top 5 chunks pertinents
    ↓
Prompt enrichi → GPT-4o
    ↓
Réponse contextualisée

Exemples de requêtes
"Pourquoi SONATEL a-t-elle chuté le mois dernier ?"
"Montre-moi mes erreurs sur les trades perdants"
"Quel est l'impact du cacao sur SUCRIVOIRE ?"
"Ma stratégie TKL a-t-elle fonctionné en 2023 ?"
```

### Workflow Engine — Jobs BullMQ

**Workflow 1 — Scanner Quotidien (Cron 06:00 UTC)**
```
Fetch OHLCV tous actifs → Calcul indicateurs → Détection régime
    → Évaluation stratégies → Risk Engine filter
    → Sauvegarde signaux → Explications LLM (async) → Notifications
```

**Workflow 2 — Surveillance Positions (toutes les 5min)**
```
Fetch prix actuel → Comparer vs SL/TP
    → IF SL atteint : fermer position, journal, notifier
    → IF TP atteint : fermer position, calculer PnL, notifier
    → Mise à jour portfolio Redis Pub/Sub → WebSocket frontend
```

**Workflow 3 — Rapport Hebdomadaire IA (Dimanche 18:00 UTC)**
```
Agréger trades semaine → Calculer statistiques
    → RAG sur journal → LLM → rapport personnalisé
    → Envoyer email + notification in-app
```

**Workflow 4 — Alerte News (30min avant événement High Impact)**
```
Identifier actifs concernés → Bloquer nouveaux signaux
    → Alerter positions ouvertes → LLM résume l'événement → Notifier
```

**Workflow 5 — Scraping BRVM (18:30 UTC après clôture)**
```
Scraper brvm.org → Normaliser données → Insérer TimescaleDB
    → Calcul indicateurs BRVM → Signaux pour le lendemain
```

---

## 8. Stack Technique

### Tableau de décision

| Couche | Choix | Alternative écartée | Raison |
|---|---|---|---|
| Frontend | Next.js 15 | Vue/Nuxt | Écosystème React fintech dominant |
| Style | Tailwind + shadcn | MUI / Ant Design | Flexibilité dashboard dense sur-mesure |
| Charts | TradingView LW Charts | Chart.js / D3 | Conçu pour la finance (WebGL, OHLC natif) |
| State | Zustand | Redux | Performance WebSocket — re-renders ciblés |
| Data fetching | TanStack Query | SWR | Cache + polling + retry natifs |
| API Gateway | NestJS (TypeScript) | Express | Modules = Moteurs, DI natif, WS intégré |
| Auth | JWT + Guards NestJS | Sessions | Stateless, scalable |
| Quant Engine | Python 3.12 + FastAPI | Node.js seul | pandas/ta-lib/vectorbt inexistants en Node |
| Indicateurs | pandas-ta + ta-lib | lib npm | 150+ indicateurs, auditables, fiables |
| Data manip | pandas + numpy | — | Standard industrie data/finance |
| Backtesting | vectorbt | backtrader | Vectorisé, 1000× plus rapide |
| ML | scikit-learn | — | Détection régime, scoring adaptatif |
| Base données | PostgreSQL 16 | MongoDB | ACID + TimescaleDB + pgvector |
| Time Series | TimescaleDB | InfluxDB | Extension Postgres, requêtes SQL standard |
| Vectoriel | pgvector | Qdrant | Pas de service séparé au MVP |
| ORM | Prisma | TypeORM | Type-safety totale + migrations robustes |
| Cache | Redis 7 | Memcached | Structures de données, Pub/Sub, streams |
| Queue | BullMQ | RabbitMQ | Stack unifiée Redis, monitoring Bull Board |
| Monorepo | Turborepo | Nx | Simplicité + cache builds remote |
| Langage | TypeScript (tout) | JavaScript | Bugs silencieux = pertes financières |
| Containers | Docker + Compose | — | Environnement identique dev/prod |
| CI/CD | GitHub Actions | — | Tests + build + deploy automatisés |
| Hébergement | Hetzner VPS 20€/mois | AWS dès le début | Sur-dimensionné et coûteux pour MVP |
| LLM | OpenAI GPT-4o | Hardcodé | Abstrait = swappable sans toucher au code |

### Structure Monorepo

```
trading-os/
├── apps/
│   ├── web/          → Next.js 15 (TypeScript)
│   ├── api/          → NestJS (TypeScript)
│   └── engine/       → FastAPI (Python)
├── packages/
│   ├── shared/       → Types TypeScript partagés (Signal, Asset, Trade, Candle...)
│   └── ui/           → Composants React réutilisables (charts, tables, cards)
├── docker-compose.yml
├── turbo.json
└── package.json
```

### Communication Inter-Services

```typescript
// NestJS → Python Engine
const result = await this.httpService.post(
  'http://engine:8000/analyze',
  { symbol: 'SONATEL', strategy_id: 'tkl-v1', timeframe: '1d' }
).toPromise()
```

```python
# Python Engine → NestJS (via Redis Pub/Sub)
@router.post("/analyze")
async def analyze(req: AnalyzeRequest) -> SignalResponse:
    candles    = await market.fetch_ohlcv(req.symbol, req.timeframe)
    indicators = compute_indicators(candles)
    regime     = detect_regime(indicators)
    signal     = strategy_engine.evaluate(indicators, regime, req.strategy_id)
    await redis.publish(f"signals:{req.user_id}", signal.json())
    return SignalResponse(**signal.dict())
```

```typescript
// NestJS → Frontend (WebSocket temps réel)
this.redisClient.subscribe(`signals:${userId}`, (signal) => {
  client.emit('new_signal', signal)
})
```

---

## 9. Architecture Système

```
┌─────────────────────────────────────────────────────────────┐
│                       FRONTEND                              │
│         Next.js 15 — TypeScript — Tailwind + shadcn         │
│  Dashboard · Scanner · Portfolio · Strategies · Journal     │
│  Backtests · Assistant IA · Settings                        │
│  TradingView Charts · Zustand · TanStack Query              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                   NestJS API GATEWAY                        │
│  AuthModule · UsersModule · PortfolioModule · TradesModule  │
│  AssetsModule · SignalsModule · StrategiesModule            │
│  NotificationsModule · AIModule · BacktestModule            │
│  WebSocket Gateway ←→ Redis Pub/Sub                         │
└────┬───────────────┬──────────────┬───────────────────────┬─┘
     │               │              │                       │
     ▼               ▼              ▼                       ▼
PostgreSQL 16      Redis 7       BullMQ              pgvector
+ TimescaleDB      Cache         Workflows           RAG store
+ pgvector         Sessions      CRON Jobs
(données)          Pub/Sub       Retry/DLQ
     │
     └─────────────────────────────────────────┐
                                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  Python FastAPI ENGINE                       │
│  /analyze     → évaluer stratégie sur actif                 │
│  /indicators  → calculer indicateurs                        │
│  /regime      → détecter régime de marché                   │
│  /backtest    → simuler stratégie sur historique            │
│  /explain     → explication LLM d'un signal                 │
│  /rag/query   → recherche vectorielle + LLM                 │
│                                                              │
│  MarketConnectors  : Binance · AV · Deriv · BRVM · Yahoo   │
│  IndicatorsEngine  : pandas-ta (150+ indicateurs)           │
│  StrategyEngine    : évaluation règles JSON                  │
│  RiskEngine        : sizing + calendar + exposition          │
│  BacktestEngine    : vectorbt                               │
│  RegimeDetector    : scikit-learn GMM                       │
│  LLMLayer          : OpenAI GPT-4o (abstrait)               │
│  RAGEngine         : LangChain + pgvector                    │
└──────────────────────────────────────────────────────────────┘
                           │
      ┌────────────────────┼───────────────────────┐
      ▼                    ▼                       ▼
 Binance API          Alpha Vantage           Deriv API (V75)
 Crypto               Forex / US              Synthetic
      │                    │                       │
      ▼                    ▼                       ▼
 NewsAPI              BRVM Scraper          Economic Calendar
 Sentiment            brvm.org              Forex Factory
      │
      ▼
 OpenAI API (LLM + Embeddings)
```

---

## 10. Schéma Base de Données

```sql
-- Utilisateurs
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  plan          TEXT DEFAULT 'free',   -- free | starter | pro | fund
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Marchés
CREATE TABLE markets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,    -- BRVM | FOREX | CRYPTO | SYNTHETIC
  timezone   TEXT,
  open_time  TIME,
  close_time TIME
);

-- Actifs
CREATE TABLE assets (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol    TEXT NOT NULL,    -- SONATEL | BTC/USDT | EUR/USD | V75
  name      TEXT NOT NULL,
  market_id UUID REFERENCES markets(id),
  sector    TEXT,             -- telecom | agro_cacao | bank | crypto | synthetic
  currency  TEXT,             -- XOF | USDT | USD
  active    BOOLEAN DEFAULT true,
  UNIQUE(symbol, market_id)
);

-- Bougies OHLCV (TimescaleDB hypertable)
CREATE TABLE candles (
  time      TIMESTAMPTZ      NOT NULL,
  symbol    TEXT             NOT NULL,
  timeframe TEXT             NOT NULL,  -- 1m | 5m | 1h | 4h | 1d | 1w
  open      NUMERIC(20, 8)  NOT NULL,
  high      NUMERIC(20, 8)  NOT NULL,
  low       NUMERIC(20, 8)  NOT NULL,
  close     NUMERIC(20, 8)  NOT NULL,
  volume    NUMERIC(30, 8)  NOT NULL,
  PRIMARY KEY (time, symbol, timeframe)
);
SELECT create_hypertable('candles', 'time');
CREATE INDEX ON candles (symbol, timeframe, time DESC);

-- Stratégies
CREATE TABLE strategies (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    REFERENCES users(id),
  name        TEXT    NOT NULL,
  markets     TEXT[],             -- ['BRVM', 'CRYPTO']
  regimes     TEXT[],             -- ['trending_bull', 'any']
  timeframes  TEXT[],             -- ['1h', '4h', '1d']
  rules       JSONB   NOT NULL,   -- conditions + logic + signal
  risk_params JSONB   NOT NULL,   -- stop_atr_multiplier, tp_rr_ratio, max_risk_pct
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Signaux générés
CREATE TABLE signals (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol       TEXT    NOT NULL,
  timeframe    TEXT    NOT NULL,
  strategy_id  UUID    REFERENCES strategies(id),
  signal_type  TEXT    NOT NULL,   -- BUY | SELL | WATCH | NEUTRAL | BLOCKED
  confidence   NUMERIC(5, 2),      -- 0 à 100
  regime       TEXT,
  indicators   JSONB,              -- snapshot indicateurs au moment du signal
  risk_data    JSONB,              -- stop_loss, take_profit, position_size
  explanation  TEXT,               -- texte LLM
  block_reason TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

-- Portefeuilles
CREATE TABLE portfolios (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID    REFERENCES users(id),
  name            TEXT    NOT NULL,
  mode            TEXT    DEFAULT 'paper',  -- paper | live
  currency        TEXT    DEFAULT 'USDT',
  initial_capital NUMERIC(20, 2),
  cash            NUMERIC(20, 2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Positions
CREATE TABLE positions (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID    REFERENCES portfolios(id),
  asset_id     UUID    REFERENCES assets(id),
  signal_id    UUID    REFERENCES signals(id),
  direction    TEXT    NOT NULL,    -- LONG | SHORT
  status       TEXT    DEFAULT 'open',  -- open | closed
  quantity     NUMERIC(20, 8) NOT NULL,
  entry_price  NUMERIC(20, 8) NOT NULL,
  stop_loss    NUMERIC(20, 8),
  take_profit  NUMERIC(20, 8),
  exit_price   NUMERIC(20, 8),
  exit_reason  TEXT,                -- SL | TP | MANUAL
  pnl          NUMERIC(20, 2),
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ
);

-- Journal
CREATE TABLE journal_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  position_id UUID REFERENCES positions(id),
  notes       TEXT,
  ai_review   TEXT,
  tags        TEXT[],
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings RAG
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE embeddings (
  id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  source    TEXT    NOT NULL,    -- news | journal | report | strategy
  source_id TEXT,
  content   TEXT    NOT NULL,
  embedding vector(1536),        -- text-embedding-3-small
  metadata  JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
```

---

## 11. Contrat API

```
Auth
POST  /auth/register          Créer un compte
POST  /auth/login             Connexion → JWT
POST  /auth/refresh           Rafraîchir le token

Assets & Markets
GET   /markets                Liste des marchés
GET   /assets                 Liste actifs (filtres: market, sector, active)
GET   /assets/:symbol/candles OHLCV (params: timeframe, from, to, limit)
GET   /assets/:symbol/indicators Indicateurs calculés

Strategies
GET   /strategies             Mes stratégies
POST  /strategies             Créer une stratégie (corps JSON avec rules)
PATCH /strategies/:id         Modifier règles / paramètres
POST  /strategies/:id/backtest Lancer un backtest

Signals
GET   /signals                Signaux actifs (filtres: type, confidence, market)
GET   /signals/:id            Détail + explication LLM
POST  /signals/:id/act        Créer une position depuis un signal
POST  /signals/:id/ignore     Ignorer un signal

Portfolio
GET   /portfolios/:id         Détail + métriques (PnL, drawdown, win rate)
GET   /portfolios/:id/positions  Positions ouvertes
GET   /portfolios/:id/stats   Statistiques avancées

Positions
POST  /positions              Ouvrir manuellement
PATCH /positions/:id          Modifier SL/TP
POST  /positions/:id/close    Fermer manuellement

Journal
GET   /journal                Toutes les entrées
POST  /journal/:id/notes      Ajouter une note manuelle
GET   /journal/stats          Statistiques + analyse IA

Assistant IA
POST  /ai/explain             Expliquer un signal (body: signal_id)
POST  /ai/query               Question libre en langage naturel (RAG)
GET   /ai/weekly-report       Rapport hebdomadaire

WebSocket Events
subscribe_signals    { userId }       → Recevoir new_signal en temps réel
subscribe_portfolio  { portfolioId }  → Recevoir position_update en temps réel
```

---

## 12. Parcours Utilisateur

### Journée type — Trader actif

```
07:00  Dashboard → Résumé : X actifs analysés, Y signaux, Z forts
07:05  Cliquer sur un signal fort
       → Graphique TradingView + indicateurs + régime
       → Calcul automatique : stop, TP, taille, risque
       → Explication LLM en français
07:10  Décider : [Simuler trade] ou [Ignorer]
       → Si simuler : confirmation des paramètres risk → position créée
19:00  Bilan : positions fermées, PnL, win rate du jour
Dimanche → Rapport hebdomadaire IA reçu : forces, faiblesses, recommandations
```

### Ce que l'utilisateur ne fait plus

```
❌  Ouvrir 10 onglets TradingView
❌  Calculer manuellement la taille de position
❌  Vérifier les news avant d'entrer
❌  Parcourir 50 graphiques pour trouver un setup
❌  Oublier de placer le stop loss
❌  Trader sous émotion
❌  Perdre un setup pendant la nuit
```

### Ce qu'il fait avec le système

```
✅  Définir sa stratégie une seule fois
✅  Ouvrir l'app le matin, voir les opportunités en 2 minutes
✅  Lire l'explication IA avant de décider
✅  Cliquer "Simuler" ou "Ignorer"
✅  Consulter ses performances et apprendre
✅  Ajuster les règles selon les résultats du journal
```

---

## 13. Roadmap MVP 30 Jours

### Semaine 1 — Fondation

```
Jour 1  Bootstrap monorepo : NestJS + Next.js + FastAPI + Docker Compose
Jour 2  Auth JWT + User + Portfolio + Prisma migrations
Jour 3  Dashboard layout vide, menu, routing
Jour 4  Market Engine Python : Binance API + Alpha Vantage → premier fetch OHLCV
Jour 5  Technical Engine : EMA + RSI + ATR + Volume relatif
Jour 6  Scanner Job BullMQ (CRON 1h) → résultats TimescaleDB
Jour 7  Affichage scanner dans Dashboard → premier test end-to-end ✅
```

### Semaine 2 — Strategy Engine

```
Jour 8   Modèle Strategy en DB + interface création UI
Jour 9   Strategy Engine Python : évaluation règles JSON → premier signal
Jour 10  Détection régime (ADX + EMA200 + ATR) → filtrage stratégie/régime
Jour 11  Risk Engine : calcul stop/TP/taille + blocage calendrier news
Jour 12  Affichage signaux UI + graphique TradingView par actif
Jour 13  Notifications WebSocket temps réel (Redis Pub/Sub)
Jour 14  Test intégration complet Semaine 1+2 + corrections ✅
```

### Semaine 3 — Portfolio & Paper Trading

```
Jour 15  Portfolio Engine : Position + Trade + PnL temps réel
Jour 16  Paper Trading : ouvrir position depuis signal
Jour 17  Watcher Job (5min) : surveillance SL/TP + fermeture automatique
Jour 18  Page Portfolio : positions ouvertes + historique + métriques
Jour 19  Journal : enregistrement automatique de chaque trade
Jour 20  MACD + Bollinger Bands + Swing structure detection
Jour 21  Test end-to-end flux complet trading ✅
```

### Semaine 4 — IA & Déploiement

```
Jour 22  LLM : explication d'un signal (GPT-4o)
Jour 23  RAG : embeddings + pgvector + assistant IA (question libre)
Jour 24  Rapport hebdomadaire IA (Workflow + LLM)
Jour 25  Scraper BRVM (brvm.org) + pipeline quotidien 18h30
Jour 26  Backtest (vectorbt) → page Backtests
Jour 27  Connecteur Deriv V75 + stratégie V75 Scalp
Jour 28  Polish UI, dark mode, responsive
Jour 29  Tests, corrections, documentation
Jour 30  Déploiement Hetzner VPS + Docker Compose → premier utilisateur réel ✅
```

---

## 14. Règles Métier

```
1. Le Risk Engine peut toujours bloquer un signal — aucune exception.

2. Le Strategy Engine ne place jamais d'ordre. Il génère uniquement des signaux.

3. Aucun ordre réel sans confirmation explicite de l'utilisateur (MVP paper only).

4. Une position ne peut pas risquer plus de max_risk_pct du capital disponible.

5. Le drawdown journalier ne peut pas dépasser 3% du capital total.

6. Aucun signal n'est émis 30 minutes avant un événement High Impact calendrier.

7. Les règles de stratégie sont évaluées dynamiquement depuis la DB — jamais hardcodées.

8. Chaque trade fermé génère automatiquement une entrée dans le journal.

9. Le LLM explique les décisions passées. Il ne prédit pas l'avenir.

10. La couche technique (indicateurs) est testable indépendamment de tout le reste.

11. Chaque moteur est remplaçable sans impacter les autres (interfaces abstraites).

12. Les types TypeScript sont partagés entre API et frontend via packages/shared.
```

---

## 15. Glossaire

| Terme | Définition |
|---|---|
| **Signal** | Recommandation générée par le Strategy Engine : BUY, SELL, WATCH, NEUTRAL, BLOCKED |
| **Confiance** | Score 0–100 indiquant la force du signal selon les conditions remplies |
| **Régime** | État du marché détecté automatiquement : trending_bull, trending_bear, ranging, high_volatility, accumulation |
| **Position** | Engagement sur un actif avec entrée, stop, TP et taille définis |
| **Trade** | Cycle complet : ouverture d'une Position → fermeture (SL, TP ou manuel) |
| **PnL** | Profit and Loss — gain ou perte réalisé sur un trade ou une période |
| **Drawdown** | Perte maximale depuis le dernier sommet de capital (HWM) |
| **Paper Trading** | Simulation de trading sans argent réel — positions virtuelles en DB |
| **Stop Loss (SL)** | Niveau de prix auquel la position est fermée automatiquement pour limiter la perte |
| **Take Profit (TP)** | Niveau de prix auquel la position est fermée automatiquement pour sécuriser le gain |
| **ATR** | Average True Range — mesure de la volatilité réelle d'un actif |
| **EMA** | Exponential Moving Average — moyenne mobile exponentielle |
| **RSI** | Relative Strength Index — indicateur de momentum (0–100) |
| **MACD** | Moving Average Convergence Divergence — momentum et direction |
| **Golden Cross** | EMA20 croise EMA50 à la hausse — signal haussier |
| **Death Cross** | EMA20 croise EMA50 à la baisse — signal baissier |
| **BOS** | Break of Structure — cassure d'un niveau de structure confirmant la tendance |
| **CHoCH** | Change of Character — cassure inverse signalant un retournement potentiel |
| **SMC** | Smart Money Concepts — approche d'analyse basée sur le comportement institutionnel |
| **DCA** | Dollar Cost Averaging — investissement progressif à intervalles réguliers |
| **R:R** | Risk/Reward Ratio — rapport entre gain potentiel et perte maximale |
| **Allocation** | Pourcentage du capital investi sur un actif ou un marché |
| **BRVM** | Bourse Régionale des Valeurs Mobilières — marché boursier d'Afrique de l'Ouest |
| **V75** | Volatility Index 75 — indice synthétique Deriv à volatilité artificielle fixe |
| **Backtest** | Simulation d'une stratégie sur des données historiques pour évaluer ses performances |
| **RAG** | Retrieval-Augmented Generation — technique LLM enrichissant les réponses via recherche documentaire |
| **Embedding** | Représentation vectorielle d'un texte permettant la recherche sémantique |
| **Régime trending_bull** | Marché en tendance haussière confirmée (ADX > 25 + prix > EMA200) |
| **Régime ranging** | Marché sans tendance claire (ADX < 20) — stratégies mean reversion préférables |
| **Timescale** | Extension PostgreSQL optimisant le stockage et les requêtes de séries temporelles |
