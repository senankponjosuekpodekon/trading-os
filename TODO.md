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

## 🗺️ Ordre de réalisation — Dépendances

> Les tâches doivent être faites **dans cet ordre** car chaque couche sert de fondation à la suivante.

### Phase 0 — Prérequis production (bloquant)
1. **Tests critiques** : auth, positions, watcher NestJS ✅ compilent / passent ; couverture > 80% reste à atteindre
2. **Index DB** ✅ : indexes signals, positions, refresh_tokens, notifications créés et migration appliquée
3. **Migrations strictes** ✅ : `prisma migrate deploy` fonctionnel, migration `20260715231000_add_notifications_and_indexes`
4. **Sécurité** (partiel) ✅ : Helmet.js + CORS whitelist + headers engine + chiffrement clés API + env audit + RLS PostgreSQL
   - CSRF / XSS restent à faire
5. **Resilience** (partiel) ✅ : circuit breaker + sémaphores par source intégrés à `retry_async`, TTL Redis standardisés
   - PgBouncer reste infra à configurer côté hébergeur
6. **Observabilité** (partiel) ✅ : structured error responses + codes erreur internes + requestId tracing + Sentry SDK
   - Sentry/Glitchtip DSN à configurer en prod (`SENTRY_DSN_API` + `SENTRY_DSN_ENGINE`)
7. **Rôles & Permissions** ✅ : `TRADER`, `INVESTOR`, `ADMIN`, `SUPER_ADMIN` dans Prisma + `RolesGuard` hiérarchique
   - `SUPER_ADMIN` hérite de `ADMIN` > `INVESTOR` > `TRADER`
   - `SUPER_ADMIN` reçoit les alertes système (health checks, cron failures, DB vide)
   - Inscription restreinte à `TRADER` / `INVESTOR` (`@IsIn` — pas d'auto-promotion `ADMIN`/`SUPER_ADMIN`)
   - **Manque frontend** : pas de rendu conditionnel par rôle (menu admin, page ops)
   - **Manque frontend** : pas de page dashboard ops pour `SUPER_ADMIN` (health, users, logs)
   - **Manque backend** : `@Roles(UserRole.SUPER_ADMIN)` sur plus de routes admin (users management, system config)
   - **Manque engine** : aucune auth sur les routes Python (sécurité par réseau uniquement)
8. **Monitoring système** ✅ : `SystemHealthService` (cron 15 min) vérifie engine, DB, assets/strategies, signaux récents
   - Endpoint `GET /api/system/health` pour dashboard ops
   - Alertes push aux `SUPER_ADMIN` via `NotificationsService`
9. **Docker production** ✅ : API entrypoint lance `prisma migrate deploy` + seed automatiquement
   - Engine sans `--reload` en prod
   - Healthchecks sur API + Engine dans `docker-compose.yml`
   - Variables `APP_RUNTIME_USER` / `APP_RUNTIME_PASSWORD` pour RLS

### Phase 0+ — Infrastructure & Ops (rigueur, transparence)
10. **Seed automatique au démarrage** ✅ : `entrypoint.sh` exécute migrate + seed dans le conteneur API
11. **Health endpoint enrichi** ✅ : `GET /api/system/health` retourne statut détaillé (engine, DB, assets, signals)
12. **Alerting super admin** ✅ : notifications `SYSTEM` pushées aux `SUPER_ADMIN` quand infrastructure défaillante
13. **Logs structurés** (partiel) ✅ : API utilise NestJS Logger, Engine utilise structlog JSON
    - Centralisation logs (Loki/Grafana) reste à configurer
14. **Backup DB** 🔁 : script `pg_dump` cron quotidien vers Hetzner Storage Box
    - Retention 7 jours, rotation automatique
15. **Uptime monitoring** 🔁 : UptimeRobot ou équivalent sur `/api/health` + `/health` (engine)
    - Alert email/SMS si downtime > 2 min
16. **CI/CD pipeline** : GitHub Actions → build + test + push image Docker → deploy VPS
    - Tests obligatoires avant merge sur `vps`
17. **Frontend rôle-based** : rendu conditionnel par rôle dans Sidebar + pages admin
    - Menu admin visible uniquement pour `ADMIN` / `SUPER_ADMIN`
    - Page `/admin/users` — gestion des utilisateurs (list, suspend, change role) — `SUPER_ADMIN` only
    - Page `/admin/ops` — dashboard ops (health checks, logs, crons status) — `SUPER_ADMIN` only
    - Page `/admin/strategies` — gestion stratégies globales — `ADMIN`+
18. **Engine auth** (optionnel) : ajouter API key / JWT verification sur les routes Python
    - Actuellement sécurité par réseau (Docker internal) — suffisant en MVP
    - Si exposition externe : ajouter `Depends(verify_api_key)` sur les routers
19. **Tests couverture > 80%** : étendre couverture sur signals, positions, auth, system-health
    - `SystemHealthService` : 8 tests ✅ | `RolesGuard` : 14 tests ✅
    - Reste : signals.service (cron), positions.service, auth.service

### Phase 1 — Données & Engine (fondation ML)
7. Feature Factory complète ✅ (fait)
8. Market Concept Vector + Embedding ✅ (fait)
9. Compression/Expansion + Liquidity Sweep Predictors ✅ (fait)
10. **Feature Store v1** : persister `feature_vector` dans `Signal.metadata.feature_vector` ✅
11. **Feature Store v2** : table dédiée `signal_features(signal_id, features_json, outcome, pnl)` + index pgvector
12. **Backtest scientifique anti-look-ahead** : candle par candle, coûts réels, walk-forward, Monte Carlo

### Phase 2 — ML & Scoring
13. **Signal Success Predictor** : entraîner `P(win)` sur `SignalLog`/outcomes (logistic / XGBoost)
14. **Regime classifier** : HMM ou clustering sur concept vector
15. **Calibration** : Platt scaling/isotonic pour que confidence = probability

### Phase 3 — UX & Pages marché
16. Page `/scanner` unifiée (Crypto, Forex, Synthetic, BRVM)
17. Page `/synthetic` — régimes stochastiques V75/Boom/Crash
18. Page `/onchain` — dashboard on-chain crypto
19. Page `/economic-calendar` — FOMC, NFP, CPI
20. Refactor `/chart/[symbol]` avec annotations structure/liquidité
21. Signal Card vivante : entry zone, TPs probabilistes, Why/Why not, timeline

### Phase 4 — Autonomie & Mémoire
22. Market Memory System (pgvector similarity search)
23. Multi-agents spécialisés extraits depuis `scan.py`
24. Execution automatique paper → réel
25. Continuous learning pipeline
26. **Bot Agent — Trading automatique multi-marchés** :
    - Agent qui prend des positions automatiquement (paper puis réel) sur les signaux
    - Un bot par marché : Crypto, Forex, Indices, Commodities, Synthetic, BRVM
    - Chaque bot applique les stratégies assignées à son marché (`rules.markets`)
    - Gestion du risque par bot : max positions, max drawdown, sizing Kelly/fixed
    - Mode paper → validation → switch réel (validation humaine SUPER_ADMIN)
    - Journal d'exécution : chaque trade loggé avec raison, stratégie, outcome
    - Dashboard ops `/admin/bots` : statut, PnL, positions ouvertes, pause/resume — `SUPER_ADMIN` only
    - Notifications `SYSTEM` au `SUPER_ADMIN` si un bot est en perte excessive ou désactivé
27. **Stratégie BRVM dédiée** : momentum + volume sur actions africaines (données quotidiennes)
    - Pas de scalping (pas de données intraday), analyse daily + 4h
    - Filtre liquidité (volume minimum)
    - Marché : `['BRVM']` uniquement

### Phase 5 — Scale SaaS
28. Plans & abonnements Stripe
29. Audit trail
30. 2FA TOTP obligatoire pour trades réels
31. Data pipeline scalable (Redis Streams / Celery → Kafka si besoin)

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

- [x] 🤖 **`engine/routers/onchain.py`** — Signal asymétrique crypto ✅ **Fear&Greed + Funding branchés au score**
  - [x] **Fear & Greed Index** ✅ `macro.py` (`/macro/fear-greed`) — logique contrarian +20/-15 pts **appliquée** via `onchain_bonus()`
  - [x] **Funding Rate** ✅ `onchain.py` (`/onchain/funding/{symbol}`) — logique squeeze +15 pts **appliquée**
  - [x] **Open Interest** ✅ implémenté (`/onchain/open-interest/{symbol}`) — récupéré mais pas encore scoré (pas d'historique 24h pour calculer le delta)
  - [x] **Exchange Net Flow** ✅ (`onchain_advanced.py`) — CryptoQuant avec fallback mock
  - [x] **MVRV Ratio** ✅ (`onchain_advanced.py`) — Glassnode avec fallback mock
  - [x] Endpoint agrégé `GET /onchain/context/{symbol}` ✅ (funding+OI+basis+dominance) — pas de nom `asymmetric_score` mais rôle équivalent
  - [x] **Intégration dans `scan.py` + `strategy_eval.py`** : `onchain_bonus()` branché dans les deux chemins de scoring (défaut + stratégies actives), plafonné à ±25 pts. Prefetch async par batch dans `scan_multi` (Fear&Greed partagé + contexte par symbole crypto). 13 tests unitaires (`tests/test_onchain.py`)

- [x] 🤖 **`engine/routers/onchain_advanced.py`** — Couches on-chain complémentaires ✅
  - **Exchange Net Flow** : CryptoQuant avec fallback mock (BTC/ETH)
  - **MVRV Ratio** : Glassnode avec fallback mock (BTC/ETH)
  - **Developer Activity** : GitHub commits 30j/60j, latest release → `zombie_flag`
  - **Smart Contract / TVL** : DefiLlama TVL change + Etherscan active addresses (optionnel)
  - `advanced_onchain_bonus()` branché dans `scan.py` pour ajuster le score crypto
  - **Stablecoin Flow** ✅ (CryptoQuant)
    - USDT entrant sur exchanges → pression acheteuse potentielle `+10 pts`
  - **NVT Ratio** ✅ (CryptoQuant/Glassnode)
    - NVT > 150 → surévalué réseau → `-15 pts`
    - NVT < 30 → sous-utilisé / possible rebond fondamental
  - **Whale Alert** proxy ✅ (Whale Alert API free tier)
    - Mouvement > 1000 BTC/ETH : alerte contextuelle dans le signal
    - Filtre des réorganisations internes d'exchanges

- [x] 🤖 **`engine/routers/tokenomics.py`** — Analyse tokenomics pré-signal ✅
  - Fetch token unlock schedule (Token Unlocks API / CoinGecko) avec fallback mock
  - Upcoming unlock > 20% supply dans 30j → `danger_flag = True` → signal désactivé
  - Top 10 holders > 80% → concentration flag → `confidence -= 20`
  - Endpoint : `GET /tokenomics/{symbol}` → unlock calendar + concentration score
  - Branché dans `scan.py` pour les actifs CRYPTO

- [x] 🤖 **`engine/routers/social_sentiment.py`** — LunarCrush intégration ✅
  - Galaxy Score, AltRank, social dominance, interactions/post
  - Galaxy Score > 60 + trending → `+12 pts` momentum social
  - Endpoint : `GET /social/{symbol}` → social metrics
  - Branché dans `scan.py` pour les actifs CRYPTO

#### 🔵 Forex — Couche Macro & Calendrier

- [x] 🤖 **`engine/scrapers/forex_calendar_scraper.py`** ✅
  - Feed Forex Factory via `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
  - Événement HIGH dans < 2h → `macro_risk = True` → scan forex suspendu
  - Événement HIGH passé dans < 30m → `post_news_volatility` flag
  - Cache en mémoire TTL 1h

- [x] 🤖 **DXY momentum dans scan Forex** ✅
  - `fetch_dxy_daily()` via Twelve Data avec fallback mock
  - Momentum 5j intégré dans `routers/forex_context.py`
  - Ajustement score dans `scan.py` :
    - DXY ↑ fort → renforce SELL EUR/USD, GBP/USD
    - DXY ↓ fort → renforce BUY paires majeures vs USD

- [x] 🤖 **COT Report parser** (CFTC public, gratuit) ✅ — API côté NestJS `/market-data/cot/:asset` + widget Dashboard BTC
  - Publié chaque vendredi → positions réelles hedge funds vs commerciaux
  - Commerciaux extrêmement long + hedge funds extrêmement short → squeeze signal
  - Stocké en DB via `metadata.marketContext`, affiché dans page Dashboard (page Signals à brancher si besoin)

#### 🟤 Synthetic Markets — Phase A++ (Deriv spécifique)

> V75, Boom, Crash, Jump ne sont PAS des marchés réels — appliquer SMC/OB/On-chain dessus est une erreur fondamentale (Ch.16.5)

- [x] 🤖 **`engine/routers/synthetic_engine.py`** — Moteur statistique pour Deriv ✅
  - Compression score, ATR z-score, Bollinger width z-score, tick velocity/acceleration, autocorrélation
  - Monte Carlo simple pour range attendu
  - Endpoint : `GET /synthetic/analyze/{symbol}` → `{state, spike_probability, mean_reversion_prob, regime}`
  - **Ne jamais utiliser** : macro, on-chain, COT, MVRV sur ces actifs

- [x] 🤖 **`engine/routers/boom_crash_model.py`** — Modèle événementiel Boom/Crash ✅
  - Probabilité de spike sur les 50 prochains ticks/bars
  - Compression + tick velocity + ATR rolling
  - Monte Carlo : range extrême attendu

- [x] 🤖 **Séparation dans `scan.py` par type d'actif** ✅
  - `get_asset_type()` → CRYPTO | FOREX | SYNTHETIC | BRVM | COMMODITY | UNKNOWN
  - `SYNTHETIC` → `synthetic_engine.py` (stats pures, pas de trend-following)

#### ⚙️ Engine — Refactorisation Architecture (Phase A+)

> Solidifier les briques de base avant d'ajouter ML/Agents — cf. `recherche.md` Chapitres 2-7

- [x] 🤖 **`engine/indicators/swing.py`** — Swing Detection Engine ✅
  - Module `indicators/swing.py` créé avec méthodes Pivot + ATR-based + `SwingScore` pondéré (volume/duration)
  - `price_action.py` utilise désormais `get_last_swing_points()` avec scores

- [x] 🤖 **`bos_quality_score()` dans `price_action.py`** ✅
  - Score 0-100 basé sur `break_distance / ATR` + volume_ratio
  - Retourné dans `detect_market_structure()`; filtre No Trade si `bos_score < 40` dans `scan.py`

- [x] 🤖 **Feature `session` dans `scan.py`** ✅
  - `utils/session.py` : Tokyo (00h-09h), London (07h-16h), New York (13h-22h)
  - Overlap London/NY (13h-17h) → `+8 pts` dans le score
  - Feature `minutes_after_session_open` exportée dans le signal

- [x] 🤖 **`displacement_ratio` dans `smc.py`** ✅
  - `OB_valid = displacement_after / ATR > 2.0 AND volume_ratio > 1.2`
  - Statut OB : `fresh / tested_once / mitigated`
  - OB mitigés exclus des listes actives

- [x] 🤖 **`SL Liquidity-aware` dans `analyze_candles()`** ✅
  - SL déplacé sous le cluster EQL le plus proche (BUY) ou au-dessus de l'EQH (SELL)
  - Buffer `ATR * 0.3` pour éviter les stop hunts

- [x] 🤖 **TP Market-Adaptive lié à la liquidité** ✅
  - TP1 = EQH/EQL le plus proche selon la direction du signal
  - Fallback ATR si pas de liquidité proche
  - TP2/TP3 restent ATR-adaptatifs au régime

#### 🟡 BRVM — Couche Fondamentaux Entreprises

- [x] 🤖 **`engine/scrapers/brvm_scraper.py`** — Robuste ✅
  - Source Westbourse en priorité, fallback scraping brvm.org, fallback mock
  - Constantes `BRVM_SYMBOLS`, `fetch_brvm_quotes()`, `_mock_brvm_quotes()` centralisées

- [x] 🤖 **`engine/scrapers/brvm_fundamentals.py`** — Données entreprises ✅
  - Scrape `bfin.brvm.org` avec fallback mock pour P/E, dividende, revenus, FCF, ROE
  - `BrvmFundamentals` struct + `fetch_fundamental_metrics()` + `asymmetric_signal_score()`
  - Signal asymétrique BRVM intégré dans `scan_brvm` :
    - P/E bas + dividende attractif + volume anormal → opportunité non pricée

#### 🟣 Deriv V75/V100 — Couche Statistique Stochastique

- [x] 🤖 **`engine/routers/tick_stats.py`** — Analyse statistique synthétique ✅
  - ATR rolling z-score, Bollinger Band width z-score, std overextension
  - Tick velocity + accélération, régimes `LOW_VOL` / `EXPANSION` / `EXHAUSTION`
  - Monte Carlo simple pour range attendu
  - Endpoint : `POST /tick-stats/analyze`

---

#### 🌐 Unified Market Representation — Phase A++ (Langage commun multi-marchés)

> Ch.16.6 : Un BOS sur USDJPY, une accumulation de baleines sur BTC, une compression V75 = même concept : changement d'état du marché. L'IA doit apprendre ce concept universel, pas les labels spécifiques.

- [x] 🤖 **`engine/features/market_concept_layer.py`** — Concepts universels ✅
  - Transformer les features spécifiques en concepts abstraits cross-marchés :
    - `trend` : EMA alignment + structure + MTF/HTF regime
    - `accumulation` : range contraction + volume + exchange/whale outflow (Crypto)
    - `expansion_energy` : ATR percentile + BB width + squeeze
    - `liquidity_pressure` : BOS quality + EQH/EQL/OB proximity
    - `imbalance` : price position + volume skew + on-chain flows
    - `stress` : ATR% + drawdown + macro risk + whale inflow
  - Sortie : vecteur universel `{trend, accumulation, expansion_energy, liquidity_pressure, imbalance, stress}` → float 0-1
  - Ce vecteur est identique pour BTC, USDJPY, V75 — comparaison cross-marché possible
  - Intégré dans `scan.py` pour tous les actifs (Forex/Crypto/Synth)
  - **Prérequis du Market Memory System** : sans représentation universelle, la similarité search est aveugle

- [x] 🤖 **`engine/features/market_embedding.py`** — Market State Vector ✅
  - Transformation du concept vector en `embedding vector(64)` normalisé
  - Projection déterministe (seed fixe) → même état de marché = même embedding peu importe l'actif
  - Prêt pour pgvector / cosine similarity (Phase D Market Memory)
  - Exposé dans chaque résultat de `analyze_candles`

---

### 🧠 Phase B — Machine Learning & Feedback Loop

> Condition : 500+ signaux enregistrés avec résultats réels dans le journal

- [x] 🤖 **`engine/ml/feature_factory.py`** — Feature Factory indépendant ✅
  - Service séparé calculant toutes les features — consommé par ML, backtest, live, RAG
  - **Niveau 1** Raw : `open, high, low, close, volume, spread, bid, ask`
  - **Niveau 2** Calculées : `body_ratio, wick_ratio, log_return, realized_vol, ATR_14, ATR_percentile, volume_ratio_20`
  - **Niveau 3** Structurelles : `rsi, rsi_slope, macd, macd_hist_slope, ema_alignment, pa_trend, pa_bos, pa_choch, pa_bos_score, fvg_count, ob_proximity, liquidity_proximity, regime, adx`
  - **Niveau 4** Contextuelles : `day_of_week, hour_utc, session, session_overlap, minutes_after_open, asset_type, timeframe`
  - **Niveau 5** Meta : `confluence_score, trend_fatigue, compression_flag, expansion_flag, market_concept_vector`
  - `feature_confidence` par niveau (1.0 → 0.7)
  - Sans look-ahead : toutes les features utilisent uniquement les données disponibles à la bougie T

- [x] 🤖 **Feature Store v1** — Stocker le feature vector ✅
  - À chaque signal généré : `feature_vector` inclus dans `analyze_candles` et persisté dans `Signal.metadata.feature_vector`
  - Vecteur complet 5 niveaux (raw, calculées, structurelles, contextuelles, meta) snapshot au moment du signal

- [x] 🤖 **`engine/ml/feature_store.py` v2** — Table dédiée + pgvector ✅
  - Table `signal_features(signal_id, features_json, outcome, pnl, embedding)`
  - `outcome` renseigné automatiquement quand la position se ferme
  - C'est le dataset d'entraînement pour tous les modèles futurs

- [x] 🤖 **`engine/ml/signal_scorer.py`** — XGBoost/LightGBM (version logistic regression v1)
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
- [x] 🤖 **Semaphores par source API** ✅
  - `utils/semaphores.py` avec limites : Binance 10, TwelveData 1, CryptoQuant/Glassnode 2, NewsAPI 1, BRVM 3, Deriv 5
  - Intégrés dans `utils/http.py::retry_async()` via le paramètre `source=`
- [x] 🤖 **TTL Redis par catégorie** ✅
  - `utils/cache_ttl.py` : klines, features, on-chain, macro, BRVM, synthetic, news
- [x] 🤖 **Circuit breaker par source externe** ✅
  - `utils/circuit_breaker.py` : 3 échecs → OPEN, cooldown 60-300s selon source
  - Intégré dans `retry_async()` via `source=` (Binance, TwelveData, WebSocket prix)
  - Tests unitaires `test_circuit_breaker.py`, `test_http_resilience.py`, `test_semaphores.py`
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
- [x] 🤖 **Cleanup systématique des effets React** ✅
  - `useNotifications.ts`, `useLivePrices.ts` : cleanup WS + timers
  - `AppLayout.tsx` : AbortController sur les prefetchs
- [x] 🤖 **AbortController sur fetch** ✅ — `AppLayout.tsx` prefetch signaux/portefeuilles avec `AbortController`
- [ ] 🤖 **Fermeture propre des connexions Python**
  - WS Deriv : `on_disconnect` handler → cleanup subscriptions
  - Pools asyncio : bounded `ThreadPoolExecutor` avec shutdown sur SIGTERM
- [ ] 🤖 **Limiter le volume de données WebSocket**
  - Ne pusher que les diffs (`{symbol, price, delta}`) pas les objets complets
  - Batch updates : regrouper les updates de prix toutes les 500ms côté serveur

#### Chargement & Vitesse
- [ ] 🤖 **Skeleton loaders sur toutes les nouvelles pages** — pas de flash blanc
  - Pattern : `if (loading) return <PageSkeleton />` avant tout render
- [x] 🤖 **Optimistic UI** sur mutations critiques (portfolio : `closePosition` + `updateTrailingStop`)
  - Ouvrir/fermer position : UI update immédiat, rollback si erreur ✅
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
- [x] 🤖 **Helmet.js** ✅ — headers HTTP sécurisés (NestJS + FastAPI engine)
  - API : `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (prod), `Referrer-Policy: same-origin`
  - Engine : `SecurityHeadersMiddleware` ajoute `nosniff`, `DENY`, CSP, `Permissions-Policy`, suppression `Server`
- [x] 🤖 **CORS strict** ✅ — whitelist domaines via `ALLOWED_ORIGINS` sur API et engine
- [~] 🤖 **Protection CSRF** — non critique ici
  - L'API est stateless JWT / Bearer token ; pas de session cookie
  - Si un jour cookies : implémenter double-submit cookie + `X-Requested-With`
- [ ] 🤖 **Protection XSS** — sanitiser sorties affichées
  - `sanitize-html` / `dompurify` sur champs libres (journal, notes user)
  - `dangerouslySetInnerHTML` interdit sans sanitisation dans Next.js
- [x] 🤖 **Vigilance `prisma.$queryRaw`** ✅ — audit : aucun `queryRaw` interpolé direct dans le codebase
- [x] 🤖 **Variables d'environnement** ✅ — audit automatique au boot (`auditEnv`)
  - `EncryptionService` AES-256-GCM pour secrets `enc:` (API keys, JWT, tokens)
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
- [x] 🤖 **Codes d'erreur internes standardisés** ✅
  - `ErrorCode` enum + `ApplicationException` + réponses JSON `{ statusCode, code, message, path, requestId }`
  - Codes : `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `SIGNAL_NOT_FOUND`, `POSITION_NOT_FOUND`, `RATE_LIMITED`, `EXTERNAL_API_ERROR`, `ENGINE_UNAVAILABLE`, etc.
- [x] 🤖 **`ValidationPipe` global strict** ✅
  - `whitelist: true` + `forbidNonWhitelisted: true`
- [ ] 🤖 **Timeout sur toutes les requêtes Prisma**
  - `prisma.$transaction([...], { timeout: 5000 })` — évite locks infinis
- [~] 🤖 **Sentry / Glitchtip** — prêt structurellement
  - Dès ajout du package : `SENTRY_DSN` + init SDK dans `main.ts`
  - Engine : `sentry-sdk` Python optionnel

#### Engine Python
- [x] 🤖 **Structured error responses** ✅
  - `ErrorCode` enum + `EngineException` + middleware `ErrorFormatterMiddleware`
  - Réponse JSON `{ statusCode, code, message, path, timestamp, details? }`
- [x] 🤖 **Exception hierarchy** ✅ — `EngineException` avec code/status/details
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
- [x] 🤖 **`notifications` table DB** ✅
  - Schéma : `id, userId, type, title, message, data(JSON), readAt, createdAt, updatedAt`
  - Types : `SIGNAL`, `POSITION`, `ALERT`, `SYSTEM`
  - Endpoints : `GET /notifications?unread=true&limit=20` + `PATCH /notifications/:id/read` + `PATCH /notifications/read-all`
  - Modèle Prisma + migration + relation User créés
- [x] 🤖 **Badge compteur non-lus dans le header** ✅ — `<Topbar />` affiche badge vert avec `unread`, SSE via `useNotifications`

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
- [x] 🤖 **In-app Notification Center + Toast** ✅
  - Bell dropdown chronologique dans `<Topbar />`
  - `<ToastProvider />` intégré dans `<Providers />`
  - Toasts automatiques sur chaque nouvelle notification SSE reçue dans `<AppLayout />`

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
- [x] 🤖 **Audit et création des index manquants** ✅ (v1)
  - `signals(assetId, createdAt DESC)` — déjà présent
  - `signals(isActive, createdAt DESC)` — ajouté
  - `signals(strategyId, createdAt DESC)` — ajouté
  - `signals(profileSuitability)` — ajouté (GIN géré par Prisma)
  - `positions(portfolioId, status)` — déjà présent
  - `positions(assetId, status)` — ajouté
  - `positions(signalId)` — ajouté
  - `positions(openedAt DESC)` — ajouté
  - `refresh_tokens(tokenHash)` — déjà unique + index
  - `notifications(userId, readAt)`, `(userId, createdAt DESC)`, `(readAt)`, `(type, createdAt DESC)` — ajoutés
  - `market_features(symbol, timestamp DESC)` — future feature store
  - Règle : tout champ utilisé dans `WHERE` ou `ORDER BY` fréquent → index obligatoire

#### Migrations
- [x] 🤖 **Stratégie de migration stricte** ✅ (processus initié)
  - Dev : `prisma db push` OK | Staging/Prod : `prisma migrate deploy` uniquement
  - Migration créée : `20260715231000_add_notifications_and_indexes`
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
- [x] 🤖 **`EXPLAIN ANALYZE`** sur les requêtes critiques avant production ✅
  - Script `apps/api/scripts/explain_analyze_critical_queries.sql` créé
  - Rapport `apps/api/reports/query_performance_audit.md` généré
  - Toutes les requêtes critiques < 1 ms sur le dataset actuel
  - Recommandation : ajouter index `(user_id, type, created_at)` pour le compteur d'alertes journalier
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
- [x] `spike_features()` : 34 spikes dans 1000 ticks → `{spikes: 34, avg_size: X, time_since: Y}`
- [x] `volatility_regime()` : ATR très bas + BB étroite → `LOW_VOL`
- [x] `volatility_regime()` : ATR expansion → `VOL_EXPANSION`
- [x] `volatility_regime()` : spikes fréquents → `SPIKE_RISK`
- [x] `autocorrelation()` : série avec forte corrélation t/t-1 → valeur > 0.7
- [x] `entropy()` : série aléatoire → entropie haute | série structurée → entropie basse
- [x] `distance_to_extreme()` : prix à -15% du haut → `-0.15`
- [x] Actif non-synthétique passé par erreur → exception `WrongAssetTypeError`

##### `test_probability_engine.py` — Probability Engine (à créer)
- [x] `direction_engine()` : tous agents bullish → probability > 75%
- [x] `direction_engine()` : agents mixtes → probability 45-55%
- [x] `trade_quality_probability()` : direction 78% + RR 0.8 → quality < 50% → REJECTED
- [x] `trade_quality_probability()` : direction 65% + RR 4.0 → quality > 60% → ACCEPTED
- [x] `entry_zone()` : OB + FVG proches → zone cohérente sans contradiction
- [x] `tp_targets()` : 3 niveaux retournés avec `{price, rr, probability}` chacun
- [x] `tp_targets()` : probabilité TP3 < probabilité TP1 toujours
- [x] `trailing_sl()` : nouveau HL créé → SL mis à jour sous nouveau HL

##### `test_feature_factory.py` — Feature Factory ✅
- [x] `level1_raw` : OHLCV → features brutes correctes
- [x] `level2_calculated` : body_ratio, wick_ratio, log_return, ATR percentile, volume_ratio_20
- [x] `level3_structural` : RSI, MACD, EMA alignment, BOS/CHoCH, régime, ADX
- [x] `level4_contextual` : day_of_week, session, asset_type, timeframe
- [x] `level5_meta` : confluence_score, trend_fatigue, compression/expansion flags, market_concept_vector
- [x] Anti-lookahead : aucune feature n'utilise de données après la bougie T
- [x] `feature_vector()` : retourne dict avec exactement les 5 niveaux + métadonnées

##### `test_market_concept_layer.py` — Unified Market Representation ✅
- [x] Vecteur universel : toutes les clés présentes (`trend, accumulation, expansion_energy, liquidity_pressure, imbalance, stress`)
- [x] Valeurs toujours entre 0.0 et 1.0
- [x] `trend` plus haut en uptrend qu'en downtrend
- [x] Embedding 64-dim normalisé + similarité entre états proches > 0.9

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
- [x] `sl_liquidity_aware()` : SL classique tombe sur zone EQL → SL décalé en-dessous ✅
- [x] `tp_linked_to_liquidity()` : TP1 aligné sur prochain EQH détecté ✅
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

##### `notifications.service.spec.ts` ✅ (10 tests — implémentation actuelle in-memory/SSE, pas encore persistée en DB)
- [x] `push()` : id + createdAt assignés, cap 50 notifs/user ✅
- [x] `subscribe()` : filtre par userId + diffusion notifs globales (`*`) ✅
- [x] `pushSignal()` : titre/message formatés depuis le signal ✅
- [x] `getRecent()` : fusion user+global triée desc, limite, isolation entre users ✅
- [ ] `create()` / `markAsRead()` / `markAllRead()` / `getUnread()` : à ajouter si le modèle passe en DB (`readAt`)
- [ ] `shouldNotify()` anti-spam / quiet hours / seuil utilisateur : logique pas encore implémentée

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
- [x] TP1/TP2/TP3 avec probabilités → 3 lignes affichées ✅
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
  - [x] `ruff check` Python ajouté au job engine ✅
  - [x] Coverage check : seuils anti-régression dans `jest.config` (api + web), CI passe en `--coverage` ✅
    - Actuel : API ~45% lignes / Web ~68% lignes — objectif 80% encore loin, seuils remontés progressivement
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

- [x] 🤖 **`/app/scanner/page.tsx`** — Market Scanner global ✅
  - Page créée avec filtres marché / timeframe / confiance / direction
  - Bouton "Lancer un scan" branché sur `POST /signals/scan`
  - Badges BOS / CHoCH / FVG / OB / régime / confluence affichés
  - Reste : extraction dans `components/scanner/*` + virtualisation si >50 signaux

- [x] 🤖 **`/app/synthetic/page.tsx`** — Synthetic Markets (Deriv V75/Boom/Crash) ✅
  - Page créée : Volatility / Boom-Crash / Jump / Step par groupe
  - GET `/synthetic/analyze/{symbol}` pour chaque indice
  - Affiche régime, spike probability, mean reversion, ATR z-score, range MC, alerte caution
  - Reste : extraction composants `components/synthetic/*` + timeline historique

- [x] 🤖 **`/app/onchain/page.tsx`** — On-Chain Dashboard Crypto ✅
  - Metrics BTC : transactions 24h, mempool, fees
  - Metrics ETH : gas median, transactions, market cap
  - Reste : Fear & Greed, funding rates, MVRV, whale alerts, exchange flows (Phase B)

- [x] 🤖 **`/app/economic-calendar/page.tsx`** — Calendrier économique ✅
  - Liste High/Medium impact
  - Filtre par impact
  - Reste : countdown live + filtre par devise/période

#### Phase A+ / A++ — Pages architecture avancée

- [x] 🤖 **`/app/chart/[symbol]/page.tsx`** — Chart intelligent annoté ✅
  - Refactor `/app/chart/page.tsx` vers `components/chart/ChartView.tsx` réutilisable
  - Nouvelle route `/chart/[symbol]` avec initial symbol en props
  - Annotations calculées côté client : pivots HH/HL/LH/LL, EQH/EQL clusters, projection Entry/SL/TP sur dernière bougie
  - Toggle indicateurs / niveaux / annotations
  - `/chart` continue à fonctionner en mode `search` avec Suspense

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

- [x] 🤖 **`/app/backtest/page.tsx`** — Backtesting Engine ✅
  - Métriques + equity curve + détail trades
  - `components/backtest/MonteCarloChart.tsx` — distribution 1000 simulations de capital final ✅
  - `components/backtest/CalibrationCurve.tsx` — confiance vs win rate réel ✅
  - `components/backtest/WalkForwardResults.tsx` — folds approximatifs sur la liste des trades ✅
  - `components/backtest/RegimeBreakdown.tsx` — performance par régime moteur ✅
  - `components/backtest/AssetBreakdown.tsx` — performance par actif ✅
  - `components/backtest/ChampionModelBadge.tsx` — version modèle + status champion ✅

- [x] 🤖 **`/app/features/page.tsx`** — Feature Factory Inspector (debug/dev) ✅
  - Statut du prédicteur, accuracy, nombre de samples
  - Importance des features avec barres
  - Formulaire de prédiction rapide
  - Bouton d’entraînement avec filtre market optionnel

#### Phase D — Pages autonomie & mémoire

- [x] 🤖 **`/app/memory/page.tsx`** — Market Memory System ✅
  - Endpoint backend `POST /signals/memory/similar` (Euclidean nearest neighbours on feature vectors)
  - Frontend `/memory` : formulaire feature vector + recherche d’analogues historiques
  - Cartes : symbol, timeframe, similarité %, confiance, score, régime, outcome
  - Reste : intégration pgvector natif / embedding fixé + recherche cross-symbol automatique

- [x] 🤖 **`/app/copilot/page.tsx`** — Trading Copilot (AI Conversation Layer) ✅
  - Page `/copilot/page.tsx` avec interface conversation, historique local, appel `POST /ai/chat`.
  - Endpoint `POST /engine/llm/chat` ajouté avec system prompt Trading Copilot + fallback mock.
  - Navigation sidebar/bottom nav mises à jour.

- [x] 🤖 **`/app/performance/page.tsx`** — Performance & Statistiques utilisateur ✅
  - Win rate, P&L total, profit factor, expectancy, max drawdown
  - Courbe de capital calculée depuis les positions clôturées
  - Meilleur / pire trade affichés
  - Reste : découpage en `components/performance/*` + analyse comportementale "coupez vos gagnants"

#### Composants partagés à créer (cross-pages)

- [x] 🤖 **`components/ui/PageSkeleton.tsx`** — skeleton générique réutilisable par page ✅
- [x] 🤖 **`components/ui/OpportunityScore.tsx`** — affichage score étoiles + valeur numérique ✅
- [x] 🤖 **`components/ui/ProbabilityBar.tsx`** — barre de probabilité colorée (rouge→vert) ✅
- [x] 🤖 **`components/ui/RegimeBadge.tsx`** — badge `TRENDING_BULL / RANGE / VOLATILE` ✅
- [x] 🤖 **`components/ui/AssetTypeBadge.tsx`** — badge `CRYPTO / FOREX / SYNTHETIC / BRVM` ✅
- [x] 🤖 **`components/ui/ConfidenceGauge.tsx`** — gauge circulaire animée pour confidence ✅
- [x] 🤖 **`components/ui/RRRatioBadge.tsx`** — badge `1:2`, `1:4`, `1:8` colorés ✅
- [x] 🤖 **`components/ui/TimeAgo.tsx`** — "il y a 3min" avec mise à jour automatique ✅
- [x] 🤖 **`components/ui/LiveDot.tsx`** — point vert animé "LIVE" / rouge "OFFLINE" ✅
- [x] 🤖 **`components/layout/ModeToggle.tsx`** — switch Débutant / Professionnel (persisté en localStorage) ✅

### 🎯 Trading Copilot UX — Ch.21 (Phase D+)

> Différence produit fondamentale : ne pas vendre des signaux — vendre un **copilote de décision**.

- [x] 🤖 **Market Scanner — Ranking Engine** ✅
  - `Opportunity Score = Probability × RR × Market_Quality × Timing`
  - 65% prob + RR 1:8 > 80% prob + RR 1:2 — logique asymétrique
  - Tri par score dans `/scanner`, affichage via `OpportunityScore` sur les SignalCards

- [x] 🤖 **Signal Card enrichie** ✅
  - Composant `components/signals/SignalCard.tsx` extrait et réutilisé
  - Zone d’entrée / point optimal, TPs probabilistes, badges PA/SMC/patterns
  - Traces "Pourquoi ?" / "Pourquoi PAS ?"
  - Mode débutant / pro via `ModeToggle`
  - Afficher `entry_zone` (range) + `optimal_entry` (point) + SL + TP1/TP2/TP3 chacun avec leur RR et probabilité
  - Status badge : `ACTIVE / WAIT / APPROACHING / INVALIDATED`

- [x] 🤖 **Graphique intelligent annoté** — TradingView Lightweight Charts ✅
  - Annotations auto : structure HH/HL, zones EQH/EQL, projection scénario
  - Scénario visuel : `Current price → Entry Zone → TP1 → TP2`

- [x] 🤖 **"Pourquoi ce trade ?" + "Pourquoi PAS ?"** — AI Decision Trace ✅
  - Backend : `_buildDecisionTrace()` enregistré dans `metadata.decisionTrace` avec `why` / `whyNot` / `netScore`
  - Frontend SignalCard : affiche raisons scorées si `decisionTrace` présent, fallback sur raisons calculées
  - MTF, régime, SMC, news sentiment, Fear & Greed, calendrier macro pris en compte

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

- [x] 🤖 **Risk Management Dashboard** ✅
  - Page `/risk` créée avec capital, exposition, risque par trade
  - Alerte corrélation dès 3 positions sur même base
  - Recommandations dynamiques selon les règles de risque
  - Reste : profil comportemental "coupez vos gagnants" + daily loss réel

- [x] 🤖 **Alert Engine intelligent** — max 3-5 alertes/jour haute asymétrie (pas 200 spam)
  - Filtré par `Opportunity Score > seuil` (core anti-spam implémenté)
  - Canaux Web push + Telegram + Email → à brancher via provider externe

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
- [x] 🤖 **Sizing et R/R adaptés au profil** ✅
  - `risk.py` : paramètre `profile` (conservative/moderate/aggressive) dans `RiskCalcRequest`
  - `profile_risk_adjustment` modifie `risk_pct`, R/R min/max et hard cap selon le profil
  - Tests `tests/test_risk_profile.py`
- [x] 🤖 **Onboarding profil optionnel** : questionnaire rapide lors de l'inscription ou dans les paramètres. ✅

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
- [x] 🤖 **Module `engine/routers/trailing_stop.py`** ✅
  - Endpoint `POST /trailing-stop/compute` avec méthodes `atr`, `swing`, `ema`, `chandelier`
  - Activation conditionnelle par `activation_r`
  - Never-worsen guarantee : BUY stop ne descend jamais, SELL stop ne monte jamais
- [x] 🤖 **Job de réévaluation périodique** ✅ — `syncTrailingStops()` appelle le moteur `POST /trailing-stop/compute` pour chaque position ouverte (cron 5 min)
- [x] 🤖 **Endpoint `POST /positions/{id}/trailing-stop`** ✅ — active/désactive et choisit la méthode (`atr`/`swing`/`ema`/`chandelier`)
- [x] 🤖 **Intégration dans `positions.service.ts`** ✅ — fermeture auto si trailing stop touché
- [x] 🤖 **UI toggle trailing stop + affichage du niveau sur la position** ✅ — `PortfolioPage` affiche le trailing stop (desktop + mobile badge), permet de changer la méthode et d'activer/désactiver
- [x] 🤖 **Notification/toast trailing stop** ✅ — fermeture auto notifie `TRAILING` via SSE + toast sur le web
- [x] 🤖 **Fréquence trailing stop** ✅ — `syncTrailingStops` toutes les 30 secondes (`*/30 * * * * *`)

#### Feedback loop et expérience utilisateur

**Objectif :** apprendre de chaque trade, améliorer le scoring et l'UX.

**Données à collecter :**
- Résultat réel vs prédiction initiale (hit TP1, TP2, SL, timeout, trailing)
- Durée moyenne des trades gagnants/perdants
- Profil de l'utilisateur vs performance
- Market conditions au moment du signal (régime, volatilité, news)

**Mécanismes :**
- [x] 🤖 **Journal enrichi** : enregistrer features du signal au moment de l'ouverture ✅
- [x] 🤖 **Score post-trade** : comparer expected value vs realized PnL ✅
- [x] 🤖 **Ajustement auto du score** : réduire le poids des features/conditions qui sous-performent ✅ (via SignalPredictor logistic regression + feature weights)
- [x] 🤖 **"Trading Copilot"** : expliquer après chaque trade fermé pourquoi le système avait raison ou tort ✅
- [x] 🤖 **A/B testing stratégies** : comparer plusieurs sessions Lab et identifier le gagnant via `/lab/compare` ✅

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
- [x] 🤖 **Timeframe d'analyse vs timeframe d'entrée** : `Strategy.analysisTimeframe` et `Strategy.entryTimeframe` ajoutés au schéma + DTO + migration; propagés vers le moteur via `rules.analysis_timeframe` / `entry_timeframe`.
- [x] 🤖 **Scan dynamique** : `SignalsService.triggerScan` envoie les `Strategy` actives avec leurs `rules` à `/scan/multi`; le moteur itère les stratégies via `evaluate_strategy`.
- [x] 🤖 **Stratégie par défaut seed** : seed `EMA Trend + RSI` avec `analysisTimeframe=4h` et `entryTimeframe=1h`.
- [x] 🤖 **`UserStrategy.customRules`** : endpoint `PATCH /strategies/:id/toggle` et `PUT /strategies/mine/:strategyId` permettent d'activer/désactiver et de surcharger les règles.
- [x] 🤖 **Champ `Signal.strategyId`** : `SignalsService.saveSignals` utilise `r.strategy_id` retourné par le moteur, avec fallback sur la stratégie seedée par défaut.

##### Lab (recherche + validation)
- [x] 🤖 **Backend Lab** : CRUD `LabSession`, lancement backtest via engine (`POST /lab/sessions/:id/backtest`), évaluation score/verdict.
- [x] 🤖 **Profiler** : `POST /lab/sessions/:id/suitability` et `profileSuitability` pour les sessions Lab.
- [x] 🤖 **Rapport par décision** : `GET /lab/sessions/:id/report` avec market conditions, trade details, stats et recommandations.
- [x] 🤖 **Comparaison backtest vs paper / overfitting** : `GET /lab/sessions/:id/walk-forward` (split IS/OOS + score de surapprentissage).
- [x] 🤖 **Activation production** : `POST /lab/sessions/:id/promote` crée une `Strategy` inactive depuis une session Lab complétée avec métriques suffisantes.
- [x] 🤖 **Frontend Lab** : page `/lab` avec création, backtest, évaluation, profil, rapports et walk-forward.

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
  - [x] 🤖 Moteur prédictif v1 (heuristique, sans ML) : `utils/predictive.py` — cf. todo2.md Sprint 4 ✅
  - [x] 🤖 Score `P(bullish_next_X_bars)` / `P(bearish_next_X_bars)` — v1 heuristique via `compute_dps()` (confidence + regime + mtf + volume), pas encore un modèle statistique entraîné sur outcomes réels
  - [x] 🤖 Expected move : projection haut/bas basée sur ATR + structure. ✅ `compute_expected_move()`
  - [x] 🤖 Trigger Probability Score (TPS) pour les modes RETEST/LIMIT. ✅ `compute_tps()`
  - [ ] 🤖 ML Signal Success Predictor (`P(win)`) — nécessite un modèle entraîné (XGBoost/logistic) sur `SignalLog`/outcomes, pas fait
  - [x] 🤖 Liquidity Sweep Predictor ✅ — `ml/predictive_features.py::detect_liquidity_sweep()`
    - EQH/EQL proches, détection de fakeout (mèche au-delà + clôture retour), direction et niveau cible
  - [x] 🤖 Compression → Expansion Detector ✅ — `ml/predictive_features.py::detect_compression_expansion()`
    - BB width percentile + ATR percentile historique, squeeze_count, direction prédite
  - [x] 🤖 Signaux générés seulement si `DPS > 60%` ✅ (`min_dps` dans `StrategyRules`, filtre appliqué dans `evaluate_strategy()` + `analyze_candles()`) — `P(win) > 55%` (ML) reste à faire

### 1. Stratégies : le moteur ne les utilise pas encore (critique) ⚠️ **SECTION OBSOLÈTE — vérifiée, 4/5 déjà faits**

- **Problème (résolu depuis)** : `scan.py` génère les signaux avec une logique hardcodée (`analyze_candles`) et enregistre tout sous la stratégie fixe `"EMA Trend + RSI"`.
- **À faire** :
  - [x] 🤖 Récupérer les `Strategy` actives depuis l'API dans `scan.py`. ✅ `signals.service.ts:_scanActiveAssets` fetch `strategy.findMany({isActive:true})` → transmis via `req.strategies`
  - [x] 🤖 Appeler `evaluate_strategy()` avec les `rules` JSON au lieu de la logique hardcodée. ✅ (`analyze_candles` bascule sur `evaluate_strategy()` dès qu'une stratégie est fournie)
  - [x] 🤖 Créer une seed `"EMA Trend + RSI"` en DB avec les règles équivalentes. ✅ `prisma/seed.ts` migré en format DSL
  - [ ] 🤖 Permettre `UserStrategy.customRules` pour outrepasser certains paramètres par utilisateur. ❌ **confirmé non fait** — le champ `customRules Json?` existe sur `UserStrategy` mais `_scanActiveAssets` ne fetch/merge que les `Strategy` globales, aucune prise en compte des overrides par utilisateur dans le scan auto
  - [x] 🤖 S'assurer que `Signal.strategyId` pointe vers la bonne stratégie. ✅ (`signals.service.ts` : `strategyId: strategy.id`)

### 2. Profils utilisateur : signaux non tagués ⚠️ **SECTION OBSOLÈTE — 4/5 déjà faits (Sprint 2, cf. todo2.md)**

- **Problème (résolu depuis)** : aucun signal ne portait d'information `profileSuitability` (INVESTOR / SWING / DAY / SCALPER).
- **À faire** :
  - [x] 🤖 Fonction équivalente à `compute_profile_suitability()`. ✅ `derive_profile_suitability()` dans `strategy_eval.py` (filtre timeframe + RR min + seuil confiance par profil)
  - [x] 🤖 Champ `profileSuitability` sur le modèle `Signal`. ✅ `schema.prisma:221` (`String[]`)
  - [x] 🤖 Endpoint `GET /signals?profile=SWING`. ✅ `signals.controller.ts` + `signals.service.ts`
  - [x] 🤖 Badges profils sur les cartes signaux. ✅ `signals/page.tsx`
  - [x] 🤖 Sizing / R/R par profil dans `risk.py` ✅ — paramètre `profile` (conservative/moderate/aggressive), hard cap et R/R ajustés selon le profil

### 3. Détection précoce de tendance (early trend)

- **Problème** : le système détecte la structure (BOS/CHoCH), les OB/FVG, le régime, mais pas les divergences, sweeps ou compressions.
- **Conséquence** : on confirme le mouvement plus qu'on ne le prévient.
- **À faire** :
  - [x] 🤖 Divergences RSI / MACD ✅ — `ml/predictive_features.py::detect_rsi_divergence()`, `detect_macd_divergence()`
  - [x] 🤖 Compression Bollinger + explosion de volatilité ✅ — `detect_compression_expansion()`
  - [x] 🤖 Liquidity sweep / fakeout detection ✅ — `detect_liquidity_sweep()`
  - [x] 🤖 Volume anomalie ✅ — `detect_volume_anomaly()`
  - [ ] 🤖 Volume profile (distribution des volumes par niveau de prix)
  - [ ] 🤖 Momentum leading (ROC, Stochastique, Williams %R)

### 4. Continuation et épuisement d'une tendance en cours

- **Problème** : pas d'analyse du "jusqu'où peut aller la tendance actuelle".
- **Conséquence** : TP2 parfois trop optimiste ou conservateur, pas de trailing stop adaptatif.
- **À faire** :
  - [x] 🤖 Score de continuation basé sur ADX, structure intacte, volume, divergence HTF ✅ — `continuation_score()` dans `routers/probability.py`
  - [x] 🤖 Détection d'épuisement : divergence HTF, structure cassée, volume faible ✅ — action `EXHAUSTED` dans `continuation_score()`
  - [x] 🤖 Ajuster TP2 ou activer trailing stop selon ce score ✅ — actions `HOLD` / `MOVE_TO_BREAK_EVEN` / `ACTIVATE_TRAILING` / `EXHAUSTED`

### 5. Trailing stop et gestion dynamique des positions

- **État actuel (mis à jour)** : implémenté et testé.
  - Module engine dédié avec méthodes ATR/swing/EMA/chandelier
  - Job périodique `syncTrailingStops` toutes les 30s
  - Fermeture auto via `closeByWatcher()` avec raison `TRAILING`
  - UI toggle + méthode + niveau affiché sur desktop et mobile
  - Notification SSE/toast lors du déclenchement
- **À faire** :
  - [x] 🤖 Module `engine/routers/trailing_stop.py` ✅.
  - [x] 🤖 Méthodes : ATR trailing, structure (dernier swing), EMA trailing, chandelier trailing ✅.
  - [x] 🤖 Job périodique (30s-1min) pour recalculer les trailing stops ✅.
  - [x] 🤖 Fermeture auto des positions si trailing stop touché ✅.
  - [x] 🤖 UI : toggle + niveau affiché sur la position ✅.

### 6. Testeur Lab (validation stratégies par profil et marché)

- **État actuel (mis à jour)** : un premier backend Lab est en place.
  - `LabSession` persistée avec snapshot stratégie, symbol/timeframe, métriques de backtest et liste des trades.
  - Endpoints `POST /lab/sessions`, `POST /lab/sessions/:id/backtest`, `POST /lab/sessions/:id/evaluate`, `POST /lab/sessions/:id/archive`.
  - Évaluation score/verdict (`STRONG`, `PROMISING`, `MARGINAL`, `REJECT`) basée sur profit factor, win rate, expectancy, drawdown, Sharpe.
  - Comparaison vs buy & hold via métriques `benchmark_pnl_pct` / `outperformance_pct`.
  - ⚠️ Reste : multi-marchés simultanés, paper vs backtest avec données paper temps réel.
- **À faire** :
  - [x] 🤖 Backend Lab : CRUD session + backtest + évaluation.
  - [x] 🤖 DSL JSON + connecteur engine `backtest.py` (la stratégie snapshot est passée au backtest).
  - [x] 🤖 Profiler : `profileSuitability` par signal Lab (profil risque conservateur/modéré/agressif + contraintes personnalisées).
  - [x] 🤖 Templates DSL : `GET /lab/templates`.
  - [x] 🤖 Rapport détaillé par décision (market conditions, reasoning, trace).
  - [x] 🤖 Walk-forward anti-overfitting (IS/OOS split, decay metrics, overfit score).
  - [ ] 🤖 Comparaison backtest vs paper trading (nécessite données paper en temps réel).
  - [x] 🤖 Frontend Lab.

### 7. Feedback loop et expérience utilisateur

- **État actuel (mis à jour)** : plusieurs briques en place.
  - Journal auto sur clôture de position (`positions.service.ts`).
  - Calibration de la `confidence` par bucket historique + prédicteur `P(win)` via régression logistique v0 (`SignalPredictorService`).
  - SignalLog enregistre les features et outcomes pour alimenter le feedback.
  - `POST /ai/review/position/:positionId` + UI Portfolio fournissent l'analyse post-trade via LLM.
  - `SignalPredictorService` entraîne un modèle logistique sur les features des `SignalLog` et expose l'importance relative (`GET /signals/predictor/weights`).
  - UI Signaux affiche le bouton "Entraîner" et les barres de poids normalisés.
  - [x] Chat conversationnel Copilot (`/copilot`) via `POST /ai/chat` → `POST /engine/llm/chat`.
  - ⚠️ Reste : rafraîchissement automatique post-entraînement.
- **À faire** :
  - [x] 🤖 Journal enrichi avec PnL, raison de sortie et données position.
  - [x] 🤖 Score post-trade / calibration confidence via `SignalOutcomeService` + `SignalPredictorService`.
  - [x] 🤖 "Trading Copilot" v0 : explication du trade gagnant/perdant via `review-position` LLM.
  - [x] 🤖 Ajustement / visualisation automatique du poids des features via `SignalPredictorService`.

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
  - [x] Tests unitaires NestJS critiques (auth, positions, watcher) manquants. ✅
  - [ ] Migrations Prisma strictes (`prisma migrate deploy` en prod).

## Fibonacci, Harmonic Patterns & Pattern Engine (d’après rapport 16/07/2026)

### Phase A — Immédiat

- [x] **Staged Stop Engine** dans `apps/engine/routers/risk.py` ✅
  - SL initial (invalidation structurelle), break-even après TP1, stop structurel après TP2, trailing dynamique.
  - Modèle `StagedStopRequest/Response` + endpoint `/risk/staged-stop` + tests.
- [x] **Pattern Engine minimal** dans `apps/engine/patterns/` ✅
  - Classe de base `MarketPattern`.
  - `double_top.py`, `double_bottom.py`, `head_shoulders.py`.
  - `harmonic.py` : ABCD, Gartley, Bat (tolérance ±2 %).
  - `detector.py` : coordonne la détection sur une série de pivots.
- [x] **Intégration scan** : `metadata.detectedPatterns`, `prz`, `fibTargets`, `confluenceScore` ✅
- [x] **Tests unitaires** pour chaque pattern et le staged stop ✅

### Phase B — Court terme

- [x] **Harmonic Patterns intermédiaires** : Butterfly, Crab (+ placeholders Shark, 5-0) ✅
- [x] **Confluence scorer** : pattern + Order Block + liquidity sweep + BOS/CHoCH + contexte HTF ✅
- [x] **UI SignalCard** : affichage PRZ, niveaux Fibonacci, patterns détectés ✅
- [x] **Journal / Backtest par pattern** : tracker win rate, R/R moyen, durée moyenne par pattern et actif ✅

### Phase C — Moyen terme

- [x] **Geometry Engine** : abstraction des structures de marché (pivots, swings, ratios) ✅
- [x] **ML sur patterns** : prédiction du outcome d’un pattern via features structurels ✅

### Phase D — Long terme

- [ ] **Market Graph Engine** : graphe de pivots/arêtes + GNN.
- [ ] **Rust / PyO3** uniquement si un profiler justifie un goulot d’étranglement Python.

---

### Vue d'ensemble des priorités

```
🔴 Bloquant avant prod     : Stratégies dynamiques + Profils + Tests critiques
🟠 Important post-MVP      : Early trend + Trailing stop + Feedback loop
🟡 Stratégique Phase A/B   : On-chain/macro/fondamentaux
🟢 Long terme               : Lab complet + Agent analyste + DEX avancé + Patterns/Harmonics
```


Faire des analyses long termes du genres et autres Q1, Q2, Q3, Q4; les dominances;


Fibonacci? Notion de divergence haussiere, baissiere

Google trends
