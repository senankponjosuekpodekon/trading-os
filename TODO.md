# Trading OS — TODO Master

> Légende : 🤖 = Cascade fait | 👤 = Toi (action externe) | ⚡ = Priorité haute | 🔁 = Récurrent

---

## 🔑 À FAIRE PAR TOI (actions externes / comptes)

### Clés API
- [ ] 👤 Créer compte **newsapi.org** (gratuit) → copier `NEWS_API_KEY` dans `.env`
  - Lien : https://newsapi.org/register
  - Plan gratuit : 100 req/jour — suffisant (cache 15 min actif)
- [ ] 👤 Optionnel : créer compte **OpenAI** → `OPENAI_API_KEY` pour activer GPT-4o
  - Alternative gratuite : installer Ollama local (`ollama pull llama3.2`)
- [ ] 👤 Optionnel : créer compte **Twelve Data** → `TWELVE_DATA_API_KEY` pour Forex réel
  - Plan gratuit : 800 req/jour — https://twelvedata.com
- [ ] 👤 Optionnel : générer **DERIV_TOKEN** pour trades réels
  - App Deriv → API Token → permission : Trade, Read
  - Sans token : mode paper actif automatiquement

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

### ⚡ Modularité & Scalabilité (Backend Engine)

- [ ] 🤖 ⚡ **Scraper personnalisé** — remplacer dépendance brvm.org fragile
  - Scraper robuste avec fallback multiple (brvm.org → africainvesting.com → cache local)
  - Détection auto changement structure HTML (parser adaptatif)
  - Stockage en DB PostgreSQL (table `brvm_quotes` + historique)
  - Refresh planifié toutes les heures via tâche de fond
  - Endpoints : `/brvm/scrape/force`, `/brvm/scrape/status`

- [ ] 🤖 ⚡ **Cache Redis centralisé** — actuellement cache mémoire Python dans `news.py`
  - Migrer tous les caches mémoire (`_cache` dict dans `news.py`, `scan.py`) vers Redis
  - TTLs : news 15min, klines 5min, BRVM quotes 60min, scan results 30s
  - Pattern `cache_or_fetch()` centralisé dans `utils/cache.py`

- [ ] 🤖 ⚡ **Pagination API NestJS** — endpoints `/signals`, `/positions`, `/journal`
  - Ajouter `?page=&limit=&sort=` sur tous les endpoints liste
  - Cursor-based pagination pour le journal (volume élevé prévu)

- [ ] 🤖 **Rate limiting par user** — actuellement global IP dans engine
  - NestJS : Throttler par userId (pas IP) pour éviter abus authentifiés
  - Engine FastAPI : rate limit par clé API future

- [ ] 🤖 **Séparation config/env** — valeurs hardcodées dans les routers
  - Créer `engine/config.py` centralisé (Pydantic Settings)
  - Éliminer `os.getenv(...)` dispersés dans chaque router

- [ ] 🤖 **Éliminer mock data restants** — positions PnL live parfois fallback 0
  - Vérifier `fetchLivePrice()` dans `positions.service.ts` sur tous actifs
  - Ajouter fallback Twelve Data si Binance ne répond pas sur un actif

### ⚡ Performance & Chargement Rapide

- [ ] 🤖 ⚡ **Next.js optimisations**
  - Ajouter `staleTime` cohérent sur tous les `useQuery` (actuellement manquant sur 5 pages)
  - `refetchOnWindowFocus: false` global dans QueryClient (évite re-fetch inutiles)
  - Lazy loading des composants lourds (`Chart`, `Backtest`) avec `dynamic(() => import(...))`
  - Image optimization si ajout de logos/icônes actifs

- [ ] 🤖 ⚡ **Prefetch données critiques**
  - Dashboard : prefetch prix + portfolio summary au layout level (pas dans la page)
  - Signals : garder dernier scan en cache Redis 30s → pas de reload à chaque visite

- [ ] 🤖 **Compression HTTP**
  - NestJS : activer `compression` middleware (gzip/brotli sur JSON responses)
  - Engine FastAPI : activer `GZipMiddleware` pour réponses > 1KB

- [ ] 🤖 **Index base de données**
  - Vérifier indexes Prisma sur : `Signal.createdAt`, `Position.userId`, `JournalEntry.createdAt`
  - Ajouter index composite sur `Signal(userId, createdAt DESC)` pour le feed

- [ ] 🤖 **WebSocket stabilité**
  - Reconnexion auto avec backoff exponentiel si WS déconnecté (actuellement pas de retry)
  - Heartbeat ping/pong côté client pour détecter connexions mortes

### Scraper Personnalisé (détail)

- [ ] 🤖 **`engine/scrapers/brvm_scraper.py`**
  - Sources primaire + fallback :
    1. `brvm.org/fr/cours-actions/0` (actuel)
    2. `africainvesting.com/stocks/brvm/` (backup)
    3. Cache DB PostgreSQL (dernier scrape valide)
  - Normalisation données : XOF, variation %, volume
  - Stockage historique : table `brvm_daily_prices(symbol, date, open, high, low, close, volume)`
  - Cron interne FastAPI : scrape auto à 16h30 UTC (heure fermeture BRVM)

- [ ] 🤖 **`engine/scrapers/crypto_news_scraper.py`**
  - Sources sans API key : CoinDesk RSS, CryptoCompare public, Decrypt RSS
  - Fallback si NewsAPI quota épuisé (100/jour plan gratuit)
  - Parser RSS universel (`feedparser`) → même format que NewsAPI

- [ ] 🤖 **`engine/scrapers/forex_calendar_scraper.py`**
  - Calendrier économique Forex Factory (événements macro : NFP, CPI, FOMC)
  - Impact HIGH = avertissement dans signaux Forex avant publication
  - Scrape hebdomadaire + cache DB

### Notifications SSE (complétude)

- [ ] 🤖 **Brancher les notifications dans le flux métier**
  - `signals.service.ts` : push notif quand signal BUY/SELL confiance > 70
  - `watcher.service.ts` : push notif quand SL/TP touché sur position
  - `journal.service.ts` : push notif quand trade fermé automatiquement
  - Frontend : badge compteur + toast notification dans `AppLayout`

### RAG & IA (enrichissement)

- [ ] 🤖 **Ingestion auto quotidienne RAG**
  - Tâche planifiée (FastAPI lifespan) : ingest news du jour dans pgvector à 8h UTC
  - Deduplication par hash titre avant embedding
  - Endpoint `/rag/ingest/today` pour déclencher manuellement

- [ ] 🤖 **Vectoriser le journal de trading**
  - Chaque trade clôturé → embedding automatique → ajout RAG
  - L'assistant peut alors répondre "quand est-ce que tu as bien tradé BTC ?"

- [ ] 🤖 **Strategy Builder Agent** (J23 suite)
  - Endpoint `/ai/strategy/suggest` : LLM génère des règles de stratégie basées sur historique
  - Paramètres : style (scalp/swing/position), actif, tolérance risque
  - Output JSON compatible avec le format `Strategy.rules` existant

---

## 🚀 Déploiement (J30)

- [ ] 👤 Louer VPS Hetzner (CX21 min — 2 vCPU, 4GB RAM, 40GB SSD)
  - Région : Nuremberg ou Helsinki (latence Europe/Afrique ok)
  - OS : Ubuntu 24.04 LTS
- [ ] 👤 Pointer domaine DNS → IP VPS
- [ ] 🤖 Créer `docker-compose.prod.yml` avec tous les services
- [ ] 🤖 Créer `Dockerfile` pour NestJS API (déjà fait pour Engine)
- [ ] 🤖 Créer `Dockerfile` pour Next.js Web
- [ ] 🤖 Config Nginx reverse proxy + SSL Let's Encrypt
- [ ] 🤖 Script deploy `deploy.sh` (pull → build → restart)
- [ ] 👤 Configurer secrets GitHub/Hetzner pour CI/CD optionnel
- [ ] 🤖 Health checks Docker Compose (tous services)
- [ ] 🤖 Backup automatique PostgreSQL (pg_dump cron quotidien)

---

## 📊 Features Futures (post-déploiement)

- [ ] 🤖 **Alertes prix** — définir un prix cible → notif SSE + email quand atteint
- [ ] 🤖 **Multi-compte** — support plusieurs portfolios par user
- [ ] 🤖 **Export CSV/PDF** — journal + rapport performance
- [ ] 🤖 **Scoring ML** — scikit-learn sur historique signaux pour affiner confiance
- [ ] 🤖 **Calendrier économique** — page dédiée événements macro (FOMC, NFP, CPI)
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


Apres nous aller travailler actif par actif et marché par marché