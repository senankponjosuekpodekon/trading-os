# Trading OS — TODO Master

> Légende : 🤖 = Cascade fait | 👤 = Toi (action externe) | ⚡ = Priorité haute | 🔁 = Récurrent

---

## Vision du projet

```
MVP (actuel)       → Signaux techniques + LLM + Paper trading
Phase A (prochain) → Enrichissement par marché : on-chain, macro, tick stats
Phase B            → ML scoring + feedback loop + pandas-ta migration
Phase C            → Analyse asymétrique pré-listing + alpha on-chain
Phase D            → Multi-agents autonomes + exécution réelle
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

- [ ] 🤖 ⚡ **Next.js optimisations**
  - `staleTime` cohérent sur tous les `useQuery`
  - `refetchOnWindowFocus: false` global dans QueryClient
  - Lazy loading `Chart`, `Backtest` avec `dynamic(() => import(...))`

- [ ] 🤖 ⚡ **Prefetch données critiques**
  - Dashboard : prefetch prix + portfolio au layout level
  - Signals : garder dernier scan en cache Redis 30s

- [ ] 🤖 ⚡ **Vitesse signaux < 1 seconde**
  - Migrer calculs techniques vers `pandas-ta` (remplace TA-Lib manuel)
  - Paralléliser fetch multi-symboles avec `asyncio.gather`
  - Pré-calculer features en background toutes les 30s → scan devient lookup

- [ ] 🤖 **WebSocket stabilité**
  - Reconnexion auto avec backoff exponentiel
  - Heartbeat ping/pong côté client

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

### 🧠 Phase B — Machine Learning & Feedback Loop

> Condition : 500+ signaux enregistrés avec résultats réels dans le journal

- [ ] 🤖 **`engine/ml/feature_store.py`** — Stocker les features brutes
  - À chaque signal généré : sauvegarder les 50+ features numériques en DB
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

- [ ] 🤖 **Backtester ML** — valider edge du modèle
  - Walk-forward testing (pas de look-ahead bias)
  - Comparer ML signal vs technique seul sur historique
  - Métriques : Sharpe, win rate, profit factor, max drawdown

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

- [ ] 🤖 **Architecture multi-agents par marché**
  ```
  Agent Macro        → surveille Fed, BCE, BIS, calendrier éco
  Agent On-Chain     → surveille exchange flows, MVRV, whale moves
  Agent Technique    → price action, SMC, indicators
  Agent Sentiment    → news NLP, social, LunarCrush
  Agent Risque       → position sizing, drawdown, corrélations
  Agent Superviseur  → agrège tous les agents → décision finale
  ```

- [ ] 🤖 **Exécution automatique paper → réel**
  - Mode paper → validé 3 mois → passage réel avec limite de capital
  - Deriv API → exécution automatique V75/V100 si signal confiance > 80
  - Binance API → exécution crypto si signal asymétrique confirmé

- [ ] 🤖 **Continuous learning pipeline**
  - Chaque trade clôturé → features + résultat → re-entraînement auto
  - A/B testing stratégies → sélection darwiniste des meilleurs modèles

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

### 🟡 Priorité 2 — Qualité prod

#### Tests
- [x] 🤖 **Tests NestJS** ✅ — infrastructure démarrée
  - `auth.service.spec.ts` : register, login, refresh rotation, reuse detection, token invalide, token expiré (9 tests ✅)
  - `positions.service.spec.ts` : open, close, SL trigger, TP trigger, drawdown block (4 tests ✅)
  - `watcher.service.spec.ts` : fermeture auto correcte BUY/SELL, journal auto (3 tests ✅)
  - `signals.service.spec.ts` : filtrage par confiance, pagination (3 tests ✅)
  - Objectif : 30+ tests → continuer d'ajouter des cas edge

- [x] 🤖 **Tests Python Engine** (élargissement) ✅
  - `test_scan.py` : `analyze_candles` sur séries BUY/SELL + no data
  - `test_news_scraper.py` : sentiment heuristic, aggregate, hash
  - `test_regime.py` : trending/ranging/volatile + bonus/filtre
  - `test_risk.py` : sizing, targets, ajustements régime, plafonnements
  - **Total : 71 tests passent**

- [x] 🤖 **Tests Next.js** ✅ (étendus)
  - Auth login/register : render, submit success, validation error
  - ErrorBoundary : fallback UI quand enfant throw
  - Dashboard : render avec data, skeleton loading, error state
  - Signals : empty state, liste, scan mutation
  - Portfolio : render + fetch data, switch historique
  - Setup Jest + React Testing Library + ts-jest
  - **Total : 16 tests passent**

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

- [ ] 🤖 **Refresh token rotation**
  - Access token 15min + Refresh token 7j en cookie httpOnly
  - Rotation à chaque refresh (invalidation ancien token)
  - Blacklist tokens révoqués en Redis

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
- [x] Strategies CRUD + activation
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

### 10. Prix des actifs par marché
- **Page Deriv** manque les prix live.
- **À faire** : widget “Prix du marché” alimenté par `/ws/prices` ou `/prices/latest`.

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

## Priorité d’implémentation mise à jour

1. **Quick win** : prix live dans les cartes signaux + endpoint `/prices/latest`.
2. **Quick win** : widget prix par marché (Deriv + dashboard).
3. **Moyen** : simulation d’un signal spécifique (`/signals/{id}/simulate`).
4. **Moyen** : templates / prompt IA pour création de stratégie.
5. **Moyen** : affichage des PDFs émetteurs + extraction d’indicateurs BRVM.
6. **Moyen** : suivi des positions ouvertes avec alertes et impact.
7. **Long** : extension des actifs (stocks, indices, commodities supplémentaires).
8. **Long** : types de signaux avancés (multiple TP, trailing stop, pyramiding).

**Déjà livré :**
- Intégration des symboles BRVM dans le scan global.
- Scraper rapports sociétés cotées et score fondamental.
- Onglets Signaux / Rapports / Marché / Tous les titres sur la page BRVM.