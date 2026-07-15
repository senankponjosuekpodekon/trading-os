# Trading OS — TODO Master

> Légende : 🤖 = Cascade fait | 👤 = Toi (action externe) | ⚡ = Priorité haute | 🔁 = Récurrent

---

## Vision du projet

```
MVP (actuel)       → Signaux techniques + LLM + Paper trading
Phase A (prochain) → Enrichissement par marché : on-chain, macro, tick stats
Phase A+           → Solidifier le moteur : Swing Detection, BOS Score, Session feature, SL liquidity-aware
Phase A++          → Synthetic Market Engine + Unified Market Representation
Phase B            → ML scoring + Feature Factory + Probability Engine + feedback loop
Phase C            → Analyse asymétrique pré-listing + alpha on-chain + Backtesting scientifique (anti-overfitting)
Phase D            → Multi-agents autonomes + Market Memory System + Self-Learning + exécution réelle
Phase D+           → Trading Copilot UX (Signal vivant + Why/Why not + Timeline) + Data Pipeline scalable
```

---

## 🔑 À FAIRE PAR TOI (actions externes / comptes)

### Clés API MVP
- [ ] 👤 Créer compte **newsapi.org** (gratuit) → copier `NEWS_API_KEY` dans `.env`
  - Plan gratuit : 100 req/jour — suffisant (cache 15 min actif)
- [ ] 👤 Optionnel : créer compte **OpenAI** → `OPENAI_API_KEY` pour activer GPT-4o
  - Alternative gratuite : installer Ollama local (`ollama pull llama3.2`)
- [ ] 👤 Optionnel : créer compte **Twelve Data** → `TWELVE_DATA_API_KEY` pour Forex réel
  - Plan gratuit : 800 req/jour — https://twelvedata.com
- [ ] 👤 Optionnel : générer **DERIV_TOKEN** pour trades réels
  - App Deriv → API Token → permission : Trade, Read

### Clés API Phase A (post-déploiement)
- [ ] 👤 Créer compte **Coinglass** → `COINGLASS_API_KEY` (gratuit limité)
  - Funding rates, Open Interest, liquidations — https://coinglass.com/pricing
- [ ] 👤 Créer compte **LunarCrush** → `LUNARCRUSH_API_KEY` (500 req/jour gratuit)
  - Sentiment social crypto + stocks — https://lunarcrush.com/developers/api
- [ ] 👤 Créer compte **CryptoQuant** → `CRYPTOQUANT_API_KEY` (free tier limité)
  - Exchange flows, MVRV, SOPR, whale data — https://cryptoquant.com
- [ ] 👤 Optionnel : compte **Glassnode** → `GLASSNODE_API_KEY` (free tier)
  - On-chain BTC/ETH avancé — https://glassnode.com

### Tests manuels à faire
- [ ] 👤 Tester Auth : Register → Login → Logout → vérifier JWT
- [ ] 👤 Tester Dashboard : prix live WebSocket BTC/ETH/SOL
- [ ] 👤 Tester Scan : lancer scan 4 actifs → vérifier signaux générés
- [ ] 👤 Tester Portfolio : créer position paper → close → vérifier journal
- [ ] 👤 Tester Backtest : BTC/USDT 1h → vérifier courbe capital + métriques
- [ ] 👤 Tester BRVM : charger cours (si brvm.org répond)
- [ ] 👤 Tester Deriv : analyser V75 → signal CALL/PUT/WAIT
- [ ] 👤 Tester Chat RAG : questions SMC, RSI, risk management
- [ ] 👤 Tester Notifications SSE : vérifier stream sans 401

---

## 🤖 À FAIRE PAR CASCADE

---

### ⚡ MVP — Stabilité & Performance

- [x] 🤖 ⚡ **Cache Redis centralisé** ✅ — actuellement cache mémoire Python dans `news.py`
  - `utils/cache.py` créé avec client Redis asynchrone
  - `news.py` migré vers Redis (sentiment + articles, TTL 15min)
  - TTLs restants : klines 5min, BRVM quotes 60min, scan results 30s (à faire)

- [x] 🤖 ⚡ **Pagination API NestJS** ✅ — `/signals`, `/positions`, `/journal`
  - Ajouter `?page=&limit=&sort=` sur tous les endpoints liste

- [x] 🤖 ⚡ **Next.js optimisations** ✅
  - `staleTime: 60_000` + `refetchOnWindowFocus: false` globaux dans `Providers.tsx`
  - Lazy loading `CandlestickChart` (`chart/page.tsx`) + `MiniEquityChart` (`backtest/page.tsx`) via `dynamic()` SSR:false ✅
  - Pages Next.js (`/ai`, `/brvm`, `/deriv`) code-splitées automatiquement par route ✅

- [x] 🤖 ⚡ **Prefetch données critiques** ✅
  - `AppLayout.tsx` : prefetch `portfolios` + `signals` dès que l'user est connu
  - Cache mémoire Python dans `ws.py` pour `_last_prices` (update toutes les 3s)

- [x] 🤖 ⚡ **Vitesse signaux < 1 seconde** ✅
  - `pandas-ta` déjà utilisé pour EMA/RSI/ATR/MACD/BB
  - Fetch klines parallèle `asyncio.gather` + timeout 4s par symbole
  - `ThreadPoolExecutor(max_workers=8)` pour analyses CPU
  - Warmup background toutes les 30s → scan = lookup cache pour `ACTIVE_SYMBOLS`
  - Scraper sentiment **fire-and-forget** (non-bloquant si cache froid)
  - News API timeout 2s max

- [x] 🤖 **WebSocket stabilité** ✅
  - `useLivePrices.ts` + `useNotifications.ts` : reconnexion auto backoff exponentiel (×1.5, max 60s)
  - `/prices/latest` REST endpoint en secours si WS indisponible
  - Heartbeat implicite via reconnexion sur `onclose`/`onerror`

- [x] 🤖 **Séparation config/env** → `engine/config.py` centralisé (Pydantic Settings)

- [x] 🤖 **Index base de données**
  - Index composite `Signal(assetId, createdAt DESC)`
  - Index `Portfolio.userId`, `Position.portfolioId`, `JournalEntry(userId, createdAt)`

---

### 📦 Phase A — Enrichissement par Marché (post-déploiement)

> Objectif : chaque marché reçoit les couches de données qui lui correspondent vraiment

#### 🟠 Crypto — Couche On-Chain & Dérivés

- [ ] 🤖 **`engine/routers/onchain.py`** — Signal asymétrique crypto
  - **Fear & Greed Index** (alternative.me, gratuit, 0 clé)
    - Score < 20 → `+20 pts` confiance BUY contrarian
    - Score > 80 → `-20 pts` / signal SELL contrarian
  - **Funding Rate** (Coinglass API)
    - Funding < -0.01% → shorts surpeuplés → `+15 pts` long squeeze
    - Funding > +0.05% → longs surpeuplés → `+15 pts` short squeeze
  - **Open Interest change 24h** (Coinglass API)
    - OI ↑ + prix ↑ → trend confirmé `+10 pts`
    - OI ↑ + prix ↓ → short squeeze imminent `+15 pts`
    - OI chute brutale → liquidations → `danger flag`
  - **Exchange Net Flow** (CryptoQuant, free tier)
    - Outflows persistants 30j → accumulation → `+20 pts` asymétrique
    - Inflows spike → distribution whale → `-20 pts`
  - **MVRV Ratio** (CryptoQuant/Glassnode)
    - MVRV < 1.0 → zone d'achat historique extreme → `+30 pts`
    - MVRV > 3.5 → zone distribution → `-25 pts`
  - Endpoint : `GET /onchain/score/{symbol}` → retourne `asymmetric_score` + `signals[]`
  - Intégration dans `scan.py` : `confidence += onchain_bonus()`

- [ ] 🤖 **`engine/routers/onchain_advanced.py`** — Couches on-chain complémentaires
  - **Developer Activity** (GitHub API publique, gratuit)
    - Commits actifs derniers 30j → `developer_score`
    - 0 commits depuis 60j → `zombie_flag = True` → confidence désactivée
    - Nouveau release majeur → signal positif fondamental
  - **Smart Contract Activity** (Etherscan/Covalent API)
    - Utilisateurs uniques en hausse mais prix flat → `asymmetry_flag` Phase C
    - TVL protocole DeFi : corrélé via DefiLlama
  - **Stablecoin Flow** (CryptoQuant)
    - USDT entrant sur exchanges → pression acheteuse potentielle `+10 pts`
  - **NVT Ratio** (CryptoQuant/Glassnode)
    - NVT > 150 → surévalué réseau → `-15 pts`
    - NVT < 30 → sous-utilisé / possible rebond fondamental
  - **Whale Alert** proxy (Whale Alert API free tier)
    - Mouvement > 1000 BTC/ETH : alerte contextuelle dans le signal
    - Attention : filtrer les réorganisations internes d'exchanges

- [ ] 🤖 **`engine/routers/tokenomics.py`** — Analyse tokenomics pré-signal
  - Fetch token unlock schedule (Token Unlocks API ou CoinGecko)
  - Upcoming unlock > 20% supply dans 30j → `danger_flag = True` → signal désactivé
  - Top 10 holders > 80% → concentration flag → `confidence -= 20`
  - Endpoint : `GET /tokenomics/{symbol}` → unlock calendar + concentration score

- [ ] 🤖 **`engine/routers/social_sentiment.py`** — LunarCrush intégration
  - Galaxy Score, AltRank, social dominance, interactions/post
  - Galaxy Score > 60 + trending → `+12 pts` momentum social
  - Endpoint : `GET /social/{symbol}` → social metrics
  - Affiché dans la carte signal (frontend)

#### 🔵 Forex — Couche Macro & Calendrier

- [ ] 🤖 **`engine/scrapers/forex_calendar_scraper.py`**
  - Calendrier économique Forex Factory (NFP, CPI, FOMC, BCE)
  - Événement HIGH dans < 2h → `macro_risk = True` → scan forex suspendu
  - Événement HIGH passé → potentielle hausse volatilité post-news → flag
  - Cache DB + refresh hebdomadaire

- [ ] 🤖 **DXY momentum dans scan Forex**
  - Fetch DXY (Twelve Data) → calcul momentum 5j
  - DXY ↑ fort → renforcer signaux SELL EUR/USD, GBP/USD
  - DXY ↓ fort → renforcer signaux BUY paires majeures vs USD

- [ ] 🤖 **COT Report parser** (CFTC public, gratuit)
  - Publié chaque vendredi → positions réelles hedge funds vs commerciaux
  - Commerciaux extrêmement long + hedge funds extrêmement short → squeeze signal
  - Stocké en DB, affiché dans page Signals pour paires Forex

#### 🟤 Synthetic Markets — Phase A++ (Deriv spécifique)

> V75, Boom, Crash, Jump ne sont PAS des marchés réels — appliquer SMC/OB/On-chain dessus est une erreur fondamentale (Ch.16.5)

- [ ] 🤖 **`engine/routers/synthetic_engine.py`** — Moteur statistique pour Deriv
  - **Spike Features** :
    - `spikes_last_1000_ticks`, `avg_spike_size`, `time_since_last_spike`
    - Fréquence croissante de spikes → `spike_risk_flag`
  - **Volatility Regime** : `LOW_VOL → ACCUMULATION → VOL_EXPANSION → SPIKE_RISK`
  - **Distance aux extrêmes** : `distance_to_high = (current - last_high) / last_high` — zones d'extension
  - **Autocorrelation** : `corr(price_t, price_t-1)` — mesure si le marché a une mémoire courte
  - **Entropie** : désordre du marché → faible = plus prévisible, fort = chaos éviter
  - **Bollinger Width z-score** : compression pré-expansion (clé pour V75)
  - Endpoint : `GET /synthetic/analyze/{symbol}` → `{state, spike_probability, mean_reversion_prob, regime}`
  - **Ne jamais utiliser** : macro, on-chain, COT, MVRV sur ces actifs

- [ ] 🤖 **`engine/routers/boom_crash_model.py`** — Modèle événementiel Boom/Crash
  - Boom/Crash ≠ trend following — ce sont des événements asymétriques rares
  - Prédiction : `spike_risk_next_50_ticks` (probabilité événement extrême)
  - Features : séquence de compression de ticks + tick velocity + ATR rolling
  - Walk-forward obligatoire : ces séries peuvent sur-apprendre facilement
  - Monte Carlo simple : 1000 simulations sur séquences de ticks

- [ ] 🤖 **Séparation dans `scan.py` par type d'actif**
  - Ajouter `asset_type: CRYPTO | FOREX | SYNTHETIC | BRVM | COMMODITY`
  - Brancher pipeline différent selon le type :
    - `SYNTHETIC` → `synthetic_engine.py` (stats pures)
    - `CRYPTO` → `analyze_candles()` + `onchain.py`
    - `FOREX` → `analyze_candles()` + forex calendar
    - `BRVM` → scan BRVM + fondamentaux

#### ⚙️ Engine — Refactorisation Architecture (Phase A+)

> Solidifier les briques de base avant d'ajouter ML/Agents — cf. `recherche.md` Chapitres 2-7

- [ ] 🤖 **`engine/indicators/swing.py`** — Swing Detection Engine
  - Méthode Fractal (N bougies gauche/droite, configurable)
  - Méthode Pivot avec comptage de bougies (robuste, moins lag)
  - Méthode ATR-based (universelle multi-marché) : `movement > ATR * 1.5`
  - Détecter HH, HL, LH, LL de manière algorithmique et traçable
  - `SwingScore = (movement / ATR) + volume_factor + duration_factor`
  - **Prérequis** pour BOS/CHoCH propres — c'est le fondement manquant

- [ ] 🤖 **`bos_quality_score()` dans `price_action.py`**
  - Score 0-100 : `break_distance_atr + ADX + volume_ratio + session + news_minutes`
  - BOS interne vs BOS externe (par timeframe)
  - `bos_score < 40` → signal NEUTRAL forcé (No Trade Engine)
  - Remplace la détection binaire actuelle `bos: True/False`

- [ ] 🤖 **Feature `session` dans `scan.py`**
  - Calculer depuis UTC : Tokyo (00h-09h), London (07h-16h), New York (13h-22h)
  - Overlaps : London/NY (13h-17h) = fenêtre haute probabilité → `+8 pts`
  - Feature `minutes_after_session_open` pour le ML futur
  - Coût : ~5 lignes de code, impact significatif immédiat

- [ ] 🤖 **`displacement_ratio` dans `smc.py`** (Order Block validation)
  - `OB_valid = displacement_after / ATR > 2.0 AND volume_ratio > 1.2`
  - Tracker statut OB : `fresh / tested_once / mitigated`
  - OB mitigé → retirer de la liste des zones actives
  - Différence entre vrai OB institutionnel et zone arbitraire

- [ ] 🤖 **`SL Liquidity-aware` dans `analyze_candles()`**
  - Ne pas placer SL dans une zone EQL/EQH (zone de chasse)
  - Si `sl_computed` est dans un cluster de liquidité → décaler au-delà
  - Liquidity Stop : `sl = beyond_nearest_eql - buffer_atr * 0.3`
  - Augmente mécaniquement le WR en évitant les stop hunts

- [ ] 🤖 **TP Market-Adaptive lié à la liquidité**
  - TP1 = EQH/EQL le plus proche (si signal BUY → prochaine zone de liquidité haussière)
  - TP2 = PDH (Previous Day High) ou H4 liquidity target
  - TP3 = Zone HTF (si forte tendance)
  - Remplace les TP à `ATR × multiplicateur_fixe`

#### 🟡 BRVM — Couche Fondamentaux Entreprises

- [ ] 🤖 **`engine/scrapers/brvm_scraper.py`** — Robuste
  - Sources : brvm.org → africainvesting.com → cache DB
  - Table `brvm_daily_prices(symbol, date, open, high, low, close, volume)`
  - Cron auto à 16h30 UTC (fermeture BRVM)

- [ ] 🤖 **`engine/scrapers/brvm_fundamentals.py`** — Données entreprises
  - Scrape bfin.brvm.org : P/E, dividende, revenus, FCF, ROE
  - Table `brvm_fundamentals(symbol, pe_ratio, dividend_yield, revenue_growth, roe)`
  - Signal asymétrique BRVM :
    - P/E bas + dividende croissant + volume anormal → opportunité non pricée
    - Pas de couverture analytique institutionnelle → edge supplémentaire

#### 🟣 Deriv V75/V100 — Couche Statistique Stochastique

- [ ] 🤖 **`engine/routers/tick_stats.py`** — Analyse statistique synthétique
  - ATR rolling (7j/30j/90j) → z-score régime actuel vs historique
  - Bollinger Band width → détection compression pré-expansion
  - Standard deviation → overextension flag (> 2.5 sigma)
  - Tick velocity + accélération (Deriv WS tick stream)
  - Régimes : `LOW_VOL` / `EXPANSION` / `EXHAUSTION`
  - Signal : "compression depuis N ticks → probabilité expansion X%"
  - Monte Carlo simple : 1000 simulations → range attendu prochain mouvement

---

#### 🌐 Unified Market Representation — Phase A++ (Langage commun multi-marchés)

> Ch.16.6 : Un BOS sur USDJPY, une accumulation de baleines sur BTC, une compression V75 = même concept : changement d'état du marché. L'IA doit apprendre ce concept universel, pas les labels spécifiques.

- [ ] 🤖 **`engine/features/market_concept_layer.py`** — Concepts universels
  - Transformer les features spécifiques en concepts abstraits cross-marchés :
    - `ACCUMULATION_SCORE` : range+absorption+vol (Forex) / whale outflow (Crypto) / low variance (Synth)
    - `EXPANSION_POTENTIAL` : ATR expansion / funding+vol (Crypto) / variance expansion (Synth)
    - `LIQUIDITY_PRESSURE` : EQH/EQL/OB (Forex) / liquidation clusters (Crypto) / extreme stat zones (Synth)
    - `IMBALANCE_SCORE` : acheteurs>vendeurs (Forex) / demand>supply (Crypto) / distribution inhabituelle (Synth)
    - `MARKET_STRESS_INDEX` : volatilité + corrélations + spreads + funding + liquidations
  - Sortie : vecteur universel `{trend, accumulation, expansion_energy, liquidity_pressure, stress}` → float 0-1
  - Ce vecteur est identique pour BTC, USDJPY, V75 — comparaison cross-marché possible
  - **Prérequis du Market Memory System** : sans représentation universelle, la similarité search est aveugle

- [ ] 🤖 **`engine/features/market_embedding.py`** — Market State Vector
  - Transformer le vecteur de concepts en `embedding vector(64-128)` — identité du marché
  - Objectif : `BTC(t) ≈ USDJPY(t-90j)` si leur state vector est similaire
  - Prépare le Market Memory System (Phase D) : pgvector + cosine similarity

---

### 🧠 Phase B — Machine Learning & Feedback Loop

> Condition : 500+ signaux enregistrés avec résultats réels dans le journal

- [ ] 🤖 **`engine/ml/feature_factory.py`** — Feature Factory indépendant
  - Service séparé calculant toutes les features — consommé par ML, backtest, live, RAG
  - **Niveau 1** Raw : `price, volume, spread, bid, ask`
  - **Niveau 2** Calculées : `body_ratio, wick_ratio, ATR_percentile` (ATR vs percentile 2 ans)
  - **Niveau 3** Structurelles : `BOS_score, BOS_age, CHoCH_probability, FVG_score, OB_score`
  - **Niveau 4** Contextuelles : `session, minutes_after_open, news_distance, day_of_week, end_of_month`
  - **Niveau 5** Meta : `confluence_score, trend_maturity, trend_fatigue` (RSI+volume+momentum divergence)
  - `feature_confidence` : `{bos_score: 91, confidence: 98}` vs `{whale_score: 74, confidence: 52}`
  - **Event Features** : encoder séquences `[Compression → Sweep → CHoCH → BOS → FVG]` pour Transformer futur

- [ ] 🤖 **`engine/ml/feature_store.py`** — Stocker les features calculées
  - À chaque signal généré : sauvegarder le vecteur complet Feature Factory en DB
  - Table `signal_features(signal_id, features_json, outcome, pnl)`
  - `outcome` renseigné automatiquement quand la position se ferme
  - C'est le dataset d'entraînement pour tous les modèles futurs

- [ ] 🤖 **`engine/ml/signal_scorer.py`** — XGBoost/LightGBM
  - Input : feature vector (technique + sentiment + on-chain + macro)
  - Output : `buy_probability`, `sell_probability`, `confidence_ml`
  - Remplace progressivement le scoring manuel par marché
  - Entraînement : `POST /ml/train` → charge journal → fit modèle → sauvegarde
  - Shadow mode d'abord → comparer ML vs manuel sans risque

- [ ] 🤖 **`engine/ml/regime_classifier.py`** — Hidden Markov Model
  - Détecter régimes : Bull / Bear / Sideways / Transition
  - Par actif + par timeframe
  - Améliore le `regime.py` actuel (actuellement règles statiques)

- [ ] 🤖 **Migration pandas-ta**
  - Remplacer calculs manuels EMA/RSI/MACD/BB/ATR par `pandas-ta`
  - `df.ta.ema()`, `df.ta.rsi()`, `df.ta.macd()` etc.
  - Gain vitesse ~3-5x sur le calcul des features
  - Ouvre accès à 130+ indicateurs supplémentaires sans code

- [ ] 🤖 **Probability Engine complet** — Ch.17 (remplace le scoring linéaire actuel)
  - **Direction Engine** (pondération multi-agents) :
    - Régime 20% + Structure 25% + Liquidité 20% + Momentum 15% + Timing 10% + Macro 10%
    - Sortie : `bullish_probability: float` (pas un score brut)
  - **Séparer** `direction_probability` (marché va-t-il monter?) vs `trade_quality_probability` (ce trade est-il rentable?)
    - Ex : direction BUY 78% mais RR=0.8 → trade_quality = 45% → signal REJECTED
  - **Entry Engine** : Entry Zone (range) + Optimal Entry (point précis) basé sur OB/FVG/ATR
  - **Target Engine** : TP1/TP2/TP3 avec probabilité individuelle `{price, rr, probability}`
    - TP1 1:2 → 72%, TP2 1:4 → 46%, TP3 1:8 → 21%
  - **Trailing Intelligence Engine** : SL déplacé sur structure (nouveau HL) + momentum + probabilité
    - Si `confidence: 84% → 51%` → alerte dégradation signal
  - Métrique cible : `Expectancy = (WR × AvgWin) - (LossRate × AvgLoss)` — pas win rate seul

- [ ] 🤖 **Backtester ML** — valider edge du modèle
  - Walk-forward testing (pas de look-ahead bias)
  - Comparer ML signal vs technique seul sur historique
  - Métriques : Sharpe, win rate, profit factor, max drawdown

- [ ] 🤖 **`engine/backtest/engine.py`** — Backtesting scientifique anti-overfitting (Ch.20)
  - **Market Replay Engine** : simuler candle par candle, jamais de données futures
  - Anti-lookahead strict : `current_close > previous_swing_high` — jamais `future_high` pour BOS
  - **Séparation données** : 70% TRAIN / 20% VALIDATION / 10% TEST FINAL (intouchable)
  - Entrée ambiguë (zone touche entrée + SL même bougie) → SL en premier (conservateur)
  - Coûts réels : `{spread, commission, slippage}` configurables par marché
  - Anti-overfitting : tester plages `ADX 25-35` pas valeurs précises `ADX > 27.4`
  - **Walk-forward analysis** : Cycle 1 train 2018-2021/test 2022 → Cycle 2 train 2018-2022/test 2023 → etc.
  - **Monte Carlo** N=1000 : mélanger ordre des trades → `{ruin_probability, max_drawdown_possible, worst_R}`
  - **Survivorship Bias** : inclure actifs morts/délistés dans tests actions/crypto
  - **Data Leakage check** : feature disponible à T? Bloquer `volume_journalier_total` si calculé après T
  - **Test par régime** : ADX>30 / ADX<20 / ATR élevé / news event — modèle fonctionnel partout?
  - **Test par actif** : USDJPY 65% vs BTC 52% vs V75 72% → système apprend "ce qui marche où"
  - **Label multi-TP** : `{TP1_2R, TP2_4R, TP3_6R}` — dataset pour ML probabiliste
  - Métriques : `expectancy`, `profit_factor`, `Sharpe`, `Sortino`, `Calmar`, `max_drawdown`
  - **Calibration** : courbe — `confidence=80%` doit gagner ~80/100. Sinon Platt scaling / isotonic regression
  - **Champion Model** : pool modèles → évaluation → champion → production → remplacement si drift
  - **Concept Drift** : `FVG+BOS → continuation` peut devenir `FVG+BOS → piège` — surveillance continue

---

### 🔮 Phase C — Alpha Pré-Listing & Analyse Asymétrique Avancée

> Inspiré de l'analyse on-chain pre-ICO/presale — détecter AVANT le marché

- [ ] 🤖 **`engine/routers/presale_scanner.py`** — Détection early stage
  - Sources : CoinGecko upcoming listings, ICO Drops API, CryptoPanic nouveaux tokens
  - Critères d'éligibilité automatique :
    - Developer activity GitHub > seuil (commits actifs)
    - Audit sécurité publié → flag positif
    - Unlock schedule sain (team vesting > 1 an)
    - TVL croissant si DeFi protocol
    - Pas de concentration > 50% top 5 wallets
  - Output : `pre_listing_score` + `risk_flags[]`
  - Page dédiée "Early Alpha" dans le frontend

- [ ] 🤖 **`engine/routers/whale_tracker.py`** — Tracking smart money
  - Via Nansen API (free tier) ou Arkham Intelligence
  - Wallets labellisés "Smart Money" qui accumulent un token
  - Wallets fonds VC connus → mouvement de tokens = signal
  - Alerte : "Wallet Binance Labs accumule TOKEN depuis 7j"

- [ ] 🤖 **`engine/routers/developer_activity.py`** — Santé fondamentale
  - GitHub API publique (gratuite) → commits, contributors, releases
  - Projet avec 0 commits depuis 60j → `zombie_flag = True`
  - Nouveau release majeur → signal positif fondamental
  - Token Terminal API → protocol revenue réel

- [ ] 🤖 **`engine/routers/defi_metrics.py`** — TVL & DeFi
  - DefiLlama API (gratuite) → TVL par protocole
  - TVL ↑ 20%+ sur 30j mais token price flat → asymétrie fondamentale
  - Protocol fees / revenue → valorisation relative (P/S ratio DeFi)

---

### 🚀 Phase D — Autonomie & Multi-Agents (Vision Long Terme)

> Architecture finale : chaque marché a ses propres agents spécialisés

- [ ] 🤖 **Architecture multi-agents — 10 agents spécialisés**
  ```
  Agent 1 : Market Regime    → Bull/Bear/Range/Volatile + confidence
  Agent 2 : Structure        → BOS/CHoCH/MSS/HH/HL/LH/LL scorés
  Agent 3 : Liquidity        → EQH/EQL/Sweeps/Stop Runs + next target
  Agent 4 : Smart Money      → OB/FVG/Breakers/IFVG + institutional_alignment
  Agent 5 : Momentum         → MACD/ROC/RSI Slope/ATR Expansion
  Agent 6 : Timing           → Session/Heure/Jour/News + best_window
  Agent 7 : Macro            → FED/BCE/DXY/Taux/PMI + macro_bias
  Agent 8 : On-chain         → Whale/Exchange Flow/TVL/Smart Money (crypto)
  Agent 9 : Correlation      → DXY/VIX/Nikkei/S&P500 cross-market
  Agent 10: Risk             → RR/Drawdown/Exposition → approved + position_size
  ```
  - **Orchestrateur** : vote pondéré des agents → confiance finale
  - Poids adaptatifs : évolue selon historique de performance par actif/timeframe
  - **Devil's Advocate Agent** : cherche activement pourquoi le trade est mauvais
    - Divergences oubliées, news imminentes, corrélations défavorables, RR insuffisant
    - Si suffisamment d'arguments → réduit confiance ou bloque signal
  - **Meta-Agent** (Phase D+) : apprend quel agent est le plus fiable dans quel contexte
  - **Decision Trace** dans le signal : afficher arguments favorables + défavorables + agent le plus influent
  - Modules activés/désactivés par type d'actif :
    - Crypto → On-chain actif | Forex → Macro actif | BRVM → Fondamentaux | Deriv → Stats stochastiques

- [ ] 🤖 **`engine/agents/`** — Extraction progressive depuis `scan.py`
  - Phase immédiate : extraire `RegimeAgent` + `StructureAgent` comme modules `engine/agents/`
  - Phase B : `LiquidityAgent` + `TimingAgent` (règle-basés)
  - Phase C : `MacroAgent` + `OnChainAgent`
  - Phase D : ML sur chaque agent + Meta-Agent

- [ ] 🤖 **Exécution automatique paper → réel**
  - Mode paper → validé 3 mois → passage réel avec limite de capital
  - Deriv API → exécution automatique V75/V100 si signal confiance > 80
  - Binance API → exécution crypto si signal asymétrique confirmé

- [ ] 🤖 **Continuous learning pipeline**
  - Chaque trade clôturé → features + résultat → re-entraînement auto
  - A/B testing stratégies → sélection darwiniste des meilleurs modèles

- [ ] 🤖 **Self-Learning Market Memory Engine** — Ch.19 (différenciateur SaaS majeur)
  - **Trade Journal automatique complet** : à chaque signal, snapshot features + contexte
    - `{asset, timeframe, direction, entry, sl, tp[], probability, features_snapshot, session, macro_context}`
    - Résultat : `{WIN/LOSS, max_extension, drawdown_before_profit, reason_failure: fake_breakout / no_liquidity}`
  - **Pourquoi résultat seul insuffisant** : 2 BOS bullish peuvent avoir résultat opposé selon contexte (session, liquidité, volume)
  - **Calibration dynamique des agents** : analyser quel agent était le plus prédictif → ajuster les poids
    - Ex : sur USDJPY, Liquidity Agent 40% > Structure Agent 30% > Momentum 15%
    - Ces poids évoluent automatiquement par actif + timeframe
  - **Feedback Loop** : annoncé 80% → réel 55% → recalibrer → `80%` devient `55-60%` affiché
  - **Hybrid AI** (pas RL pur) : ML + Rules + Memory — évite les 4 pièges du RL pur
    - Peu de données (trading ≠ millions d'essais jeu vidéo)
    - Marché non stationnaire (règles du passé ≠ règles du futur)
    - Récompense retardée (plusieurs heures avant résultat)
    - Sur-optimisation (apprend passé pas futur)
  - **Market Memory Graph** : graphe `BOS → sweep → FVG fill → continuation` → révèle patterns les plus fiables

- [ ] 🤖 **Market Memory System** — pgvector (différenciateur SaaS majeur)
  - Extension pgvector sur PostgreSQL existant (zéro coût supplémentaire)
  - Vectoriser chaque signal émis : `embedding vector(128)` = features niveau 3-5
  - Similarity search cosine : trouver les N setups historiques les plus proches
  - Enrichir le signal : "Setups similaires passés : 8/10 ont atteint TP1 (78%)"
  - Mémoire par catégorie : setups, comportements par actif, réactions aux news, séquences
  - UI : onglet "Précédents analogues" dans la carte signal → fonctionnalité plan Pro
  - Architecture : `Market Data → Knowledge Graph → Feature Store → Foundation Model` (vision long terme)

- [ ] 🤖 **Signal Object vivant** — Ch.17 + Ch.21 (entité dynamique, pas snapshot statique)
  - Signal enrichi JSON :
    ```json
    {"asset": "USDJPY", "direction": "BUY", "status": "ACTIVE",
     "entry_zone": [162.10, 162.25], "optimal_entry": 162.18, "stop_loss": 161.90,
     "targets": [{"price": 162.80, "rr": 2, "probability": 72},
                  {"price": 163.40, "rr": 4, "probability": 46}],
     "confidence": 74, "invalidation_level": 161.90,
     "agents": {"structural": 91, "liquidity": 86, "timing": 73, "macro": 65}}
    ```
  - **Bouton "Pourquoi ?"** : 5 raisons scorées — Structure 91/100, Liquidité 87/100, Historique 147 cas 71% WR
  - **Bouton "Pourquoi PAS ?"** : risques — news dans 40min, volume faible, résistance proche, RR<minimum → WAIT
  - **Timeline du signal** : 10h00 74% → 10h15 prix revient zone 79% → 10h45 momentum baisse 63% → 11h30 invalidé

- [ ] 🤖 **Signal vivant** — recalcul dynamique post-émission
  - Background task Python : à chaque clôture de bougie, recalculer score des signaux `ACTIVE`
  - Alimenter `SignalLog` (déjà en DB Prisma) : `{signal_id, old_probability, new_probability, reason, ts}`
  - Signal JSON évolue : `{status: ACTIVE, probability: 68, entry_valid: true, invalidation_probability: 32}`
  - Frontend : afficher l'évolution de la probabilité dans la carte signal → confiance utilisateur accrue
  - Invalider automatiquement si `execution_score < 40` (prix trop loin de la zone d'entrée)

- [ ] 🤖 **Data Pipeline — Architecture scalable (Ch.18)**
  - MVP immédiat : Redis Streams + Celery + WebSockets (pas besoin Kafka au début)
  - Feature Store avec timestamp version : `{feature_name, value, timestamp, version}` — anti-data leakage
  - **À ne pas faire maintenant** : Kafka/Redpanda/TimescaleDB/InfluxDB — trop complexe pour MVP
  - **Monitoring Drift** : surveiller Data Drift (données changent) + Model Drift (perf baisse) + Concept Drift
  - **Délai cible** : Crypto < 500ms | Forex < 5s | Synthetic selon stratégie
  - **Model Registry** : MLflow ou W&B — versionner les modèles, savoir lequel est actif en production

---

### 📢 Notifications SSE (complétude MVP)

- [x] 🤖 **Brancher les notifications dans le flux métier**
  - `signals.service.ts` : push notif quand signal BUY/SELL confiance ≥ 70 ✅
  - `watcher.service.ts` : push notif userId quand SL/TP touché ✅
  - `journal.service.ts` : notification fusionnée avec watcher (trade fermé auto)
  - [ ] Frontend : badge compteur + toast notification dans `AppLayout`

### RAG & IA (enrichissement)

- [ ] 🤖 **Ingestion auto quotidienne RAG**
  - Tâche planifiée (FastAPI lifespan) : ingest news du jour dans pgvector à 8h UTC
  - Deduplication par hash titre avant embedding

- [ ] 🤖 **Vectoriser le journal de trading**
  - Chaque trade clôturé → embedding → ajout RAG
  - L'assistant peut répondre "quand est-ce que tu as bien tradé BTC ?"

- [ ] 🤖 **Strategy Builder Agent**
  - Endpoint `/ai/strategy/suggest` : LLM génère règles basées sur historique
  - Output JSON compatible `Strategy.rules` existant

### Scrapers

- [ ] 🤖 **`engine/scrapers/crypto_news_scraper.py`**
  - CoinDesk RSS, CryptoCompare public, Decrypt RSS
  - Fallback si NewsAPI quota épuisé

---

## �️ Qualité Produit SaaS

> Ces tâches sont **bloquantes avant mise en production**. Un SaaS financier sans elles est indéfendable.

### 🔴 Priorité 1 — Bloquant prod (avant déploiement)

#### Gestion d'erreurs
- [x] 🤖 **`GlobalExceptionFilter` NestJS** ✅
  - Intercepter toutes les exceptions non gérées
  - En prod : réponse JSON propre sans stack trace exposé
  - En dev : stack trace complet pour debug
  - Logger chaque erreur 500 avec contexte (userId, route, body)

- [x] 🤖 **Logging structuré Python Engine** ✅
  - `utils/logger.py` créé avec structlog
  - Tous les `except Exception:` dans `news_scraper.py` logguent source + erreur
  - Timeout partiel géré : les sources qui échouent ne bloquent pas les autres

- [x] 🤖 **Validation secrets au démarrage** ✅
  - `engine/config.py` centralisé (Pydantic Settings) — éliminer `os.getenv()` dispersés
  - App refuse de démarrer si `DATABASE_URL` absent
  - Warning clair si `NEWS_API_KEY`, `OPENAI_API_KEY` absents (dégradé, pas crash)

- [x] 🤖 **Timeouts stricts sur sources externes** ✅
  - `news_scraper.py` : timeout 5s par source, résultat partiel si certaines timeout
  - `watcher.service.ts` : timeout 5s + retry 3× avec backoff sur Binance
  - Circuit breaker à implémenter plus tard (Redis state)

- [x] 🤖 **Fix import `os` dans `scan.py`** ✅
  - Import `os` en haut du fichier utilisé partout
  - `aggregate_sentiment` exporté proprement depuis `news_scraper.py`

#### Sécurité
- [x] 🤖 **Rate limiting par userId** ✅
  - `UserThrottlerGuard` décode le JWT et utilise `sub` comme tracker
  - `@Throttle({ default: { limit: 10, ttl: 60_000 } })` sur `POST /signals/scan`
  - Fallback IP pour les requêtes non authentifiées

- [x] 🤖 **Sanitisation inputs texte** ✅
  - `@MaxLength()` ajouté sur Auth, Journal, Strategy, Position DTOs
  - `@ArrayMaxSize(20)` sur les tags du journal

- [x] 🤖 **Logging tentatives auth échouées** ✅
  - `AuthController.login` loggue email + IP + timestamp sur chaque échec
  - Rate limit strict déjà actif sur `POST /auth/login` (brute force protection)

- [x] 🤖 **Refresh token rotation** ✅
  - Access token 15min + Refresh token 30j stocké en DB (hash SHA-256)
  - Table `RefreshToken` liée à `User` : tokenHash, expiresAt, revokedAt, replacedBy, userAgent, ip
  - Rotation à chaque `POST /auth/refresh` : ancien token révoqué, nouveau couple émis
  - Détection de réutilisation : si token déjà remplacé est réutilisé → revoke tous les tokens du user
  - Frontend : `api.ts` interceptor 401 → `POST /auth/refresh` + retry requête originale
  - Endpoints : `/auth/refresh`, `/auth/logout`, JWT `expiresIn` passé à `15m`

### �️ Priorité 0 — Code Quality & Engineering Standards

> Ces règles s'appliquent à **tout nouveau fichier** créé dans le projet, dès maintenant.

#### Linting & Formatage
- [ ] 🤖 **ESLint strict + Prettier** — frontend
  - Règles : `@typescript-eslint/no-explicit-any`, `no-unused-vars`, `no-console` (warn)
  - `import/order` automatique avec `prettier-plugin-tailwindcss`
  - Pre-commit hook via `lint-staged` + `husky` : lint + format avant chaque commit
- [ ] 🤖 **Ruff + Black** — Python engine
  - `ruff check --fix` + `black` en CI
  - Règles : `E501 max-line=100`, `F401 unused imports`, `B` (bugbear), `I` (isort)
  - Pre-commit hook Python : `ruff + black` avant commit

#### Modularité & Architecture
- [ ] 🤖 **Barrel exports** dans chaque dossier `components/`, `hooks/`, `lib/`
  - `index.ts` par dossier → import propre `import { SignalCard } from '@/components/signals'`
- [ ] 🤖 **Séparation concerns Next.js** — règle stricte
  - `page.tsx` = layout + data fetching uniquement (< 80 lignes)
  - `components/[feature]/` = logique UI
  - `hooks/use[Feature].ts` = logique métier
  - `lib/[feature].ts` = utilitaires purs
- [ ] 🤖 **Séparation concerns Python** — règle stricte
  - `routers/` = endpoints HTTP uniquement
  - `services/` = logique métier
  - `indicators/` = calculs techniques purs
  - `agents/` = agents IA
  - `features/` = feature engineering
  - `utils/` = utilitaires (cache, http, logger)

#### Scalabilité & Performance Frontend
- [ ] 🤖 **React.memo + useMemo + useCallback** systématiques sur composants lourds
  - `SignalCard`, `CandlestickChart`, `MarketScanner`, `PortfolioRow` : mémoïsés
  - Éviter re-renders inutiles sur mise à jour des prix live (store Zustand selector granulaire)
- [ ] 🤖 **Zustand selectors atomiques** — ne pas souscrire au store entier
  - `const price = useTradingStore(s => s.prices['BTC/USDT'])` au lieu de `s => s`
  - Empêche re-render de tout composant quand un seul prix change
- [ ] 🤖 **Virtualisation listes longues** — `@tanstack/react-virtual`
  - Page Signaux (200+ signaux) → liste virtualisée
  - Page Journal (historique long) → virtualisée
  - Page BRVM "Tous les titres" → déjà `max-h` mais doit être virtualisée
- [ ] 🤖 **Code splitting par route** — déjà partiel, compléter
  - Toutes les pages lourdes : `dynamic(() => import(...), { ssr: false, loading: () => <Skeleton/> })`
  - Cibler : `chart/`, `backtest/`, `ai/`, `deriv/`, futures : `scanner/`, `copilot/`, `memory/`
- [ ] 🤖 **Image optimization** — `next/image` obligatoire, pas de `<img>` natif

#### Scalabilité & Performance Python Engine
- [ ] 🤖 **Semaphores par source API** — éviter burst et 429
  - Binance : `asyncio.Semaphore(10)` — rapide, gratuit
  - TwelveData : `asyncio.Semaphore(1)` — 1 req/s plan gratuit
  - Glassnode/CryptoQuant : `asyncio.Semaphore(2)`
- [ ] 🤖 **TTL Redis par catégorie** — revue et standardisation
  - Klines Binance : 60s | Klines TwelveData : 300s | Features calculées : 30s
  - On-chain : 300s | Sentiment news : 900s | BRVM quotes : 3600s
  - Scan results : 30s | Fear & Greed : 3600s
- [ ] 🤖 **Circuit breaker par source externe**
  - Si source échoue 3× en 60s → skip automatique pendant 5min
  - Logger + alerte interne → évite cascade d'erreurs en production
- [ ] 🤖 **Pagination côté Python Engine** sur tous les endpoints liste
  - `GET /signals?page=1&limit=50`, `GET /scan/history?limit=100`
  - Jamais retourner de liste non bornée

#### Responsivité
- [ ] 🤖 **Breakpoints Tailwind standardisés** — `sm:640 md:768 lg:1024 xl:1280`
  - Chaque nouvelle page doit être validée sur : 375px (iPhone SE), 768px (iPad), 1280px (desktop)
  - Règle : tester mobile **en premier** (Mobile First)
- [ ] 🤖 **Touch targets ≥ 44px** sur mobile — boutons, liens, onglets
- [ ] 🤖 **Tableaux → Cards automatique** sur `< 768px` — pattern existant à étendre aux nouvelles pages
  - Scanner page, Copilot page, Memory page : cards sur mobile

#### Gestion efficace des ressources
- [ ] 🤖 **Cleanup systématique des effets React**
  - Tout `useEffect` avec WS/interval/timeout : `return () => cleanup()`
  - `TradingStoreProvider.tsx` : pattern déjà bon → à dupliquer partout
- [ ] 🤖 **AbortController sur fetch** — annuler les requêtes si composant démonté
  - `useEffect(() => { const ctrl = new AbortController(); fetch(url, { signal: ctrl.signal }); return () => ctrl.abort(); })`
- [ ] 🤖 **Fermeture propre des connexions Python**
  - WS Deriv : `on_disconnect` handler → cleanup subscriptions
  - Pools asyncio : bounded `ThreadPoolExecutor` avec shutdown sur SIGTERM
- [ ] 🤖 **Limiter le volume de données WebSocket**
  - Ne pusher que les diffs (`{symbol, price, delta}`) pas les objets complets
  - Batch updates : regrouper les updates de prix toutes les 500ms côté serveur

#### Chargement & Vitesse
- [ ] 🤖 **Skeleton loaders sur toutes les nouvelles pages** — pas de flash blanc
  - Pattern : `if (loading) return <PageSkeleton />` avant tout render
- [ ] 🤖 **Optimistic UI** sur mutations critiques
  - Ouvrir/fermer position : UI update immédiat, rollback si erreur
  - Lancer scan : spinner inline sur le bouton, pas de page freeze
- [ ] 🤖 **Prefetch intelligent** — charger les données probables avant navigation
  - Hover sur "Chart" → prefetch klines de l'actif sélectionné
  - Hover sur signal → prefetch détails du signal
- [ ] 🤖 **SWR / TanStack Query staleTime par type de donnée**
  - Prix live : `staleTime: 0` (toujours frais via WS)
  - Signaux : `staleTime: 30_000`
  - Historique backtest : `staleTime: 300_000`
  - Données BRVM : `staleTime: 3_600_000`

### 🔐 Sécurité avancée

> Ce qui est ✅ = déjà fait. Le reste est à implémenter avant mise en production.

#### API & Réseau
- [ ] 🤖 **Helmet.js** — headers HTTP sécurisés (NestJS)
  - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`
  - `Content-Security-Policy` strict : bloquer inline scripts non autorisés
- [ ] 🤖 **CORS strict** — whitelist domaines uniquement
  - Dev : `localhost:3000` | Prod : domaine SaaS uniquement (pas `origin: *`)
- [ ] 🤖 **Protection CSRF** — routes mutantes (POST/PUT/DELETE)
  - Double-submit cookie pattern ou `csurf` middleware NestJS
  - Frontend : header `X-Requested-With` sur toutes les mutations
- [ ] 🤖 **Protection XSS** — sanitiser sorties affichées
  - `sanitize-html` / `dompurify` sur champs libres (journal, notes user)
  - `dangerouslySetInnerHTML` interdit sans sanitisation dans Next.js
- [ ] 🤖 **Vigilance `prisma.$queryRaw`** — SQL Injection
  - Toujours utiliser `Prisma.sql` template tag, jamais interpolation directe
- [ ] 🤖 **Variables d'environnement** — audit complet
  - `.env.example` à jour avec toutes les clés documentées (sans valeurs réelles)
  - En production : secrets manager (Doppler / GitHub Secrets / Vault)
  - Jamais de secret dans code source, logs ou réponses API
- [ ] 🤖 **HTTPS obligatoire en production**
  - Nginx : redirect HTTP → HTTPS automatique
  - `HSTS` via Helmet + Nginx | Certificats Let's Encrypt auto-renouvelés (certbot)

#### Authentification & Autorisation
- [x] 🤖 **JWT + Refresh token rotation** ✅
- [x] 🤖 **Rate limiting brute force** ✅ (10 req/min sur `/auth/login`)
- [ ] 🤖 **2FA TOTP**
  - `speakeasy` (Node) → QR code + vérification 6 chiffres
  - 10 backup codes à usage unique, hashés en DB
  - Obligatoire si compte avec trades réels
- [ ] 🤖 **Row Level Security (RLS) — PostgreSQL**
  - Isolation des données user au niveau DB (pas uniquement ORM) — critique multi-tenant
  - Tables concernées : `signals`, `positions`, `journal_entries`, `strategies`, `portfolios`
  - Policy : `USING (user_id = current_setting('app.current_user_id')::uuid)`
- [ ] 🤖 **Scopes d'autorisation par plan**
  - Middleware NestJS `@RequiresPlan('pro')` sur routes avancées (on-chain, synthetic, memory)
  - Vérification plan en DB (pas dans le JWT — évite tokens périmés)

#### Données sensibles
- [ ] 🤖 **Chiffrement données sensibles en DB**
  - Tokens Deriv / clés API stockées par user → `AES-256-GCM` avant insert
  - Clé de chiffrement dans `.env` uniquement (jamais en DB)
- [ ] 🤖 **Logs sans données sensibles**
  - Masquer emails, IPs, tokens dans tous les logs structurés
  - Pattern : `{userId: '***', action: 'login'}` — jamais email en clair

---

### 🚨 Error Handling systématique

> Objectif : zéro erreur silencieuse, zéro crash non géré, toujours un message utilisateur utile.

#### Backend NestJS
- [x] 🤖 **Global exception filter** ✅ — `AllExceptionsFilter`
- [ ] 🤖 **Codes d'erreur internes standardisés** — réponse JSON uniforme
  ```json
  { "statusCode": 400, "error": "VALIDATION_FAILED",
    "message": "confidence must be a number", "timestamp": "...", "path": "/signals" }
  ```
  - Codes : `AUTH_INVALID_TOKEN`, `PLAN_LIMIT_EXCEEDED`, `SIGNAL_NOT_FOUND`, `RATE_LIMITED`
  - Frontend mappe les codes → messages sans parser le texte brut
- [ ] 🤖 **`ValidationPipe` global strict**
  - `whitelist: true` (strip champs inconnus) + `forbidNonWhitelisted: true`
  - `@IsEnum()`, `@IsNumber({ min: 0, max: 100 })` sur chaque DTO nouveau
- [ ] 🤖 **Timeout sur toutes les requêtes Prisma**
  - `prisma.$transaction([...], { timeout: 5000 })` — évite locks infinis
- [ ] 🤖 **Sentry / Glitchtip** — monitoring erreurs production
  - Alertes sur erreurs 500 répétées, timeouts récurrents
  - `@sentry/nestjs` + `sentry-sdk` Python (ou Glitchtip self-hosted)

#### Engine Python
- [ ] 🤖 **Structured error responses** — toujours `{success, data, error}` en JSON
  ```python
  return {"success": False, "error": "BINANCE_RATE_LIMIT", "retry_after": 60}
  ```
- [ ] 🤖 **Exception hierarchy** — classes d'erreur par domaine
  ```python
  class DataSourceError(Exception): ...
  class BinanceError(DataSourceError): ...
  class RateLimitError(DataSourceError): ...
  ```
  - Catcher sélectivement — jamais `except Exception` aveugle sans log
- [ ] 🤖 **Dead Letter Queue pour tâches background**
  - Tâche échouée → retry 3× → log + alerte → DLQ
  - Évite perte silencieuse de résolutions d'outcomes (`resolveOutcomes`)

#### Frontend Next.js
- [ ] 🤖 **Error boundaries par section** — pas seulement global
  - `<ErrorBoundary>` local sur Scanner, Chart, Copilot, OnChain, Memory
  - Fallback par widget — un composant cassé ne crashe pas toute la page
- [ ] 🤖 **Toast notifications d'erreur** — feedback utilisateur immédiat
  - Mutation qui échoue → toast rouge | WS perdu → toast jaune "Reconnexion..."
  - Hook centralisé `useToast()` + `<Toaster>` dans layout
- [ ] 🤖 **Empty states sur toutes les pages**
  - Jamais de liste vide sans message : icône + texte + bouton d'action
  - "Aucun signal détecté — Lancer un scan" | "Aucune position ouverte"

---

### 🔔 Notifications — Système complet

> Actuellement : SSE basique sur signaux + SL/TP. Objectif : multi-canal, intelligent, non-intrusif.

#### Architecture
- [ ] 🤖 **`notifications` table DB**
  - Schéma : `id, userId, type, title, body, data(JSON), readAt, createdAt`
  - Types : `SIGNAL_NEW`, `SIGNAL_INVALIDATED`, `PRICE_ALERT`, `SL_HIT`, `TP_HIT`, `NEWS_HIGH_IMPACT`, `PLAN_LIMIT`, `SIGNAL_DEGRADED`
  - Endpoints : `GET /notifications?unread=true&limit=20` + `PATCH /notifications/:id/read` + `PATCH /notifications/read-all`
- [ ] 🤖 **Badge compteur non-lus dans le header**
  - Push via WebSocket existant ou polling 30s
  - `<BellIcon>` avec badge rouge animé

#### Canaux
- [x] 🤖 **SSE** ✅ — signaux + SL/TP déjà actifs
- [ ] 🤖 **Web Push (PWA)** — notification navigateur même app fermée
  - `web-push` (Node) + Service Worker Next.js
  - Permission après 1ère connexion réussie
  - Payload : `{title: "BTC BUY 82%", body: "Entrée: 104200-104500", url: "/chart/BTC"}`
- [ ] 🤖 **Telegram Bot**
  - `node-telegram-bot-api` + commandes `/alerts on|off`, `/status`
  - Lier compte via code temporaire 6 chiffres (expire 10min)
  - Format : `📈 BTC/USDT BUY | Confiance: 82% | SL: 103100 | TP1: 105800`
- [ ] 🤖 **Email**
  - `Resend API` (gratuit 3000/mois) ou `nodemailer`
  - Digest quotidien : résumé signaux + performances du jour
  - Alerte immédiate : SL touché sur position ouverte
- [ ] 🤖 **In-app Notification Center**
  - Bell dropdown chronologique + mark-as-read + lien vers signal/position concerné

#### Intelligence
- [ ] 🤖 **Filtre anti-spam** — qualité > quantité
  - Notifier seulement si `Opportunity Score > seuil_user` (configurable)
  - Max N notifications/heure par canal (1 / 3 / 5 / illimité selon plan)
  - Regroupement : 3 signaux en 30s → 1 notif groupée
- [ ] 🤖 **Page `/settings/notifications`**
  - Toggle par type + par canal + quiet hours (`from: 22:00, to: 07:00`)
  - Seuil minimum confiance pour recevoir une alerte (ex: ≥ 70%)
- [ ] 🤖 **Notification dégradation signal**
  - Confidence descend sous seuil → "⚠ Signal BTC en dégradation (58%)"
  - Signal invalidé → "❌ USDJPY BUY invalidé — structure cassée"

---

### 🗄️ Base de données — Gestion efficace

#### Index
- [ ] 🤖 **Audit et création des index manquants**
  - `signals(userId, createdAt DESC)` — queries dashboard les plus fréquentes
  - `positions(userId, status, createdAt DESC)` — portfolio queries
  - `refresh_tokens(tokenHash)` — lookup auth (unique + index)
  - `notifications(userId, readAt, createdAt DESC)` — non-lus par user
  - `market_features(symbol, timestamp DESC)` — future feature store
  - Règle : tout champ utilisé dans `WHERE` ou `ORDER BY` fréquent → index obligatoire

#### Migrations
- [ ] 🤖 **Stratégie de migration stricte** — jamais `prisma db push` en production
  - Dev : `prisma db push` OK | Staging/Prod : `prisma migrate deploy` uniquement
  - Chaque migration nommée : `add_notifications_table`, `add_signal_logs_index`
  - CI/CD : `prisma migrate deploy` automatique avant chaque déploiement
- [ ] 🤖 **Migrations backward-compatible** — zéro downtime
  - Ajouter colonne nullable d'abord → déployer code → puis `NOT NULL`
  - Jamais renommer directement : ajouter nouvelle → migrer data → supprimer ancienne

#### Connection Pooling
- [ ] 🤖 **PgBouncer** — pool de connexions
  - Sans pooler : chaque requête = 1 connexion PostgreSQL (limite ~100)
  - `transaction mode` : pool partagé tous workers — critique dès >10 users simultanés
  - Config : `max_client_conn=100`, `default_pool_size=20`
- [ ] 🤖 **`connection_limit` dans `DATABASE_URL` Prisma**
  - `?connection_limit=10&pool_timeout=10` — évite saturation sur pics

#### Performance requêtes
- [ ] 🤖 **`EXPLAIN ANALYZE`** sur les requêtes critiques avant production
  - Scanner query + dashboard stats : Seq Scan → Index Scan, objectif < 50ms
- [ ] 🤖 **Pagination curseur** sur grandes tables (préférer au `OFFSET`)
  - `WHERE id > last_cursor ORDER BY id LIMIT 50` sur `signal_logs`, `notifications`
  - `OFFSET 10000` scanne 10000 lignes inutilement
- [ ] 🤖 **Archivage automatique** — données froides
  - `signal_logs` > 6 mois → table archive / partition par trimestre
  - `notifications` lues > 30 jours → soft-delete puis purge mensuelle

#### Maintenance & Résilience
- [ ] 🤖 **Soft-delete pattern** — données utilisateur
  - Ne jamais `DELETE` physiquement positions/signaux/journal → `deletedAt: DateTime?`
  - Permet audit trail, récupération erreur, analytics complets
- [ ] 🤖 **Backup automatique** — compléter le déploiement existant
  - `pg_dump` quotidien → compressé → upload S3/Backblaze B2
  - Rétention : 7 jours glissants + 1 snapshot/semaine sur 1 mois
  - **Test de restauration mensuel** — un backup non testé n'est pas un backup
- [ ] 🤖 **Read replicas** (Phase D — forte charge)
  - Séparer lectures (analytics, memory search) des écritures
  - Prisma `replicaUrl` pour les `findMany` de reporting

---

### 🟡 Priorité 2 — Qualité prod

#### Tests — État actuel ✅
- [x] 🤖 **Tests NestJS** ✅ — 9+4+3+3 = 19 tests
- [x] 🤖 **Tests Python Engine** ✅ — 71 tests
- [x] 🤖 **Tests Next.js** ✅ — 16 tests
- **Total actuel : ~106 tests**

---

### 🧪 Tests unitaires — Stratégie complète

> Règle fondamentale : **tester le comportement, pas l'implémentation**. Un test qui casse à chaque refactoring est inutile.
> Objectif : **couverture > 80%** sur toutes les couches critiques. Priorité sur les chemins métier.

#### Philosophie & Outillage
- [ ] 🤖 **Pyramid de tests** — respecter la hiérarchie
  - 70% **Unitaires** : fonctions pures, services isolés (rapides, nombreux)
  - 20% **Intégration** : service + DB (Prisma in-memory / test DB)
  - 10% **E2E** : flux utilisateur complet (lents, peu nombreux)
- [ ] 🤖 **Coverage reporting** — activer et surveiller
  - NestJS : `jest --coverage` → rapport HTML dans `coverage/`
  - Python : `pytest --cov=. --cov-report=html`
  - Next.js : `jest --coverage`
  - **Seuil minimum** : `branches: 70, functions: 80, lines: 80` dans `jest.config`
  - CI bloque si coverage descend sous le seuil

---

#### 🐍 Python Engine — Tests à ajouter

##### `test_swing.py` — SwingDetectionEngine (à créer avec le module)
- [ ] `detect_swing_highs()` : série haussière → 3 HH détectés
- [ ] `detect_swing_lows()` : série baissière → 3 LL détectés
- [ ] `detect_bos()` : cassure confirmée = `BOS_BULL` | non-cassure = `None`
- [ ] `detect_choch()` : CHoCH après tendance baissière → renversement détecté
- [ ] `bos_quality_score()` : BOS avec fort volume → score > 70 | BOS faible → score < 40
- [ ] Série plate (range) → aucun swing détecté
- [ ] Séries trop courtes (< 10 bougies) → `None` sans crash

##### `test_synthetic_engine.py` — Synthetic Market Engine (à créer)
- [ ] `spike_features()` : 34 spikes dans 1000 ticks → `{spikes: 34, avg_size: X, time_since: Y}`
- [ ] `volatility_regime()` : ATR très bas + BB étroite → `LOW_VOL`
- [ ] `volatility_regime()` : ATR expansion → `VOL_EXPANSION`
- [ ] `volatility_regime()` : spikes fréquents → `SPIKE_RISK`
- [ ] `autocorrelation()` : série avec forte corrélation t/t-1 → valeur > 0.7
- [ ] `entropy()` : série aléatoire → entropie haute | série structurée → entropie basse
- [ ] `distance_to_extreme()` : prix à -15% du haut → `-0.15`
- [ ] Actif non-synthétique passé par erreur → exception `WrongAssetTypeError`

##### `test_probability_engine.py` — Probability Engine (à créer)
- [ ] `direction_engine()` : tous agents bullish → probability > 75%
- [ ] `direction_engine()` : agents mixtes → probability 45-55%
- [ ] `trade_quality_probability()` : direction 78% + RR 0.8 → quality < 50% → REJECTED
- [ ] `trade_quality_probability()` : direction 65% + RR 4.0 → quality > 60% → ACCEPTED
- [ ] `entry_zone()` : OB + FVG proches → zone cohérente sans contradiction
- [ ] `tp_targets()` : 3 niveaux retournés avec `{price, rr, probability}` chacun
- [ ] `tp_targets()` : probabilité TP3 < probabilité TP1 toujours
- [ ] `trailing_sl()` : nouveau HL créé → SL mis à jour sous nouveau HL

##### `test_feature_factory.py` — Feature Factory (à créer)
- [ ] `compute_level1()` : OHLCV → features brutes correctes (body_ratio, wick_ratio)
- [ ] `compute_level2()` : ATR percentile calculé sur 252 bougies historiques
- [ ] `compute_level3()` : BOS détecté → `bos_score > 0` | pas de BOS → `bos_score = 0`
- [ ] `compute_level4()` : timestamp 10h30 London → `session = "LONDON"`, `session_score > 0`
- [ ] Anti-lookahead : aucun feature de niveau 4 n'utilise de données après le timestamp
- [ ] `feature_vector()` : retourne dict avec exactement les N features attendus (pas de clé manquante)

##### `test_market_concept_layer.py` — Unified Market Representation (à créer)
- [ ] `accumulation_score()` Forex : range + absorption + volume → score > 70
- [ ] `accumulation_score()` Crypto : whale outflow + exchange reserve baisse → score > 70
- [ ] `accumulation_score()` Synthetic : low variance regime → score > 60
- [ ] Les 3 marchés avec même contexte → scores comparables (même ordre de grandeur)
- [ ] `market_stress_index()` : funding élevé + volatilité haute + liquidations → stress > 80
- [ ] Vecteur universel : toutes les clés présentes (`trend, accumulation, expansion_energy, liquidity_pressure, stress`)
- [ ] Valeurs toujours entre 0.0 et 1.0

##### `test_backtesting.py` — Backtesting Engine (à créer)
- [ ] Anti-lookahead : BOS calculé sur bougie t n'utilise jamais de données de t+1
- [ ] `market_replay()` : 100 bougies rejoué séquentiellement → état identique à live candle par candle
- [ ] SL touché avant TP dans même bougie → `LOSS` (pas `WIN`)
- [ ] Coûts appliqués : spread + commission déduits du P&L
- [ ] Walk-forward : cycle 1 test set = données inconnues du train set (pas d'overlap)
- [ ] Monte Carlo N=100 : distribution résultats non-identique à chaque run (aléatoire)
- [ ] `calibration_score()` : prédictions 80% gagnent entre 75-85% → calibration OK
- [ ] `calibration_score()` : prédictions 80% gagnent 50% → calibration FAIL

##### `test_scan.py` — Compléments (tests existants à étendre)
- [ ] `analyze_candles()` sur actif `SYNTHETIC` → pipeline synthétique appelé (pas SMC)
- [ ] `analyze_candles()` sur actif `CRYPTO` → on-chain bonus appliqué si data dispo
- [ ] `analyze_candles()` sur actif `FOREX` → macro calendar factor appliqué
- [ ] `regime_filter()` : signal BUY en régime BEAR_STRONG → `allowed = False`
- [ ] `regime_filter()` : signal NEUTRAL toujours autorisé (quelque soit le régime)
- [ ] Anti-repaint : dernière bougie non-clôturée exclue du calcul
- [ ] Cache Redis : 2ème appel identique dans le TTL → résultat identique sans re-calcul

##### `test_risk.py` — Compléments (tests existants à étendre)
- [ ] `sl_liquidity_aware()` : SL classique tombe sur zone EQL → SL décalé en-dessous
- [ ] `tp_linked_to_liquidity()` : TP1 aligné sur prochain EQH détecté
- [ ] Position size : capital 10000 + risk 1% + SL 50 pips → lot size correct
- [ ] Plafonnement : position size jamais > 5% du capital quelles que soient les entrées

---

#### 🏗️ NestJS API — Tests à ajouter

##### `signal-outcome.service.spec.ts` — SignalLog ✅ (12 tests passants)
- [x] `logSignal()` : signal NEUTRAL → aucun log créé ✅
- [x] `logSignal()` : signal BUY avec tous les champs → `signalLog.create` appelé avec les bons params ✅
- [x] `resolveOutcomes()` : TP1 atteint avant SL → outcome `WIN_TP1` ✅
- [x] `resolveOutcomes()` : SL atteint avant TP → outcome `LOSS_SL` ✅
- [x] `resolveOutcomes()` : TP2 atteint → outcome `WIN_TP2` ✅
- [x] `resolveOutcomes()` : symbole non-Binance + âge > 5j → outcome `EXPIRED` ✅
- [ ] `resolveOutcomes()` : N bougies sans résultat → outcome `EXPIRED`
- [x] `getStats()` : win rates calculés + cas vide (null) ✅
- [x] Bonus : résilience — erreur DB dans `logSignal` et erreur Binance dans `resolveOutcomes` ne cassent pas le flux ✅

##### `notifications.service.spec.ts` (à créer avec le module)
- [ ] `create()` : crée notification avec `readAt = null`
- [ ] `markAsRead()` : met à jour `readAt` avec timestamp
- [ ] `markAllRead()` : met `readAt` sur toutes les notifs non-lues du user
- [ ] `getUnread()` : retourne uniquement celles où `readAt = null`
- [ ] `shouldNotify()` filtre anti-spam : même type < 5min → `false`
- [ ] `shouldNotify()` quiet hours actives → `false`
- [ ] `shouldNotify()` `opportunityScore < seuil_user` → `false`

##### `signals.service.spec.ts` — Compléments
- [ ] `scan()` : rate limit dépassé → erreur `RATE_LIMITED` (pas 500)
- [ ] `scan()` : engine down → erreur gracieuse avec message clair
- [ ] `findAll()` : pagination curseur correcte — `lastId` retourne suite correcte
- [ ] `findAll()` : filtre `market=CRYPTO` → uniquement signaux crypto

##### `portfolios.service.spec.ts` — Compléments
- [ ] `openPosition()` : RR < 1.0 → rejeté avec erreur `RR_TOO_LOW`
- [ ] `openPosition()` : drawdown > 10% → bloqué par `DrawdownGuard`
- [ ] `openPosition()` : position déjà ouverte sur même actif → erreur `DUPLICATE_POSITION`
- [ ] `closePosition()` : position inexistante → `NotFoundException`

---

#### ⚛️ Next.js — Tests à ajouter

##### `SignalCard.spec.tsx` — Nouveau composant enrichi
- [ ] Render avec signal `ACTIVE` → badge vert visible
- [ ] Render avec signal `INVALIDATED` → badge rouge + card grisée
- [ ] `entry_zone` affichée → deux valeurs visibles (range)
- [ ] TP1/TP2/TP3 avec probabilités → 3 lignes affichées
- [ ] Clic "Pourquoi ?" → section raisons scorées s'expand
- [ ] Clic "Pourquoi PAS ?" → section risques s'expand
- [ ] `React.memo` : prix change mais signal inchangé → pas de re-render (test avec `renderCount`)

##### `useTradingStore.spec.ts` — Store Zustand
- [ ] `setPrice()` : mise à jour d'un seul symbole → autres symboles inchangés
- [ ] `fetchSignals()` : appel en cours → deuxième appel ignoré (`signalsLoading = true`)
- [ ] `fetchSignals()` : cache valide (< 30s) → pas de nouveau fetch réseau
- [ ] `fetchSignals()` : force=true → fetch même si cache valide
- [ ] `setSignals()` : met à jour `signalsFetchedAt` avec timestamp actuel

##### `useScanner.spec.ts` (à créer avec la page)
- [ ] Polling 30s : après 30s → nouveau fetch déclenché
- [ ] Filtres locaux : `market=CRYPTO` → résultats filtrés sans nouveau fetch réseau
- [ ] Tri par `Opportunity Score` → premier résultat a le score le plus élevé
- [ ] Composant démonté → polling arrêté (cleanup vérifié)

##### `SyntheticRegimeCard.spec.tsx` (à créer avec la page)
- [ ] `LOW_VOL` → couleur bleue + texte "Faible volatilité"
- [ ] `SPIKE_RISK` → couleur rouge + alerte visible
- [ ] `spike_probability = 0.78` → jauge à 78%
- [ ] Actif CRYPTO passé par erreur → message d'erreur "Marché non synthétique"

##### `MarketScanner.spec.tsx` (à créer avec la page)
- [ ] 0 résultats → empty state "Aucune opportunité détectée"
- [ ] Tri par Opportunity Score → ordre décroissant vérifié
- [ ] Filtre FOREX sélectionné → seuls les signaux FOREX affichés
- [ ] Loading state → skeleton visible (pas de flash blanc)

---

#### 🔗 Tests d'intégration — À ajouter

- [ ] 🤖 **`scan → signalLog → resolveOutcomes`** — flux complet
  - Lancer un scan → vérifier `SignalLog` créé → simuler prix → vérifier outcome mis à jour
- [ ] 🤖 **`auth → refresh → logout`** — flux token
  - Register → login → refresh → vérifier ancien token révoqué → logout → vérifier tous révoqués
- [ ] 🤖 **`openPosition → watcher → closePosition`** — flux paper trading
  - Ouvrir position BUY → simuler prix SL → vérifier position fermée + journal créé
- [ ] 🤖 **`notification → canaux`** — flux notification
  - Signal créé confiance > 70 → vérifier `notifications` table + SSE envoyé

---

#### ⚙️ CI / CD Tests
- [x] 🤖 **GitHub Actions / CI pipeline** ✅ (partiel)
  - [x] Jobs `api` / `web` / `engine` : `pytest`, `jest`, `tsc --noEmit`, `eslint` (API + web) ✅
  - [x] Build Docker en CI (job `docker`, needs api+web+engine) ✅ — non validé localement (réseau)
  - [ ] `ruff check` Python à ajouter au job engine
  - [ ] Coverage check : PR bloquée si coverage descend
- [ ] 🤖 **Test database isolée**
  - NestJS tests : `DATABASE_URL` pointe sur DB test (pas prod)
  - `beforeEach` : reset DB avec fixtures minimales
  - `afterAll` : cleanup complet
- [ ] 🤖 **Mocks standardisés**
  - `__mocks__/prisma.ts` — mock Prisma réutilisable dans tous les `.spec.ts`
  - `__mocks__/redis.ts` — mock Redis pour les tests engine
  - `fixtures/signals.ts`, `fixtures/positions.ts` — données de test réutilisables

#### Resilience
- [x] 🤖 **Retry avec backoff exponentiel + jitter** ✅
  - `apps/engine/utils/http.py` : `retry_async(max_retries=3, base_delay=0.5s, jitter ±25%)`
  - Pas de retry sur les 4xx client (sauf 429) ; backoff plus long sur 429
  - Binance klines (`scan.py`) : retry 3× sur erreurs HTTP/timeout/connexion
  - Twelve Data (`scan.py`) : retry 2×, sémaphore un appel à la fois pour éviter le 429
  - Binance live prices (`ws.py`) : retry 3× idem ; fix paramètre `symbols` sans espaces (évitait le 400)
  - NestJS Watcher (`watcher.service.ts`) : `retryWithBackoff()` 3× avec délai exponentiel

- [x] 🤖 **CRON scan automatique** — signaux sans intervention manuelle
  - `@Cron('0 6 * * *')` NestJS → scan de tous les actifs actifs à 6h UTC
  - `@Cron('0 */4 * * *')` → re-scan toutes les 4h
  - Notification SSE globale si signal confiance ≥ 70%

### 🟠 Priorité 3 — Performance & UX

#### Vitesse chargement Next.js
- [x] 🤖 **QueryClient global optimisé** ✅
  - `refetchOnWindowFocus: false` global
  - `retry: 1` et `gcTime: 5min`
  - `staleTime` par défaut 1min (peut être affiné par hook)

- [x] 🤖 **Lazy loading composants lourds** ✅
  - `Chart` → `CandlestickChart` dynamic import `ssr: false`
  - `BacktestChart` → `MiniEquityChart` dynamic import
  - `AiChat` → à faire quand composant extrait

- [x] 🤖 **Loading skeletons** ✅ (partiel)
  - Dashboard : `SkeletonCard` sur les stat cards
  - Chart : placeholder pendant chargement du graphique
  - Backtest : skeleton sur la courbe d'équité

- [x] 🤖 **Error boundaries React** ✅
  - `<ErrorBoundary>` global dans `Providers.tsx` — une erreur composant ne crashe pas tout
  - Fallback UI : "Erreur de chargement — Réessayer"

#### Vitesse signaux < 1 seconde
- [x] 🤖 **Migration pandas-ta** ✅
  - `ema()`, `rsi()`, `macd()`, `bollinger()`, `atr()` migrés vers `pandas-ta`
  - 25 tests engine passent
  - Ouvre accès 130+ indicateurs additionnels sans code

- [x] 🤖 **Pré-calcul features en background** ✅
  - Tâche FastAPI lifespan : recalcul features toutes les 30s sur actifs actifs
  - Cache Redis : features précalculées → scan devient un simple lookup
  - Mesuré : scan < 15ms quand cache hit (vs 3-5s avant)

#### Responsivité mobile
- [x] 🤖 **Tables → Cards sur mobile** ✅
  - Portfolio : positions ouvertes + historique en cards mobile
  - Signals : déjà en cards responsive
  - Journal : cards existants + formulaire responsive
  - Backtest : trades en cards mobile

- [x] 🤖 **Navigation mobile** ✅
  - Bottom navigation bar sur mobile (Dashboard, Signals, Portfolio, IA)
  - Sidebar masquée sur `<768px`
  - Padding main ajusté pour mobile

- [x] 🤖 **Charts adaptatifs** ✅
  - Chart TradingView : hauteur 320px mobile / 500px desktop
  - Contrôles : scroll horizontal sur petit écran
  - Sélecteurs `shrink-0` pour éviter le wrapping

### 🔵 Priorité 4 — SaaS Readiness (post-déploiement)

- [ ] 🤖 **Plans & abonnements**
  - Table `plans` + `subscriptions` en DB
  - Plans : Free | Starter 19$/mois | Pro 49$/mois | Fund 199$/mois
  - Features par plan : nombre scans/h, marchés accessibles, presale scanner (Pro+)
  - Stripe intégration : `POST /billing/checkout`, webhooks paiement

- [x] 🤖 **Refresh token rotation** ✅ — déjà implémenté (voir section Sécurité MVP)

- [ ] 🤖 **Audit trail**
  - Table `audit_logs(userId, action, entity, entityId, metadata, timestamp)`
  - Logger : login, open/close position, strategy change, backtest lancé
  - Endpoint admin : `GET /admin/audit-logs`

- [ ] 🤖 **2FA TOTP**
  - Optionnel MVP, obligatoire si compte avec trades réels
  - `speakeasy` (Node) → QR code → vérification code 6 chiffres

---

## �🚀 Déploiement (priorité)

- [ ] 👤 Louer VPS Hetzner (CX21 min — 2 vCPU, 4GB RAM, 40GB SSD)
  - Région : Nuremberg ou Helsinki
  - OS : Ubuntu 24.04 LTS
- [ ] 👤 Pointer domaine DNS → IP VPS
- [ ] 🤖 `docker-compose.prod.yml` avec tous les services
- [ ] 🤖 `Dockerfile` NestJS API + Next.js Web
- [ ] 🤖 Nginx reverse proxy + SSL Let's Encrypt
- [ ] 🤖 Script `deploy.sh` (pull → build → restart)
- [ ] 🤖 Health checks Docker Compose
- [ ] 🤖 Backup automatique PostgreSQL (pg_dump cron quotidien)
- [ ] 👤 Configurer secrets GitHub pour CI/CD optionnel

---

## 📊 Features UX (post-déploiement)

- [ ] 🤖 **Alertes prix** — notif SSE + email quand prix cible atteint
- [ ] 🤖 **Multi-compte** — plusieurs portfolios par user
- [ ] 🤖 **Export CSV/PDF** — journal + rapport performance
- [ ] 🤖 **Calendrier économique** — page dédiée FOMC, NFP, CPI, BRVM events
- [ ] 🤖 **Page "Early Alpha"** — presale scanner + on-chain asymétrique
- [ ] 🤖 **Heatmap marchés** — vue globale état on-chain par actif
- [ ] 👤 **Application mobile** — React Native ou PWA (futur)

### 🗺️ Nouvelles Pages & Composants — Carte complète

> Chaque page suit le pattern : `page.tsx` (< 80 lignes) + `components/[feature]/` + `hooks/use[Feature].ts`
> Chaque page : skeleton loader + error boundary + responsive mobile first + dynamic import si lourde

#### Phase A — Pages prioritaires (court terme)

- [ ] 🤖 **`/app/scanner/page.tsx`** — Market Scanner global
  - Vue unifiée tous marchés (Crypto, Forex, Synthetic, BRVM)
  - Composants :
    - `components/scanner/ScannerFilters.tsx` — filtres marché / timeframe / confiance
    - `components/scanner/ScannerTable.tsx` — liste triée par `Opportunity Score` (virtualisée)
    - `components/scanner/ScannerCard.tsx` — version card mobile du row
    - `components/scanner/MarketGroupTabs.tsx` — onglets CRYPTO / FOREX / SYNTHETIC / BRVM
  - Hook : `hooks/useScanner.ts` — fetch + polling 30s + filtres locaux
  - Performance : `React.memo` sur `ScannerCard`, pagination virtualisée `@tanstack/react-virtual`

- [ ] 🤖 **`/app/synthetic/page.tsx`** — Synthetic Markets (Deriv V75/Boom/Crash)
  - Composants :
    - `components/synthetic/SyntheticRegimeCard.tsx` — état `LOW_VOL / EXPANSION / SPIKE_RISK`
    - `components/synthetic/SpikeRiskGauge.tsx` — jauge visuelle probabilité spike
    - `components/synthetic/VolatilityTimeline.tsx` — historique régimes
    - `components/synthetic/BoomCrashAlert.tsx` — alerte événement extrême imminent
  - Hook : `hooks/useSyntheticEngine.ts` — GET `/synthetic/analyze/{symbol}`
  - **Ne pas afficher** : SMC, Order Blocks, On-chain sur cette page — pipeline différent

- [ ] 🤖 **`/app/onchain/page.tsx`** — On-Chain Dashboard Crypto
  - Composants :
    - `components/onchain/FearGreedMeter.tsx` — Fear & Greed index (existe en partie)
    - `components/onchain/FundingRateTable.tsx` — funding rates top actifs
    - `components/onchain/OpenInterestChart.tsx` — OI + liquidations
    - `components/onchain/WhaleAlertFeed.tsx` — transferts > seuil (LunarCrush/CryptoQuant)
    - `components/onchain/MVRVGauge.tsx` — MVRV Z-score zone
    - `components/onchain/ExchangeFlowCard.tsx` — entrées/sorties exchanges
  - Hook : `hooks/useOnchain.ts` — staleTime 300s

- [ ] 🤖 **`/app/economic-calendar/page.tsx`** — Calendrier économique
  - Composants :
    - `components/calendar/EventList.tsx` — NFP, CPI, FOMC, BCE triés par date/impact
    - `components/calendar/EventImpactBadge.tsx` — HIGH / MEDIUM / LOW coloré
    - `components/calendar/CountdownTimer.tsx` — "prochain event HIGH dans Xh Xmin"
    - `components/calendar/EventFilter.tsx` — filtre par devise / impact / période
  - Hook : `hooks/useEconomicCalendar.ts` — staleTime 3600s (données statiques journalières)

#### Phase A+ / A++ — Pages architecture avancée

- [ ] 🤖 **`/app/chart/[symbol]/page.tsx`** — Chart intelligent annoté (refactor du chart existant)
  - Upgrade vers route dynamique `[symbol]`
  - Composants nouveaux :
    - `components/chart/StructureAnnotations.tsx` — HH/HL/LH/LL sur le graphique
    - `components/chart/LiquidityZones.tsx` — EQH/EQL/OB/FVG layers
    - `components/chart/ScenarioProjection.tsx` — flèches `Entry → TP1 → TP2` sur chart
    - `components/chart/SignalTimeline.tsx` — timeline probabilité sous le graphique
    - `components/chart/ChartControls.tsx` — toggle par layer (structure / liquidité / niveaux)
  - Hook : `hooks/useChartAnnotations.ts` — calcule les annotations depuis signal actif

- [ ] 🤖 **Refactor `components/signals/SignalCard.tsx`** — Signal Object vivant complet
  - Remplacer la card actuelle par le format enrichi
  - Sous-composants :
    - `SignalCardHeader.tsx` — symbol + direction + status badge `ACTIVE/WAIT/APPROACHING/INVALIDATED`
    - `SignalCardEntryZone.tsx` — range zone + point optimal
    - `SignalCardTargets.tsx` — TP1/TP2/TP3 avec RR + probabilité individuelle
    - `SignalCardAgentScores.tsx` — mini barres Structure / Liquidité / Timing / Macro
    - `SignalCardWhyButton.tsx` — expand "Pourquoi ?" avec 5 raisons scorées
    - `SignalCardWhyNotButton.tsx` — expand "Pourquoi PAS ?" avec facteurs risque
    - `SignalCardProbabilityTimeline.tsx` — mini sparkline évolution confiance
  - `React.memo` obligatoire — carte re-renders uniquement si signal change

#### Phase B — Pages ML & Backtesting

- [ ] 🤖 **`/app/backtest/page.tsx`** — Backtesting Engine (upgrade de l'existant)
  - Composants nouveaux :
    - `components/backtest/WalkForwardResults.tsx` — cycles train/test avec résultats par cycle
    - `components/backtest/MonteCarloChart.tsx` — distribution 1000 simulations
    - `components/backtest/CalibrationCurve.tsx` — probabilité annoncée vs réelle
    - `components/backtest/RegimeBreakdown.tsx` — performance par régime (trend/range/volatile)
    - `components/backtest/AssetBreakdown.tsx` — performance par actif
    - `components/backtest/ChampionModelBadge.tsx` — modèle actif + version + accuracy

- [ ] 🤖 **`/app/features/page.tsx`** — Feature Factory Inspector (debug/dev)
  - Vue des features calculées en temps réel pour un actif donné
  - Composants :
    - `components/features/FeatureGrid.tsx` — grille niveau 1-5 avec valeurs actuelles
    - `components/features/MarketConceptVector.tsx` — vecteur universel `{trend, accumulation, ...}` visualisé
  - Utile pour calibration et debugging, accès réservé admin

#### Phase D — Pages autonomie & mémoire

- [ ] 🤖 **`/app/memory/page.tsx`** — Market Memory System
  - Composants :
    - `components/memory/SimilarSituationsFeed.tsx` — top 5 analogues historiques pour signal actif
    - `components/memory/MarketMemoryCard.tsx` — situation passée : asset + date + context + outcome
    - `components/memory/SimilarityScore.tsx` — badge % similarité + résultat historique
    - `components/memory/MemorySearchBar.tsx` — "Cherche des situations similaires à BTC aujourd'hui"
  - Hook : `hooks/useMarketMemory.ts` — POST `/memory/similar` → nearest neighbor search pgvector
  - Performance : résultats paginés (top 10) + `staleTime: 60_000`

- [ ] 🤖 **`/app/copilot/page.tsx`** — Trading Copilot (AI Conversation Layer)
  - Composants :
    - `components/copilot/CopilotChat.tsx` — interface conversation avec contexte marché live
    - `components/copilot/CopilotContextBar.tsx` — actif sélectionné + régime actuel visible
    - `components/copilot/CopilotSuggestions.tsx` — questions pré-définies rapides
    - `components/copilot/CopilotSignalReference.tsx` — affiche le signal référencé dans la réponse
  - Dynamic import + `ssr: false` — lourde
  - Hook : `hooks/useCopilot.ts` — stream SSE ou WebSocket vers endpoint LLM

- [ ] 🤖 **`/app/performance/page.tsx`** — Performance & Statistiques utilisateur
  - Composants :
    - `components/performance/WinRateGauge.tsx` — WR global + par marché
    - `components/performance/ExpectancyCard.tsx` — expectancy par configuration
    - `components/performance/BehaviorProfile.tsx` — "Vous coupez vos gagnants trop tôt"
    - `components/performance/BestSetups.tsx` — top setups par WR + RR (London+BOS+RR>4)
    - `components/performance/OutcomeTimeline.tsx` — WIN/LOSS/EXPIRED dans le temps

#### Composants partagés à créer (cross-pages)

- [ ] 🤖 **`components/ui/PageSkeleton.tsx`** — skeleton générique réutilisable par page
- [ ] 🤖 **`components/ui/OpportunityScore.tsx`** — affichage score étoiles + valeur numérique
- [ ] 🤖 **`components/ui/ProbabilityBar.tsx`** — barre de probabilité colorée (rouge→vert)
- [ ] 🤖 **`components/ui/RegimeBadge.tsx`** — badge `TRENDING_BULL / RANGE / VOLATILE`
- [ ] 🤖 **`components/ui/AssetTypeBadge.tsx`** — badge `CRYPTO / FOREX / SYNTHETIC / BRVM`
- [ ] 🤖 **`components/ui/ConfidenceGauge.tsx`** — gauge circulaire animée pour confidence
- [ ] 🤖 **`components/ui/RRRatioBadge.tsx`** — badge `1:2`, `1:4`, `1:8` colorés
- [ ] 🤖 **`components/ui/TimeAgo.tsx`** — "il y a 3min" avec mise à jour automatique
- [ ] 🤖 **`components/ui/LiveDot.tsx`** — point vert animé "LIVE" / rouge "OFFLINE"
- [ ] 🤖 **`components/layout/ModeToggle.tsx`** — switch Débutant / Professionnel (persisté en localStorage)

### 🎯 Trading Copilot UX — Ch.21 (Phase D+)

> Différence produit fondamentale : ne pas vendre des signaux — vendre un **copilote de décision**.

- [ ] 🤖 **Market Scanner — Ranking Engine**
  - `Opportunity Score = Probability × RR × Market_Quality × Timing`
  - 65% prob + RR 1:8 > 80% prob + RR 1:2 — logique asymétrique
  - Vue unifiée : Forex ⭐⭐⭐ | Crypto ⭐⭐⭐⭐⭐ | Synthetic ⭐⭐⭐⭐ — top 3 asymétries du jour

- [ ] 🤖 **Signal Card enrichie** — entrée zone + point optimal + TPs probabilistes
  - Afficher `entry_zone` (range) + `optimal_entry` (point) + SL + TP1/TP2/TP3 chacun avec leur RR et probabilité
  - Status badge : `ACTIVE / WAIT / APPROACHING / INVALIDATED`

- [ ] 🤖 **Graphique intelligent annoté** — TradingView Lightweight Charts
  - Annotations auto : structure HH/HL, zones EQH/EQL, OB demand, FVG, projection scénario
  - Scénario visuel : `Current price → Entry Zone → TP1 → TP2`

- [ ] 🤖 **"Pourquoi ce trade ?" + "Pourquoi PAS ?"** — AI Decision Trace
  - Bouton `Pourquoi ?` : 5 raisons scorées + historique analogues (N cas, X% WR)
  - Bouton `Pourquoi PAS ?` : facteurs risque — news imminentes, RR insuffisant, résistance proche
  - Réponse : `WAIT` si trop de facteurs négatifs

- [ ] 🤖 **Timeline du signal** — évolution probabilité en temps réel
  - Log `{timestamp, probability, reason}` à chaque recalcul
  - Affichage courbe probabilité dans la carte signal

- [ ] 🤖 **Mode débutant / professionnel**
  - Débutant : `BUY USDJPY ⭐⭐⭐⭐ | Risque: Modéré | Attendre: 162.20`
  - Pro : BOS_score 91, liquidity_swept, FVG 64% fill, Order Flow delta+, confidence 78.4%

- [ ] 🤖 **AI Conversation Layer — Market Copilot** (Ch.18 + Ch.21)
  - L'utilisateur demande : "Analyse BTC maintenant / Compare avec 2021 / Pourquoi ce signal ?"
  - L'IA utilise données live + mémoire historique + modèles — pas un chatbot classique
  - Différence produit : analyste connecté au marché en temps réel

- [ ] 🤖 **Risk Management Dashboard**
  - `{capital, risk_per_trade, daily_loss, current_exposure}`
  - Alerte corrélation : "4 positions USD corrélées → risque réel supérieur au risque apparent"
  - Profil comportemental : "Vous coupez vos gagnants trop tôt. Vos meilleurs setups : London + BOS + RR>4"

- [ ] 🤖 **Alert Engine intelligent** — max 3-5 alertes/jour haute asymétrie (pas 200 spam)
  - Canaux : Web push + Telegram + Email — filtré par `Opportunity Score > seuil`

---

## ✅ Terminé

- [x] Auth JWT (register/login/logout)
- [x] Dashboard prix live WebSocket
- [x] Scan signaux multi-actifs (EMA, RSI, MACD, BB, SMC, FVG, OB)
- [x] Price Action (swing points, BOS, CHoCH, S/R clustering)
- [x] Chart bougies + marqueurs signaux
- [x] Portfolio paper trading
- [x] Backtest (capital curve, win rate, profit factor, max drawdown)
- [x] Journal automatique
- [x] BRVM cours + signaux (scraping brvm.org)
- [x] Deriv multi-indices (17 symboles synthétiques)
- [x] Risk calculator (position sizing)
- [x] Strategies CRUD + activation (⚠️ CRUD prêt mais `scan.py` n'utilise pas encore dynamiquement les `rules` — actuellement logique fixe "EMA Trend + RSI")
- [x] Sécurité : Helmet + Throttler + CORS strict
- [x] RAG : embeddings pgvector + chat interface + 13 docs seedés
- [x] NewsAPI sentiment NLP ±10pts confiance + ingestion RAG
- [x] Notifications SSE infrastructure
- [x] LLM explications signaux + rapport hebdo (OpenAI/Ollama/mock)

---

## 📝 Notes de recherche

- **pandas-ta** : bibliothèque Python 130+ indicateurs, syntaxe `df.ta.rsi()` — remplace TA-Lib manuel, ~3-5x plus rapide, à migrer en Priorité 3
- **Vitesse signaux** : objectif < 1 seconde par actif → pré-calcul background + asyncio.gather + pandas-ta + cache Redis features
- **Analyse asymétrique on-chain** : détecter en Phase 2-3 (accumulation silencieuse) avant Phase 4-5 (attention marché). Métriques : exchange outflows, MVRV < 1, whale accumulation, developer activity, TVL growth vs prix flat
- **Par marché** : Crypto = on-chain | Forex = COT + macro calendrier | BRVM = fondamentaux entreprises + volume anormal | V75 = statistiques stochastiques + tick data
- **Sécurité SaaS financier** : rate limit par userId (pas IP), sanitisation inputs, logging auth échouées, refresh token rotation, 2FA pour trades réels
- **Tests manquants critiques** : 0 tests NestJS actuellement — auth, positions, watcher sont non testés
- **Scraper news_scraper.py** : 30 connexions parallèles → timeout strict 3s/source obligatoire avant prod
- **Circuit breaker** : si Binance/TwelveData échoue 3× → skip 5min, évite cascade d'erreurs en prod
- **Mobile** : tables → cards sur <768px, bottom nav bar, charts adaptatifs
- **SaaS plans** : Free | Starter 19$/mois | Pro 49$/mois | Fund 199$/mois — Stripe + webhooks
- **Confidence vs probabilité** : `confidence` actuel = score de règles (0-95), PAS une probabilité calibrée. Renommer `signal_score` ou calibrer via backtest. Ne jamais présenter comme "72% de chance de gagner".
- **Score architecture** : `market_score × setup_score × execution_score` = score multiplicatif cible (recherche.md Ch.5)
- **Feature Factory** : extraire tous les calculs de `scan.py` vers `engine/features/` — prerequis pour ML multi-modèles
- **Market Memory** : pgvector déjà dans le stack (RAG) → réutilisable pour similarity search sur signaux historiques
- **Signal vivant** : `SignalLog` en DB Prisma non alimenté — activer recalcul dynamique = quick win fort
- **Architecture Engine** : `scan.py` = proto-orchestrateur monolithique → extraire vers `engine/agents/` progressivement
- **SL Liquidity-aware** : SL actuel à `ATR × fixe` peut tomber en zone de chasse → décaler au-delà des EQL/EQH
- **Backtesting anti-lookahead** : toujours utiliser `current_close > previous_swing_high` jamais `future_high` pour BOS
- **Synthetic Markets** : V75/Boom/Crash ≠ marchés réels — pipeline séparé obligatoire. SMC/OB/On-chain = erreur sur ces actifs.
- **Unified Market Representation** : normaliser BOS(Forex) = whale_accumulation(Crypto) = compression(V75) = `ACCUMULATION_SCORE`
- **Probability Engine** : séparer `direction_probability` (marché) vs `trade_quality_probability` (ce trade spécifique)
- **Walk-forward** : ne jamais tester sur données d'entraînement. Cycle progressif 2018→2026. TEST FINAL intouchable.
- **Monte Carlo** : mélanger ordre des 100 trades N=1000× → ruin probability + max drawdown scenario
- **Concept Drift** : FVG+BOS peut passer de setup fiable à piège selon le régime macro — surveiller en continu
- **Trading Copilot** : vendre un copilote de décision, pas des signaux. "Pourquoi ?" + "Pourquoi PAS ?" = différenciation produit.
- **Opportunity Score** : `Probability × RR × Market_Quality × Timing` — un trade 65%/RR:8 > 80%/RR:1.5
- **Mode débutant/pro** : même moteur, deux interfaces — stratégique pour acquisition et rétention
- **MVP recommandé (Ch.22)** : USDJPY + BTC + V75 — représente Forex + Crypto + Synthetic — Rules + Stats avant ML
- **RL pur dangereux** : peu de données, non-stationnaire, reward retardé, overfitting passé → Hybrid AI obligatoire
- **Data Leakage critique** : à 10h, utiliser uniquement données disponibles avant 10h — volume journalier total interdit


## Réponses aux questions / propositions

### 1. Fear & Greed (alternative.me)
- **Fonctionne** : `https://api.alternative.me/fng/` retourne 26 = Fear.
- Endpoint engine `/scraper/fear-greed` actif : valeur + `signal` + `bonus`.

### 2. Prix actuel dans les cartes signaux
- La carte affiche déjà **Entrée** = prix de clôture au moment du signal.
- **À faire** : ajouter un prix **live** (fetch Binance toutes les 3-5s) via le WebSocket `/ws/prices` ou un endpoint REST `/prices/latest`.

### 3. Simuler un trade spécifique
- Backtest global existe (`/backtest/run`).
- **À faire** : endpoint `/signals/{id}/simulate` qui rejoue le trade d’un signal avec SL / TP1 / TP2 / timeout et renvoie PnL, R/R, drawdown.

### 4. Plus d’actifs
- **Actifs scannés actuels** : crypto majeurs, EUR/USD, GBP/USD, XAU/USD, WTI/USD.
- **À ajouter** : indices US (SPY, QQQ, DIA), forex étendu (USD/JPY, USD/CHF, USD/CAD, AUD/USD), matières premières (argent, pétrole, gaz), altcoins sélectionnés.

### 5. Comment fonctionne le backtest
- Récupère les klines historiques (Binance / Twelve Data).
- Pour chaque bougie, appelle `analyze_candles`.
- Ouvre un trade si signal ≥ 40 et confiance ≥ seuil.
- Sortie par TP (ATR×2), SL (ATR×1.5) ou timeout 24 bougies.
- Métriques : win rate, PnL total, max drawdown, Sharpe ratio, profit factor, equity curve.

### 6. Signaux d’achat / vente / décision par marché
- **BRVM** : `/brvm/signals` — ✅ actif.
- **Forex / métaux** : `/scan/multi` via Twelve Data — ✅ actif.
- **Volatility Deriv** : `/deriv/multi-analyze` — ✅ actif.
- **Stocks / indices US** : à ajouter via Twelve Data (plan payant pour grande couverture).

### 7. Types de signaux
- **Scalping** : 1m-15m, SL/TP courts, fréquence élevée.
- **Swing** : 1h-4h, SL/TP moyens, principale cible actuelle.
- **Position** : 1d, peu implémenté aujourd’hui.
- **Bon signal** : score ≥ 40, confiance ≥ 50, avec confirmation de plusieurs couches (EMA, RSI, MACD, Price Action, S/R, SMC, sentiment news).
- **Sorties** : SL, TP1, TP2, timeout, trailing stop.
- **Plusieurs TP** : déjà calculés (TP1, TP2) ; à rendre configurable par stratégie.

### 8. Création de stratégie via texte structuré
- **Proposition** : DSL JSON + LLM.
- L’utilisateur écrit une description en français, l’IA la transforme en JSON structuré (conditions d’entrée, filtres, SL/TP, timeframe).
- Le DSL est exécuté/testé par le backtest avant sauvegarde.

### 9. Templates / prompts pour créer une stratégie
- Templates prédéfinis : **Trend Following EMA**, **Mean Reversion Bollinger**, **Breakout Volatilité**, **SMC Scalp**, **RSI Divergence**.
- Prompt guidé : marché, timeframe, indicateurs, risque, SL/TP, conditions d’entrée/sortie.

### 10. Prix des actifs par marché ✅
- [x] **Page Deriv** : widget BTC/ETH/EUR/Gold live via `useLivePrices` + indicateur `LIVE`/`OFF`
- [x] **Page Signaux** : prix actuel live dans chaque carte + delta % vs entrée
- [x] **Dashboard** : grille 8 actifs live (BTC/ETH/SOL/BNB/AVAX/XRP/EUR/Gold)
- [x] **Topbar** : BTC/ETH en continu

## Priorité d’implémentation proposée

### BRVM — Spécificités actions UEMOA
- Sur BRVM/actions, les SL/TP fixes ne sont pas la norme (contrairement au Forex/Deriv).
- Les décisions d’entrée/sortie se font plutôt :
  - À la publication des rapports (trimestriel / semestriel / annuel).
  - Sur variations fortes avec volume (momentum).
  - Sur changement de tendance sectorielle.
- À étudier : adapter le modèle de signal BRVM pour rendre SL/TP optionnels et privilégier des **niveaux de sortie fondamentaux / événementiels**.

### BRVM — Rapports émetteurs
- ✅ Scraper personnalisé `brvm_reports.py` avec endpoints `/brvm/reports/*`.
- ✅ Score fondamental intégré au scan BRVM (fraîcheur des rapports).
- ✅ Onglet **Rapports** avec liste des émetteurs.
- **À faire** : clic sur un émetteur → affichage de ses PDFs téléchargeables.
- **À faire** : extraction automatique des indicateurs clés depuis les PDFs (revenus, résultat net, dividende, PER, ROE).

### Suivi des positions ouvertes
- **À faire** : quand une position est ouverte sur un actif, le système doit :
  - Re-scanner régulièrement l’actif.
  - Envoyer une alerte si le signal change (BUY → SELL/WATCH).
  - Recalculer le PnL non réalisé et l’impact du nouveau signal.
  - Notifier sur publication de rapport fondamental pour les actifs concernés.

## État MVP — Juillet 2026 ✅

### Livré — MVP complet
- [x] Prix live toutes pages (signaux, deriv, dashboard, topbar) + `/prices/latest` REST
- [x] WebSocket reconnexion auto backoff ×1.5 max 60s
- [x] `refetchOnWindowFocus: false` + `staleTime: 60s` globaux dans `Providers.tsx`
- [x] Prefetch portfolios + signaux au layout level (`AppLayout`)
- [x] Lazy loading `CandlestickChart` + `MiniEquityChart` via `dynamic()`
- [x] Pagination signaux (12/page) + portfolio historique (10/page) avec ←/→
- [x] Tableaux BRVM scrollables hauteur fixe + `thead sticky`
- [x] Badge notif SSE + backoff exponentiel
- [x] Scraper BRVM rapports + score fondamental
- [x] Onglets BRVM : Signaux / Rapports / Marché / Tous les titres
- [x] Intégration symboles BRVM dans scan global

### Prochaines priorités — Phase A
1. **Moyen** : PDFs émetteurs BRVM — clic → liste PDF téléchargeables
2. **Moyen** : extraction indicateurs PDFs BRVM (revenus, résultat net, PER, ROE)
3. **Moyen** : suivi positions ouvertes — re-scan + alerte si signal change
4. **Moyen** : simulation signal (`/signals/{id}/simulate` → PnL, R/R, drawdown)
5. **Phase A** : on-chain crypto (Fear & Greed ✅, Funding Rate, OI, MVRV)
6. **Phase A** : BRVM fondamentaux entreprises (P/E, dividende, ROE — bfin.brvm.org)
7. **Phase A** : tick stats Deriv (ATR z-score, BB width, Monte Carlo)
8. **Long** : YOLO patterns visuels, DeFi arbitrage, ML scoring

### YOLO — Détection visuelle de patterns chartistes (Long terme)
- **Idée** : utiliser un modèle YOLO (v8/v11) entraîné sur des captures de graphiques pour détecter automatiquement des patterns visuels.
- **Patterns cibles** : tête-épaules, drapeau, triangle, double sommet/creux, pinbar, engulfing, order blocks, FVG, zones de support/résistance.
- **Intégration** : les patterns détectés deviennent un signal supplémentaire dans le moteur de décision (comme le momentum ou les rapports fondamentaux).
- **Ce que YOLO n'est PAS** : un prédicteur de prix ni le cœur du système — juste un composant visuel complémentaire.
- **Prérequis** : collecte d'images de charts annotées, entraînement, puis endpoint `/analyze/visual` dans l'engine.
- **Priorité** : long terme, après les fondamentaux et le suivi de positions.

### UX — Pagination et hauteurs de défilement ✅
- [x] **Signaux** : pagination client `PAGE_SIZE=12`, contrôles ←/→, compteur `X–Y sur N`
- [x] **Portfolio historique** : pagination `HIST_PAGE_SIZE=10`, IIFE pattern, contrôles ←/→
- [x] **BRVM "Tous les titres"** : `max-h-[600px] overflow-y-auto` + `thead sticky top-0`
- [x] **BRVM "Reports" émetteurs** : `max-h-[500px] overflow-y-auto` + `thead sticky top-0`

### Profils trader/investisseur et signaux adaptatifs

> Le système ne génère pas encore de signaux explicitement tagués par profil. En revanche, il possède déjà des **briques segmentées** (timeframes, marchés, risk calculator, rôles utilisateur) qu'il faut formaliser en logique `profileSuitability`.

#### Profils cibles

- **INVESTOR** : horizon long terme, fondamentaux + macro + on-chain lent. Timeframes 1D/1W. Confiance ≥ 50%, R/R ≥ 2.0.
- **SWING** : 3-10 jours, technique + price action + sentiment. Timeframes 4H/1D. Confiance ≥ 55%, R/R ≥ 1.5.
- **DAY** : intraday, on-chain rapide + order flow + news. Timeframes 15m/1H. Confiance ≥ 65%, R/R ≥ 1.2.
- **SCALPER** : minutes, tick data + liquidations + compression. Timeframes 1m/5m. Confiance ≥ 75%, R/R ≥ 1.0.

#### Briques déjà présentes (à formaliser)

- **Timeframes multiples** : 1m, 5m, 15m, 1h, 4h, 1d supportés dans `scan.py`. Le `warmup` sépare déjà `WARMUP_TIMEFRAMES_FAST` (15m/1h) et `SLOW` (1h/4h) — base pour DAY/SWING.
- **Marchés segmentés** : BRVM (fondamental), Forex (macro), crypto (on-chain/technique), Deriv (statistique stochastique).
- **Risk calculator** : sizing, SL/TP, ajustement régime dans `risk.py` — base pour sizing par profil.
- **Rôles utilisateur** : `UserRole` enum (`TRADER`, `INVESTOR`, `ADMIN`) dans `schema.prisma` — base pour mapping profil.
- **Hiérarchie multi-timeframe** (`_TF_HIERARCHY` dans `scan.py`) : LTF/MTF/HTF — utile pour qualifier la confluence par profil.

#### Tâches à faire

- [ ] 🤖 **Champ `profileSuitability` sur `Signal`** : tableau de profils compatibles, calculé par `scan.py`.
- [ ] 🤖 **Fonction `compute_profile_suitability`** : mappe timeframe / confiance / R/R vers profils.
- [ ] 🤖 **Endpoint `/signals` avec filtre `?profile=`** : permet de filtrer par profil cible.
- [ ] 🤖 **Badges profils sur les cartes signaux** : affichage visuel dans le frontend.
- [ ] 🤖 **Sizing et R/R adaptés au profil** : étendre `risk.py` avec des plafonds et levier par profil.
- [ ] 🤖 **Onboarding profil optionnel** : questionnaire rapide lors de l'inscription ou dans les paramètres.

#### Stratégie d'implémentation

1. **MVP** : badges `profileSuitability` sur chaque signal + filtre frontend. Tous les signaux restent visibles par défaut.
2. **Post-MVP** : mode "activer le profil" qui filtre automatiquement les signaux, adapte le sizing et les notifications.
3. **Phase D** : agents spécialisés par profil (agent investisseur, agent scalpeur, etc.).

### Crypto DeFi & Arbitrage (Long terme)
- **Idée** : détecter des opportunités d'arbitrage entre DEX (Uniswap, PancakeSwap, etc.) ou entre CEX et DEX.
- **Données nécessaires** : prix on-chain en temps réel, frais de gaz, liquidité des pools.
- **Approches** : arbitrage triangulaire, arbitrage cross-chain, flash loans.
- **Complexité** : élevée — nécessite intégration Web3 (ethers.js / wagmi) et accès aux données on-chain.
- **Priorité** : long terme, à planifier après la stabilisation du moteur de signaux.

### Détection précoce de tendance, continuation, trailing stop et feedback

> Suite aux échanges sur la capacité à prédire/identifier une tendance avant qu'elle n'accélère, et sur la gestion des positions en cours.

#### Détection précoce d'une nouvelle tendance (early trend)

**Briques déjà présentes :**
- BOS / CHoCH dans `price_action.py`
- Order Blocks, FVG, liquidity zones dans `smc.py`
- Regime ADX/EMA200 dans `regime.py`
- Confluence 3-TF dans `scan.py`
- S/R clustering dans `sr_zones.py`

**Manques identifiés :**
- Divergences RSI / MACD non implémentées
- Compression Bollinger + expansion partielle
- Volume anomalie / Volume profile
- Liquidity sweep / fakeout detection
- Momentum leading (ROC, Stochastique, Williams %R)
- On-chain divergence (prix baisse mais accumulation) — Phase A/C

**Signal idéal "early trend" :**
1. Divergence ou compression sur LTF
2. Liquidity sweep d'une zone clé
3. Retour + CHoCH dans l'autre sens
4. Reteste d'un FVG ou Order Block
5. Confluence MTF/HTF alignée
6. SL sous le sweep/OB/FVG (1-2 ATR)
7. TP défini selon prochaine zone de liquidité ou R/R cible (1:3+)

#### Prédiction de continuation d'une tendance en cours

**Problème :** estimer si la tendance actuelle a encore de la marge ou si elle approche de ses limites.

**Indicateurs de continuation :**
- ADX > 30 et DI dominant maintenu
- Structure HH/HL (bull) ou LH/LL (bear) intacte
- Volume en accord avec la direction
- Pas de divergence momentum sur HTF
- Pas d'approche d'une zone de liquidité majeure
- Funding / OI cohérent avec le mouvement (pas extrême)

**Indicateurs d'épuisement (limits) :**
- Divergence RSI/MACD sur MTF/HTF
- Bougie avec grande mèche + volume climax
- Compression Bollinger après forte expansion
- Approche d'une résistance/support majeur non cassé 3×+
- Funding extrême ou liquidations massives (fin de squeeze)

#### Trailing stop et gestion dynamique des positions

**Objectif :** protéger les profits sans sortir trop tôt sur les tendances fortes.

**Options de trailing stop :**
- ATR trailing (par ex. 2× ATR sous le prix le plus haut)
- Trailing par structure (dernier swing low/high)
- Trailing par EMA (EMA 20/50 selon timeframe)
- Trailing par chandelier (mèche la plus basse des N dernières bougies)
- Trail conditionnel : activer après +1R, puis ATR×1.5

**Implémentation nécessaire :**
- [ ] 🤖 **Module `engine/routers/trailing_stop.py`** : calcule le niveau de trailing pour chaque position ouverte.
- [ ] 🤖 **Job de réévaluation périodique** : toutes les 30s/1min, recalcule le trailing stop et met à jour `Position`.
- [ ] 🤖 **Endpoint `POST /positions/{id}/trailing-stop`** : active/désactive et choisit la méthode.
- [ ] 🤖 **Intégration dans `watcher.service.ts`** : fermeture auto si trailing stop touché.
- [ ] 🤖 **UI** : toggle trailing stop + affichage du niveau sur la position.

#### Feedback loop et expérience utilisateur

**Objectif :** apprendre de chaque trade, améliorer le scoring et l'UX.

**Données à collecter :**
- Résultat réel vs prédiction initiale (hit TP1, TP2, SL, timeout, trailing)
- Durée moyenne des trades gagnants/perdants
- Profil de l'utilisateur vs performance
- Market conditions au moment du signal (régime, volatilité, news)

**Mécanismes :**
- [ ] 🤖 **Journal enrichi** : enregistrer features du signal au moment de l'ouverture.
- [ ] 🤖 **Score post-trade** : comparer expected value vs realized PnL.
- [ ] 🤖 **Ajustement auto du score** : réduire le poids des features/conditions qui sous-performent.
- [ ] 🤖 **"Trading Copilot"** : expliquer après chaque trade fermé pourquoi le système avait raison ou tort.
- [ ] 🤖 **A/B testing stratégies** : tester variantes de règles sur papier avant mise en production.

### Testeur Lab — Agent analyste / stratégies / rapports par profil

> Espace de recherche et validation où un analyste (humain ou agent) conçoit des règles de trading, les teste sur plusieurs marchés en simultané, et obtient des rapports détaillés par profil et par décision.

#### Objectifs

- Tester rapidement une idée de signal sur plusieurs marchés et timeframes.
- Valider une stratégie par backtest puis forward test (paper trading).
- Mesurer la performance **par profil utilisateur** (INVESTOR, SWING, DAY, SCALPER).
- Produire un rapport détaillé par décision (raisonnement, market conditions, outcome, PnL).
- Décider quelles stratégies méritent d'être activées en production pour quels profils.

#### Composants du Lab

| Composant | Rôle | Fichier | État |
|---|---|---|---|
| **Strategy CRUD + UserStrategy** | Modèles Prisma + API CRUD + toggle user | `apps/api/prisma/schema.prisma` + `apps/api/src/strategies/` | ✅ Existe |
| **Strategy Rules Engine** | Parse et évalue les règles JSON d'une stratégie | `apps/engine/routers/strategy_eval.py` | ✅ Existe |
| **Strategy Builder (Lab)** | Créer/éditer des stratégies via DSL JSON, template ou prompt LLM | `engine/routers/strategy_lab.py` | À créer |
| **Signal Generator (Lab)** | Appliquer les règles sur les données et générer des signaux | `engine/routers/scan.py` (mode lab) | À connecter |
| **Dynamic Scan** | Le scan principal lit les `rules` des strategies actives au lieu de la logique fixe | `engine/routers/scan.py` | 🔴 Gap critique |
| **Sandbox Engine** | Exécuter les signaux en paper trading sans risque réel | `engine/routers/paper_lab.py` | À créer |
| **Profiler** | Classer chaque signal selon les 4 profils | `engine/routers/profile_suitability.py` | À créer |
| **Evaluator** | Calculer métriques par profil et par marché | `engine/evaluation/metrics.py` | À créer |
| **Report Generator** | Rapport détaillé par décision | `engine/evaluation/report_generator.py` | À créer |
| **LLM Analyst** | Résumé des résultats et recommandations | `engine/routers/llm.py` (mode lab) | À étendre |

#### Flux d'un test

```
1. Créer une stratégie (conditions d'entrée, filtres, SL/TP, timeframe, marchés)
        ↓
2. Lancer backtest historique (12-24 mois minimum)
        ↓
3. Si backtest valide (Sharpe > 0.5, win rate > 40%, max DD < 20%)
        ↓
4. Déployer en paper trading (forward testing 2-4 semaines)
        ↓
5. Comparer backtest vs paper pour détecter overfitting
        ↓
6. Si validation → activer pour les utilisateurs du profil cible
        ↓
7. Générer rapport détaillé par décision et par profil
```

#### Exemple de stratégie Lab (DSL JSON)

```json
{
  "name": "Breakout EMA50 + FVG + ADX",
  "markets": ["crypto", "forex", "deriv"],
  "analysis_timeframe": "4h",
  "entry_timeframe": "15m",
  "trigger": "RETEST",
  "entry_rules": {
    "ema_fast_above_slow": true,
    "fvg_proximity_pct": 1.0,
    "adx_min": 25,
    "bos": true
  },
  "filters": {
    "regime": ["TRENDING_BULL", "TRENDING_BEAR"],
    "min_confidence": 60
  },
  "invalidation": {
    "close_beyond_ob": true,
    "close_beyond_fvg": true,
    "max_wait_bars": 8
  },
  "exit_rules": {
    "sl_atr": 1.5,
    "tp1_atr": 3.0,
    "tp2_atr": 5.0,
    "trailing_enabled": true,
    "trailing_method": "atr_2x"
  },
  "profiles": ["SWING", "DAY"]
}
```

#### Modes d'entrée et déclencheurs

Le signal doit préciser **comment** entrer après la validation du setup :

| Mode | Déclenchement | Risque | Profil adapté |
|---|---|---|---|
| **RETEST** | Prix reteste un OB/FVG/support/résistance | SL serré | Swing, Day |
| **BREAKOUT** | Prix casse un swing high/low clairement | Risque de fakeout | Day, Scalper |
| **LIMIT** | Ordre limite placé à un niveau précis | Non exécuté | Investisseur, Swing |
| **VOLATILITY_EXPANSION** | Compression Bollinger puis expansion forte | Slippage | Scalper, Day |
| **MOMENTUM_CONFIRMATION** | Bougie de confirmation + volume spike | Retard | Day, Swing |

Règles d'invalidation communes :
- Fermeture au-delà de l'OB/FVG dans le mauvais sens.
- Setup non déclenché après N bougies (`max_wait_bars`).
- Régime passé en VOLATILE sur MTF/HTF.
- Divergence momentum sur HTF.

#### Endpoints à ajouter

- `POST /lab/strategies` — créer une stratégie Lab
- `GET /lab/strategies` — lister les stratégies
- `POST /lab/backtest` — lancer un backtest
- `GET /lab/backtest/:id/results` — résultats par profil
- `POST /lab/paper/start` — démarrer le paper test
- `POST /lab/paper/stop` — arrêter le paper test
- `GET /lab/paper/:id/results` — résultats paper
- `GET /lab/reports/:id/decisions` — rapport détaillé par décision
- `GET /lab/reports/:id/summary` — résumé LLM des résultats

#### Données enregistrées par décision

```json
{
  "decision_id": "uuid",
  "strategy_id": "uuid",
  "symbol": "BTC/USDT",
  "market": "crypto",
  "timeframe": "1h",
  "profile_suitability": ["SWING", "DAY"],
  "side": "BUY",
  "entry_price": 63200,
  "sl": 62100,
  "tp1": 65100,
  "tp2": 67200,
  "expected_rr": 1.9,
  "outcome": "TP1",
  "realized_pnl_pct": 3.0,
  "market_conditions": {
    "regime": "TRENDING_BULL",
    "adx": 32,
    "volume_anomaly": true,
    "sentiment": "bullish"
  },
  "reasoning": [
    "EMA50 > EMA200",
    "FVG haussier à proximité",
    "Breakout du dernier swing high"
  ],
  "execution_trace": [
    {"timestamp": "...", "event": "signal_generated", "price": 63200},
    {"timestamp": "...", "event": "position_opened", "price": 63205},
    {"timestamp": "...", "event": "tp1_hit", "price": 65100}
  ]
}
```

#### Métriques par profil

| Profil | Trades | Win rate | Profit factor | Sharpe | Max DD | R/R moyen |
|---|---|---|---|---|---|---|
| INVESTOR | 12 | 58% | 2.1 | 1.2 | 8% | 1:3.2 |
| SWING | 48 | 52% | 1.8 | 1.0 | 12% | 1:2.4 |
| DAY | 124 | 46% | 1.5 | 0.8 | 15% | 1:1.6 |
| SCALPER | 312 | 41% | 1.2 | 0.5 | 22% | 1:1.1 |

Une stratégie peut être approuvée uniquement pour les profils où elle performe.

#### Tâches à intégrer au planning

##### Connexion stratégies existantes au moteur
- [ ] 🤖 **Timeframe d'analyse vs timeframe d'entrée** : le signal actuel a un seul `timeframe` (LTF = analyse ET entrée). Ajouter `analysisTimeframe` et `entryTimeframe` pour permettre d'analyser sur 4h et entrer sur 15m, par exemple.
- [ ] 🤖 **Scan dynamique** : `scan.py` doit récupérer les `Strategy` actives et leurs `rules` JSON, puis appeler `evaluate_strategy()` au lieu de la logique hardcodée.
- [ ] 🤖 **Stratégie par défaut seed** : créer en DB la stratégie "EMA Trend + RSI" avec les règles équivalentes à la logique actuelle pour ne pas casser le scan.
- [ ] 🤖 **`UserStrategy.customRules`** : permettre à un utilisateur d'activer/désactiver des stratégies et d'outrepasser certains paramètres.
- [ ] 🤖 **Champ `Signal.strategyId`** : déjà présent — s'assurer qu'il pointe sur la stratégie réellement utilisée.

##### Lab (recherche + validation)
- [ ] 🤖 **Backend Lab** : backtest, paper trading, évaluation (CRUD stratégies déjà OK).
- [ ] 🤖 **Profiler** : mapping `profileSuitability` sur les signaux Lab et production.
- [ ] 🤖 **Rapport par décision** : enregistrer market conditions + reasoning + trace d'exécution.
- [ ] 🤖 **Comparaison backtest vs paper** : détecter l'overfitting.
- [ ] 🤖 **Activation production** : promouvoir une stratégie validée vers le moteur principal.
- [ ] 🤖 **Frontend Lab** : interface de création, lancement de tests, visualisation des rapports.

#### Agent analyste (évolution)

- Propose automatiquement des variantes de règles à tester.
- Identifie les conditions de marché où une stratégie échoue.
- Génère un résumé LLM du rapport et recommande les profils cibles.
- Surveille les stratégies en production et alerte en cas de dégradation.

---

## 🔥 Priorités actuelles — Ce qui manque

> Synthèse des manques identifiés suite aux échanges. Les points sont triés du plus critique au plus stratégique.

### 0. Passer de la lecture du marché à la prédiction du prochain pas

- **Problème** : le système lit l'état actuel du marché (régime, structure, momentum) et réagit. Il ne prédit pas où le prix va aller **avant** qu'il ne s'y déplace.
- **Conséquence** : on entre souvent après le mouvement, pas avant. Les meilleurs setups sont manqués.
- **Ce qu'il faut prédire** :
  - Direction probable de la prochaine bougie ou des prochaines N bougies.
  - Probable amplitude du mouvement (ATR-projected range).
  - Zone de liquidité la plus susceptible d'être chassée.
  - Moment de l'accélération (compression → expansion).

#### Comment transformer les gardes existantes en gardes prédictives

| Garde actuelle (réactive) | Version prédictive | Implémentation |
|---|---|---|
| **Score ≥ 40** (signal confirmé) | **Probabilité directionnelle ≥ 60%** sur les prochaines N bougies | Entraîner un modèle simple (XGBoost / logistic) sur les features du signal et l'outcome |
| **Hystérésis** (2 scans consécutifs) | **Persistance prédite** : estimer que le signal reste valide au prochain scan | Modèle de séquence (Markov / persistence score) sur les N derniers scores |
| **Confluence MTF/HTF** | **Convergence prédite** : MTF et HTF vont-ils rester alignés après X bougies ? | Corrélation des régimes dans le futur proche |
| **Regime filter** (ADX > 25) | **Prédiction de régime** : probabilité de rester en trend, de basculer en range ou d'exploser en volatilité | Classifier le régime N bougies plus tard |
| **SMC : OB/FVG proche** | **Prédiction de reteste** : le prix va-t-il retester l'OB/FVG avant de partir ? | Distance au niveau + momentum leading + volume profile |
| **Volume spike** | **Prédiction d'initiative** : le volume anormal est-il acheteur ou vendeur ? | Delta volume (buy vs sell pressure) sur les ticks si dispo |
| **Sentiment news** | **Sentiment prédictif** : les news vont-elles amplifier ou inverser le mouvement ? | Momentum du sentiment + calendrier économique |

#### Mécanismes concrets à implémenter

1. **Expected Move Engine**
   - Input : ATR, volume, structure, régime.
   - Output : range haut/bas probable sur les prochaines 5/10/20 bougies.
   - Utilisé pour : placer SL/TP, évaluer si le R/R est réaliste.

2. **Trigger Probability Score (TPS)**
   - Pour chaque setup, calculer `P(trigger_hit_next_N_bars)`.
   - Exemple : setup analyse 4h, entry 15m, trigger RETEST → P(reteste dans les 8 prochaines bougies 15m).
   - Si `TPS < 40%`, le signal est dégradé ou annulé.

3. **Direction Probability Score (DPS)**
   - `P(bullish_next_5_bars)` et `P(bearish_next_5_bars)`.
   - Basé sur : momentum leading, divergence, sweep, compression, funding, on-chain.
   - Un signal n'est généré que si `DPS > 60%` dans la direction visée.

4. **ML Signal Success Predictor**
   - Features : score technique, régime, confluence MTF/HTF, volume, sentiment, heure, day-of-week, marché.
   - Target : `win` (trade gagnant sur les 20 prochaines bougies).
   - Output : `P(win)`.
   - Condition : `P(win) > 55%` pour générer le signal.

5. **Liquidity Sweep Predictor**
   - Identifier les equal highs/lows proches.
   - Prédire laquelle sera chassée en premier grâce au momentum et au volume.
   - Anticiper le fakeout avant d'entrer dans le vrai mouvement.

6. **Compression → Expansion Detector**
   - Bollinger Band width au plus bas depuis 20 bougies.
   - ATR percentile faible.
   - Prédire la direction de l'explosion avec le momentum latent (volume, divergence, funding).

- **À faire** :
  - [ ] 🤖 Moteur prédictif : features de momentum leading, divergence, sweep, compression.
  - [ ] 🤖 Score `P(bullish_next_X_bars)` / `P(bearish_next_X_bars)`.
  - [ ] 🤖 Expected move : projection haut/bas basée sur ATR + structure.
  - [ ] 🤖 Trigger Probability Score (TPS) pour les modes RETEST/LIMIT.
  - [ ] 🤖 ML Signal Success Predictor (`P(win)`).
  - [ ] 🤖 Liquidity Sweep Predictor.
  - [ ] 🤖 Compression → Expansion Detector.
  - [ ] 🤖 Signaux générés seulement si `DPS > 60%` + `P(win) > 55%` + edge confluence.

### 1. Stratégies : le moteur ne les utilise pas encore (critique)

- **Problème** : `scan.py` génère les signaux avec une logique hardcodée (`analyze_candles`) et enregistre tout sous la stratégie fixe `"EMA Trend + RSI"`.
- **Conséquence** : les utilisateurs peuvent créer/modifier des stratégies, mais le moteur ne les applique pas.
- **À faire** :
  - [ ] 🤖 Récupérer les `Strategy` actives depuis l'API dans `scan.py`.
  - [ ] 🤖 Appeler `evaluate_strategy()` avec les `rules` JSON au lieu de la logique hardcodée.
  - [ ] 🤖 Créer une seed `"EMA Trend + RSI"` en DB avec les règles équivalentes pour ne pas casser le fonctionnement.
  - [ ] 🤖 Permettre `UserStrategy.customRules` pour outrepasser certains paramètres par utilisateur.
  - [ ] 🤖 S'assurer que `Signal.strategyId` pointe vers la bonne stratégie.

### 2. Profils utilisateur : signaux non tagués

- **Problème** : aucun signal ne porte d'information `profileSuitability` (INVESTOR / SWING / DAY / SCALPER).
- **Conséquence** : impossible de filtrer les signaux par profil ou d'adapter le sizing.
- **À faire** :
  - [ ] 🤖 Fonction `compute_profile_suitability()` dans `scan.py`.
  - [ ] 🤖 Champ `profileSuitability` sur le modèle `Signal`.
  - [ ] 🤖 Endpoint `GET /signals?profile=SWING`.
  - [ ] 🤖 Badges profils sur les cartes signaux.
  - [ ] 🤖 Sizing / R/R par profil dans `risk.py`.

### 3. Détection précoce de tendance (early trend)

- **Problème** : le système détecte la structure (BOS/CHoCH), les OB/FVG, le régime, mais pas les divergences, sweeps ou compressions.
- **Conséquence** : on confirme le mouvement plus qu'on ne le prévient.
- **À faire** :
  - [ ] 🤖 Divergences RSI / MACD.
  - [ ] 🤖 Compression Bollinger + explosion de volatilité.
  - [ ] 🤖 Liquidity sweep / fakeout detection.
  - [ ] 🤖 Volume anomalie / Volume profile.
  - [ ] 🤖 Momentum leading (ROC, Stochastique, Williams %R).

### 4. Continuation et épuisement d'une tendance en cours

- **Problème** : pas d'analyse du "jusqu'où peut aller la tendance actuelle".
- **Conséquence** : TP2 parfois trop optimiste ou conservateur, pas de trailing stop adaptatif.
- **À faire** :
  - [ ] 🤖 Score de continuation basé sur ADX, structure intacte, volume, divergence HTF.
  - [ ] 🤖 Détection d'épuisement : mèches, volume climax, funding extrême, liquidation massive.
  - [ ] 🤖 Ajuster TP2 ou activer trailing stop selon ce score.

### 5. Trailing stop et gestion dynamique des positions

- **Problème** : les positions se ferment uniquement sur SL, TP1, TP2 ou timeout.
- **Conséquence** : on laisse courir les profits ou on sort trop tôt sans mécanisme intermédiaire.
- **À faire** :
  - [ ] 🤖 Module `engine/routers/trailing_stop.py`.
  - [ ] 🤖 Méthodes : ATR trailing, structure (dernier swing), EMA trailing, chandelier trailing.
  - [ ] 🤖 Job périodique (30s-1min) pour recalculer les trailing stops.
  - [ ] 🤖 Intégration dans `watcher.service.ts` pour fermeture auto.
  - [ ] 🤖 UI : toggle + niveau affiché sur la position.

### 6. Testeur Lab (validation stratégies par profil et marché)

- **Problème** : aucun environnement dédié pour tester des idées de trading avant production.
- **Conséquence** : les nouvelles stratégies passent directement en production ou restent théoriques.
- **À faire** :
  - [ ] 🤖 Backend Lab : backtest multi-marchés, paper trading, évaluation.
  - [ ] 🤖 DSL JSON + templates de stratégies.
  - [ ] 🤖 Profiler : `profileSuitability` par signal Lab.
  - [ ] 🤖 Rapport détaillé par décision (market conditions, reasoning, trace).
  - [ ] 🤖 Comparaison backtest vs paper (anti-overfitting).
  - [ ] 🤖 Frontend Lab.

### 7. Feedback loop et expérience utilisateur

- **Problème** : les trades fermés ne nourrissent pas assez le moteur.
- **Conséquence** : pas d'amélioration automatique du scoring, pas d'explication post-trade.
- **À faire** :
  - [ ] 🤖 Journal enrichi avec features du signal au moment de l'ouverture.
  - [ ] 🤖 Score post-trade : expected value vs realized PnL.
  - [ ] 🤖 "Trading Copilot" : explication du trade gagnant/perdant.
  - [ ] 🤖 Ajustement automatique du poids des features sous-performantes.

### 8. On-chain / macro / fondamentaux avancés

- **Problème** : le moteur est principalement technique/sentiment.
- **Conséquence** : pas d'alpha asymétrique réel (crypto on-chain, macro forex, fondamentaux BRVM).
- **À faire** :
  - [ ] 🤖 Fear & Greed, funding rates, exchange flows, MVRV, OI.
  - [ ] 🤖 Calendrier économique Forex + DXY momentum + COT report.
  - [ ] 🤖 Fondamentaux BRVM (P/E, dividendes, revenus, rapports émetteurs).
  - [ ] 🤖 Début DEX / memecoins (Helius/Birdeye/dRPC) — Phase C/D.

### 9. Fiabilité et scalabilité

- **À surveiller** :
  - [ ] WebSocket Binance : reconnexion, heartbeat, gestion des déconnexions.
  - [ ] Rate limiting Twelve Data / Coinglass / CryptoQuant.
  - [ ] Tests unitaires NestJS critiques (auth, positions, watcher) manquants.
  - [ ] Migrations Prisma strictes (`prisma migrate deploy` en prod).

### Vue d'ensemble des priorités

```
🔴 Bloquant avant prod     : Stratégies dynamiques + Profils + Tests critiques
🟠 Important post-MVP      : Early trend + Trailing stop + Feedback loop
🟡 Stratégique Phase A/B   : On-chain/macro/fondamentaux
🟢 Long terme               : Lab complet + Agent analyste + DEX avancé
```


Faire des analyses long termes du genres et autres Q1, Q2, Q3, Q4; les dominances;