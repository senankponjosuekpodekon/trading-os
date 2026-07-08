# ⚡ Trading OS — AI Investment Operating System

Système d'investissement assisté par IA : signaux techniques en temps réel, gestion de portfolio, paper trading, journal automatique, backtest, BRVM, Deriv V75, et LLM (GPT-4o / Ollama).

---

## Stack technique

| Couche | Technologie |
|--------|------------|
| **Frontend** | Next.js 15, React 18, TailwindCSS v4, Zustand, React Query |
| **Backend API** | NestJS 11, TypeScript, Prisma ORM, JWT Auth, SSE, Throttler, Helmet |
| **Moteur Python** | FastAPI, Pandas, NumPy, HTTPX, slowapi, BeautifulSoup |
| **IA / LLM** | OpenAI GPT-4o ou Ollama (local, gratuit) + RAG pgvector |
| **Base de données** | PostgreSQL (+ pgvector), Redis |
| **Infra** | Docker Compose, Turborepo monorepo |

---

## Architecture

```
trading-os/
├── apps/
│   ├── api/          → NestJS REST API (port 3001)
│   │   ├── src/
│   │   │   ├── auth/          auth JWT (register, login)
│   │   │   ├── users/         profil utilisateur
│   │   │   ├── portfolios/    portfolios paper/live
│   │   │   ├── signals/       signaux + scan engine
│   │   │   └── prisma/        service Prisma global
│   │   └── prisma/
│   │       ├── schema.prisma  modèles DB
│   │       └── seed.ts        données initiales
│   ├── engine/       → FastAPI Python (port 8000)
│   │   ├── routers/
│   │   │   ├── scan.py        scan multi-actifs (EMA/RSI/MACD/BB/SMC)
│   │   │   ├── backtest.py    backtesting sur données historiques
│   │   │   ├── llm.py         explications IA (GPT-4o / Ollama)
│   │   │   ├── brvm.py        cours BRVM + signaux UEMOA
│   │   │   ├── deriv.py       Deriv multi-indices (17 symboles)
│   │   │   ├── rag.py         RAG embeddings + pgvector
│   │   │   ├── risk.py        risk engine (position sizing)
│   │   │   └── ws.py          WebSocket prix temps réel
│   │   └── requirements.txt
│   └── web/          → Next.js frontend (port 3000)
│       └── src/app/
│           ├── dashboard/     vue globale + raccourcis
│           ├── signals/       signaux + explication IA
│           ├── chart/         graphique bougies + marqueurs
│           ├── portfolio/     positions ouvertes + historique + PnL live
│           ├── backtest/      formulaire + courbe de capital
│           ├── ai/            assistant IA + rapport hebdo
│           ├── brvm/          marché BRVM (cours + movers)
│           ├── deriv/         Deriv multi-indices (Boom/Crash/Jump/Step/Volatility)
│           ├── ai/            assistant IA + chat RAG + rapport hebdo
│           └── journal/       journal de trading auto
├── docker-compose.yml
├── dev.sh            → démarre tout en une commande
└── .env.example
```

---

## Démarrage rapide

### Prérequis
- Node.js 24 (via nvm)
- Python 3.13 + virtualenv
- Docker & Docker Compose

### 1. Cloner et installer

```bash
git clone <repo>
cd trading-os
cp .env.example apps/api/.env
npm install --legacy-peer-deps
```

### 2. Environnement Python

```bash
cd apps/engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Lancer l'infrastructure Docker

```bash
docker compose up postgres redis -d
```

### 4. Migrations + Seed

```bash
cd apps/api
npx prisma migrate dev
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

### 5. Tout démarrer en une commande

```bash
./dev.sh
```

---

## Variables d'environnement

Copier `.env.example` → `apps/api/.env` :

```env
DATABASE_URL=postgresql://trading_user:trading_pass@localhost:5433/trading_os
REDIS_URL=redis://localhost:6380
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRES_IN=7d
ENGINE_URL=http://localhost:8000
PORT=3001
# CORS — séparer par virgule pour plusieurs origines
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

Frontend `apps/web/.env.local` :

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_ENGINE_URL=http://localhost:8000
```

Engine `apps/engine/.env` (optionnel) :
```env
TWELVE_DATA_API_KEY=your_key   # Forex réel EUR/USD, XAU/USD, WTI
DERIV_TOKEN=your_token          # Trades réels Deriv
ALLOWED_ORIGINS=http://localhost:3000
```

### IA / LLM (optionnel)

**Option 1 — Ollama (local, gratuit) :**
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
# Dans apps/engine/.env :
# LLM_PROVIDER=ollama
# OLLAMA_MODEL=llama3.2
```

**Option 2 — OpenAI GPT-4o :**
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
```

---

## Services & ports

| Service | Port | URL |
|---------|------|-----|
| Next.js Web | 3000 | http://localhost:3000 |
| NestJS API | 3001 | http://localhost:3001/api |
| Python Engine | 8000 | http://localhost:8000/docs |
| PostgreSQL | 5433 | localhost:5433 |
| Redis | 6380 | localhost:6380 |

---

## Connexion de développement

```
DB Host:     localhost:5433
DB Name:     trading_os
DB User:     trading_user
DB Password: trading_pass

Compte test:
  Email:    test@trading.os
  Password: password123
```

Prisma Studio (interface DB visuelle) :
```bash
cd apps/api && npx prisma studio
# → http://localhost:5555
```

---

## API Endpoints

### Auth
```
POST /api/auth/register        { email, password, name }
POST /api/auth/login           { email, password }
```

### Portfolios & Positions
```
GET  /api/portfolios
GET  /api/positions/live       → PnL temps réel (prix Binance)
POST /api/positions            { portfolioId, assetSymbol, direction, entryPrice, quantity, stopLoss, takeProfit }
POST /api/positions/from-signal/:signalId  → paper trade depuis signal
PATCH /api/positions/:id/close { exitPrice }
GET  /api/positions/summary    → win rate, total PnL, open/closed
```

### Signals
```
GET  /api/signals?limit=50
POST /api/signals/scan         { symbols: string[], timeframe: string }
```

### IA
```
GET  /api/ai/health
POST /api/ai/explain/signal/:signalId  → explication LLM d'un signal
POST /api/ai/explain           { symbol, signal, indicators, ... }
POST /api/ai/weekly-report     { trades, win_rate, total_pnl, ... }
```

### Journal & Notifications
```
GET  /api/journal
POST /api/journal
GET  /api/notifications
GET  /api/notifications/stream  (SSE)
```

### Engine Python (port 8000)
```
GET  /health
POST /scan/multi               { symbols, timeframe }
POST /backtest/run             { symbol, timeframe, lookback_bars, initial_capital }
POST /llm/explain              { symbol, signal, confidence, indicators, ... }
GET  /brvm/quotes              → cours BRVM live
POST /brvm/scan                → signaux UEMOA
GET  /deriv/health
POST /deriv/analyze            { symbol: "R_75" }
POST /deriv/scalp              { symbol, stake, duration }
POST /risk/position-size       { capital, risk_pct, entry, stop_loss }
```

---

## Tests

```bash
# Tests unitaires Python (engine)
cd apps/engine
source .venv/bin/activate
python3 -m pytest tests/ -v

# TypeScript type check
cd apps/api   && npx tsc --noEmit
cd apps/web   && npx tsc --noEmit
```

---

## Actifs supportés

| Marché | Actifs |
|--------|--------|
| **Crypto** | BTC, ETH, SOL, BNB, AVAX, ADA, DOT, LINK, MATIC, XRP, LTC… |
| **Forex réel** | EUR/USD, GBP/USD, USD/JPY, AUD/USD, XAU/USD, WTI (via Twelve Data) |
| **BRVM (UEMOA)** | ONTBF, SGBF, BOABF, ETIT, SIVC, PALC… (15 titres) |
| **Synthétiques Deriv** | Volatility (V10/25/50/75/100), Boom (300/500/1000), Crash (300/500/1000), Jump (10/25/50/75/100), Step Index |

---

## Roadmap — 30 jours

| Semaine | Status | Contenu |
|---------|--------|---------|
| **S1** J1-7 | ✅ | Bootstrap, Auth, Dashboard, Scan live, WebSocket, Price Action Phase 1 |
| **S2** J8-14 | ✅ | S&R, Candlestick, BOS/CHoCH, FVG, Order Blocks, SMC, Régime marché |
| **S3** J15-21 | ✅ | Portfolio live, Paper Trading, Watcher, MACD/BB, Test E2E |
| **S4** J22-29 | ✅ | LLM (GPT-4o/Ollama), BRVM, Deriv multi-indices (17 sym), Backtest, Twelve Data Forex |
| **J23+** | ✅ | Sécurité prod (Helmet, rate limiting, CORS), RAG pgvector en cours |
| **J30** | ⏳ | Déploiement Hetzner VPS + Docker Compose |

### Sécurité implémentée
- **NestJS** : Helmet, ThrottlerModule (10 req/s global, 5 req/min auth), CORS strict via `ALLOWED_ORIGINS`
- **FastAPI** : slowapi (200 req/min + 1000 req/h), CORS restreint

---

## Licence

Usage privé — projet en développement.
