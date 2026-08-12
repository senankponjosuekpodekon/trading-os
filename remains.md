
**Massive.com** (anciennement **Polygon.io**) — c'est un fournisseur d'API de données de marché. Rebrandé le 30 oct 2025.

## Ce que Massive.com offre

| Marché | Données | Transport |
|--------|---------|-----------|
| **US Stocks** | Trades, quotes, agrégats (minute/second), dark pools, pre/post-market | REST + WebSocket |
| **Forex** | Temps réel + historique (10+ ans), sources institutionnelles (pas de broker tiers) | REST + WebSocket |
| **Crypto** | Trades temps réel, historique, multi-exchanges | REST + WebSocket |
| **Options** | Chaînes, Greeks, trades | REST |
| **Indices** | Temps réel + historique | REST |

## Est-ce qu'on en a besoin ?

**Oui, potentiellement pour 2 cas :**

1. **Phase J — US Stocks & Indices** (NASDAQ, S&P500, AAPL) → Massive est la source de référence pour les actions US. Actuellement le moteur n'a pas de provider US Stocks. Massive comblerait ce gap avec trades temps réel, agrégats, dark pools.

2. **Liquidity score Forex** (Phase 0++) → Massive fournit du forex temps réel depuis sources institutionnelles, potentiellement plus fiable que Twelve Data pour le bid-ask spread et depth.

**Ce qui existe déjà dans ton codebase :**
- Crypto → Binance API (direct)
- Forex → Oanda / Twelve Data
- BRVM → scraping manuel
- Synthetic → Deriv API

**Ce qui manque :**
- US Stocks → **Massive serait le bon choix** (couverture 100% US equities, dark pools, WebSocket temps réel)
- Le client Python officiel existe (`pip install massive-client`) avec `MASSIVE_API_KEY`

## Pricing

- **Stocks** : tier gratuit (15-min delayed, 2 ans historique) → tier payant (temps réel, 20+ ans, WebSockets)
- **Currencies** : tier gratuit (5 calls/min, end-of-day) → tier payant (temps réel, illimité)

## Recommandation

Si tu veux intégrer Massive, l'use case le plus pertinent est **Phase J (US Stocks)**. L'API key va dans [.env](cci:7://file:///root/projects/trading-os/.env:0:0-0:0) (`MASSIVE_API_KEY`), et le client Python s'intègre directement dans `apps/engine`. Veux-tu que je l'intègre ?



Annotations (warnings non-bloquants)
Node.js 20 deprecated sur actions/checkout@v4 et actions/setup-node@v4 — à upgrader vers Node 22 quand tu veux
Unused imports dans execution.service.ts (ConflictException, ServiceUnavailableException) et execute-order.dto.ts (Max, IsArray) — résidus de nos edits. Je peux nettoyer si tu veux.





Laisse-moi vérifier ce qui reste dans l'audit/TODO :




D'après l'audit du TODO.md, voici ce qui reste :

## Éléments restants (par priorité)

### ⚡ Phase 0+ — Infrastructure & Ops
- **Frontend rôle-based** : pages admin (`/admin/users`, `/admin/ops`, `/admin/strategies`) avec rendu conditionnel par rôle dans la Sidebar
- **Tests couverture > 80%** : reste `signals.service` (cron), `positions.service`, `auth.service`
- **Backup DB** + **Uptime monitoring** (infra, pas code)

### ⚡ Phase 0++ — Qualité Data (Moonshot & Risk-Aware)
- **`risk_level` sur signaux** (EXTREME/HIGH/MODERATE/LOW) → badge frontend
- **`market_cap_tier` dans `get_cluster()`** (MICRO/SMALL/MID/LARGE)
- **`liquidity_score` au moteur** (0-100, déjà partiellement implémenté)
- **Take-profit moonshot** (sell 50% à 2x pour micro-caps)
- **Tranche/DCA logic** (déploiement progressif en 4 tranches)
- **Red flags checklist** en metadata pour micro-caps (déjà partiellement implémenté)
- **Allocation 80/20** par profil (accumulation vs moonshot)

### Phase 1-4 — ML, UX, Autonomie
- Feature Store v2 (table dédiée + pgvector)
- Backtest scientifique anti-look-ahead
- Signal Success Predictor (XGBoost)
- Pages marché (`/onchain`, `/economic-calendar`, `/synthetic`)
- Bot Agent trading automatique

## APIs externes nécessaires

Oui, plusieurs features restantes nécessitent des APIs :

- **`market_cap_tier`** → **CoinGecko API** (déjà utilisé dans le codebase) ou cache manuel
- **`liquidity_score`** → **Binance API** (depth20, déjà partiellement intégré) + **Twelve Data** pour forex
- **Red flags on-chain** → **Etherscan/BSCScan API** (holder distribution, whale concentration)
- **Macro rotation** → **CoinGecko global data** + **Fear & Greed** (déjà implémenté)
- **Economic calendar** → une API comme **Financial Modeling Prep** ou **Trading Economics**
- **Backtesting** → pas d'API externe, mais nécessite des données historiques (déjà disponibles via les providers existants)

Les APIs CoinGecko et Binance sont déjà câblées dans le moteur. Les nouvelles APIs nécessaires seraient Etherscan/BSCScan (pour les red flags on-chain) et éventuellement Twelve Data (pour le liquidity score forex). Veux-tu que je commence une feature en particulier ?