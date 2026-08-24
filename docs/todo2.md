# trading-os — Audit & Sprints réécrits

## 0. Vue d’ensemble

Plan de sprints remanié après audit de `TODO.md` et de l’état du code. Vision inchangée : SaaS de signaux de trading multi-marchés. Séquence réorientée vers la production.

---

## 1. Audit express

### 1.1 Ce qui existe

- **API (NestJS)** : auth, users, assets, signals, strategies, positions, portfolios, journal, watcher, notifications, prisma.
- **Engine (FastAPI)** : `scan.py`, `price_action`, `regime`, `sr_zones`, `patterns`, `smc`, `indicators`, `risk`, `news`, `backtest`, `strategy_eval`, `llm`, `rag`, `brvm`.
- **Modèle** : `Strategy`, `UserStrategy`, `Signal`, `SignalLog`, `Asset`, `Position`, `Journal`, `User`.
- **UI (Next.js)** : settings, stratégies, signaux, dashboard.
- **Infra** : cache Redis, logger, retry HTTP, cron 6h/4h, docker-compose.

### 1.2 Gaps principaux

- **Bloquant prod** : bouton Exécuter sur `SignalCard` sans intégration exchange (informatif seulement).
- **Bloquant prod** : activer/désactiver les marchés (crypto, forex, synthetic, brvm, stocks) — config DB + endpoint + UI.
- **Bloquant prod** : analyse fondamentale pour les actions US (PE, EPS, earnings) manquante.
- **Important** : bourses africaines (JSE, NGX, NSE, GSE) non intégrées.
- **Important** : sources RSS africaines dans `news_scraper.py` absentes.
- **Important** : `warmup_stocks` non vérifié en CI.
- **Stratégique** : auth sur routes engine (API key / JWT) si exposition externe.
- **Stratégique** : couverture tests > 80 % sur `signals`, `positions`, `auth`.
- **Long terme** : agent analyste, DEX avancé, omni-chain — non priorisés.

---

## 2. Sprints

### Sprint 0 — Fondations (semaines 1-2)

**Objectif** : repo déployable et testé sans rupture.

- [x] Stabiliser `docker-compose` + `dev.sh`. ✅ (healthchecks validés — build Docker local en attente réseau)
- [ ] `prisma migrate deploy` en prod et scripts de seed.
- [x] Tests unitaires critiques NestJS (`auth`, `positions`, `watcher`). ✅ (+ `signals`, `strategies`, `signal-outcome`, `backtest` — 45 tests)
- [x] Rate limiting Twelve Data / Coinglass / CryptoQuant. ✅ (`utils/rate_limiter.py` utilisé dans scan/news/onchain)
- [x] Centraliser logs et erreurs HTTP. ✅ (`all-exceptions.filter.ts` NestJS + structlog engine)

**DOD** : `docker compose up` OK, `npm run test:api` passe, rate limit actif.

---

### Sprint 1 — Stratégies dynamiques (semaines 3-4)

**Objectif** : le moteur utilise `Strategy`/`UserStrategy` au lieu du hardcode.

- [x] Étendre `strategy_eval.py` pour `analysis_timeframe`, `entry_timeframe`, `trigger`, `invalidation`, `exit_rules`. ✅
- [x] Modifier `scan.py` pour charger les stratégies actives et appeler `evaluate_strategy`. ✅ (stratégies passées dans `ScanRequest`, une analyse par stratégie)
- [x] Supprimer le hardcodage `EMA Trend + RSI` dans `signals.service.ts`. ✅ (stratégies actives chargées depuis Prisma, fallback par défaut)
- [x] Migrer les paramètres actuels en stratégies par défaut. ✅ (seed.ts au format DSL `StrategyRules`)
- [x] Validation du DSL JSON. ✅ (`rules-validator.ts` + 14 tests — branché sur create/update/toggle)

**DOD** : créer une stratégie dans l’UI → utilisée au prochain scan.

---

### Sprint 2 — Profils & `profileSuitability` (semaines 5-6)

**Objectif** : tagguer chaque signal par profil, sans activation utilisateur complexe.

- [x] Ajouter `profileSuitability` au modèle `Signal`. ✅ (`schema.prisma:221`, `String[]`)
- [x] Définir `INVESTOR`, `SWING`, `DAY`, `SCALPER`. ✅ (`strategy_eval.py` : `PROFILE_CONFIDENCE/TIMEFRAMES/RR`)
- [x] Adapter scoring, SL/TP/RR par profil. ✅ (`derive_profile_suitability()` filtre par timeframe + seuil confiance + RR min par profil)
- [x] API `/signals?profile=SWING`. ✅ (`signals.controller.ts:20`, `signals.service.ts:56-65` — `where.profileSuitability = { has: profile }`)
- [x] UI : badge `profileSuitability`. ✅ (`signals/page.tsx` — badge indigo par profil dans le header de la carte signal)

**DOD** : filtrage par profil fonctionnel, pas de sélection active utilisateur. ✅ Sprint 2 complet

---

### Sprint 3 — Modes d’entrée & invalidation (semaines 7-8)

**Objectif** : définir comment entrer et quand annuler un setup.

- [x] Implémenter `RETEST`, `BREAKOUT`, `LIMIT`, `VOLATILITY_EXPANSION`, `MOMENTUM_CONFIRMATION`. ✅ (`strategy_eval.py:_apply_trigger`)
- [x] Calcul `entryPrice` selon le mode. ✅ (`_apply_trigger` retourne `entry_price` adapté : close/niveau OB-FVG)
- [x] Gérer `invalidation` (données calculées). ✅ mais ⚠️ stocké en JSON statique dans `Signal.metadata.invalidation` — pas de réévaluation continue
- [x] État `PENDING` pour les setups en attente de déclencheur. ✅ `SignalStatus` enum (`PENDING/ACTIVE/INVALIDATED`) ajouté à `schema.prisma` (migration `add_signal_status`), initialisé depuis `signal_pending` dans `signals.service.ts`
- [x] Scheduler différencié `analysis_timeframe` / `entry_timeframe`. ✅ Prefetch dédié dans `scan_multi` (dernière clôture sur l'`entry_timeframe` déclaré par la stratégie, cascade Binance→Deriv→TwelveData→yfinance) — `evaluate_strategy()` affine `entry_price` avec cette clôture quand `entry_timeframe != analysis_timeframe`. 3 tests dédiés (`test_strategy_eval.py`)
  - ⚠️ Limite : l'analyse (score/régime/MTF) reste calculée sur `timeframe` unique — seul le prix d'entrée est raffiné, pas de re-scan complet sur le TF bas

**DOD** : signal `RETEST` passe de `PENDING` à `ACTIVE` ou `INVALIDATED`. ✅ `WatcherService.watchPendingSignals()` (cron 5min) : ACTIVE quand le prix atteint `entryPrice`, INVALIDATED si `expiresAt` dépassé sans déclenchement. 10 tests (`watcher.service.spec.ts`)
  - ⚠️ Limite connue : réutilise `SYM_MAP` du watcher positions (4 symboles crypto Binance seulement) — pas encore multi-marché

**Sprint 3 complet ✅**

---

### Sprint 4 — Moteur prédictif v1 (semaines 9-10)

**Objectif** : passer de réactif à prédictif sans ML lourd.

- [x] Expected Move Engine. ✅ (`predictive.py:compute_expected_move` — via TP1 ou ATR×mult)
- [x] Direction Probability Score `DPS`. ✅ (`compute_dps` : confidence + regime + mtf_aligned + volume)
- [x] Trigger Probability Score `TPS` pour `RETEST`/`LIMIT`. ✅ (`compute_tps`)
- [x] Conditions : `DPS > 60 %` + edge. ✅ `min_dps` (défaut 60.0) ajouté à `StrategyRules` — filtre appliqué dans `evaluate_strategy()` (chemin stratégie) et `analyze_candles()` (chemin par défaut). Signal repassé à `NEUTRAL` si `dps < min_dps`, avec raison loggée
- [x] `persistence_score` pour enrichir l'hystérésis. ✅ Score continu 0-100% (fenêtre glissante 5 scans) exposé sur chaque résultat, calculé dans `apply_hysteresis_and_persistence()` (extraite en fonction testable, remplace le bloc inline dans `scan_multi`). Persisté dans `Signal.metadata.persistence_score` + `signal_sticky`. 9 tests dédiés (`test_hysteresis.py`)

**DOD** : signal inclut `expected_move`, `dps`, `tps` ✅ (dans `Signal.metadata`) ; `dps < 60 %` non persisté ✅ **filtré avant retour** — 3 tests dédiés (`test_strategy_eval.py`), test `test_scan.py` bearish adapté en conséquence

**Sprint 4 complet ✅**

---

### Sprint 5 — Trailing stops & feedback loop (semaines 11-12)

**Objectif** : gérer les positions ouvertes et apprendre des résultats.

- [x] Trailing stop ATR 2x / structure / EMA / candlestick. ✅ Implémenté côté API (`positions.service.ts:syncTrailingStops`) avec trailing ATR dynamique (base `price ± atr`) ; `trailingStop` recalculé à chaque cron 5min
- [x] Lifecycle `Position` : `OPEN` → `PARTIAL` → `CLOSED`. ✅ `PositionStatus.PARTIAL` ajouté + logique TP1→PARTIAL (50% clôturé), puis TP2/SL→CLOSED
- [x] Journal auto à la clôture. ✅ Ajouté dans `positions.service.ts` pour `close()` et `closeByWatcher()` (incluant clôtures trailing/TP2). Protection anti-doublon via `closeByWatcher(..., { skipJournal: true })` possible depuis appelants qui journalisent déjà
- [x] Feedback loop sur `confidence`. ✅ Calibration par bucket de confiance (10% de `confidence`) + win rate historique par bucket dans `SignalOutcomeService`; endpoints `GET /signals/calibration` et `GET /signals/predict-win-rate`
- [x] `ML Signal Success Predictor` v0. ✅ Régression logistique maison entraînée sur `SignalLog` (features = sous-scores + confidence + adx + R/R); endpoints `POST /signals/predictor/train`, `POST /signals/predictor/predict`, `GET /signals/predictor/status`

**DOD** : position avec trailing stop mise à jour à chaque scan; stats par stratégie.

---

### Sprint 5bis — Feedback loop prédiction (semaines 11-12 suite)

- [x] Calibration auto des features. ✅ `SignalPredictorService` entraîne une régression logistique sur `SignalLog` et retourne l'importance normalisée des features via `GET /signals/predictor/weights`; UI Signaux avec bouton Entraîner et barres de poids

---

### Sprint 6 — Testeur Lab (semaines 13-15)

**Objectif** : créer, backtester et paper-trader une stratégie.

- [x] Module Lab backend : CRUD `LabSession`, lancement backtest via engine, évaluation score/verdict. ✅ `LabModule` créé avec `LabService` + `LabController`; modèle `LabSession` ajouté en DB (migration `add_lab_session`); endpoints `POST /lab/sessions`, `GET /lab/sessions`, `GET /lab/sessions/:id`, `POST /lab/sessions/:id/backtest`, `POST /lab/sessions/:id/evaluate`, `POST /lab/sessions/:id/archive`, `POST /lab/sessions/:id/suitability`, `GET /lab/templates`
- [x] Connecteur `backtest.py` au DSL `Strategy`. ✅ `LabService.runBacktest` appelle `/backtest/run` avec `strategy` issu de `LabSession.strategy`
- [x] Templates de stratégies DSL. ✅ `GET /lab/templates` retourne `trend_following`, `breakout_smc`, `range_mean_reversion`
- [x] Profiler `profileSuitability`. ✅ `POST /lab/sessions/:id/suitability` vérifie adéquation selon profil risque (conservateur / modéré / agressif) + contraintes personnalisées
- [x] UI Lab : création visuelle, lancement backtest, rapports. ✅ Page `/lab` avec sélecteur de templates DSL, formulaire JSON, liste de sessions, boutons backtest/évaluation/profil/archivage, affichage métriques + equity curve + trades
- [x] Rapport détaillé par décision (market conditions, reasoning, trace). ✅ `GET /lab/sessions/:id/report` retourne market conditions, trade details, statistiques (avg hold, best/worst, streaks, distribution des raisons) et recommandations
- [x] Walk-forward / anti-overfitting. ✅ `GET /lab/sessions/:id/walk-forward` split IS/OOS, calcule decay win rate / profit factor / expectancy et un score de surapprentissage
- [x] Promotion Lab → production. ✅ `POST /lab/sessions/:id/promote` crée une `Strategy` inactive depuis une session `COMPLETED` avec métriques suffisantes (profit_factor >= 1.2, win_rate >= 45%)
- [x] Rapport : win rate, drawdown, profit factor, expectance. ✅ Métriques persistées dans `LabSession.backtestMetrics`; `LabService.evaluate` retourne un score et un verdict
- [x] Comparaison vs benchmark. ✅ Métriques `benchmark_pnl_pct` et `outperformance_pct` retournées par `backtest.py` et stockées

**DOD** : utilisateur crée une stratégie, lance un backtest, reçoit un rapport.

---

### Sprint 7 — Data avancées & macro (semaines 16-17)

**Objectif** : enrichir le contexte marché.

- [x] Indice Fear & Greed. ✅ `GET /market-data/fear-greed` (alternative.me) + widget dashboard
- [x] Funding rates perp. ✅ `GET /market-data/funding-rates` (Binance futures) + widget dashboard
- [x] Calendrier économique. ✅ `GET /market-data/economic-calendar` (ForexFactory feed) + widget dashboard
- [x] On-chain BTC v0 + intégration signal. ✅ `GET /market-data/on-chain/btc` + stockage dans `metadata.marketContext` à la création du signal
- [x] Contexte marché par signal. ✅ `SignalsService.saveSignals` enrichit `metadata.marketContext` avec Fear & Greed, funding rates, on-chain BTC, calendrier économique, spot-perp basis
- [x] Spot-perp basis. ✅ `GET /market-data/basis` (Binance spot vs perp) + widget dashboard + stocké dans `marketContext`
- [x] On-chain ETH v0. ✅ `GET /market-data/on-chain/eth` (Blockchair) + widget dashboard + stocké dans `marketContext`
- [x] Copilot RAG v0. ✅ Le chat intègre le contexte du dernier signal (`signal_context` + `market_context`) pour affiner les réponses du LLM
- [x] COT / Commitment of Traders (futures CFTC). ✅ `GET /market-data/cot/:asset` (CFTC legacy COT via Socrata) + widget BTC + stocké dans `marketContext`
- [x] Phase A+ consolidation moteur. ✅ Swing Detection Engine + BOS Quality Score + session UTC + OB displacement_ratio/status + SL/TP liquidity-aware

**DOD** : chaque signal affiche un `context` macro + on-chain + sentiment.

---

### Sprint 8 — SaaS readiness & scale (semaines 18-20)

**Objectif** : production sereine.

- [x] CI/CD tests + build. ✅ jobs `api`/`web`/`engine`/`docker` verts dans `.github/workflows/ci.yml`
- [ ] Déploiement auto (push image + run VPS) — hors repo, à configurer côté hébergeur
- [ ] Sécurité (authz, CORS, secrets, validation inputs).
- [ ] Performance : workers, queue Redis, pagination, DB.
- [ ] Monitoring : métriques, alertes, error tracking.

**DOD** : déploiement auto, scan < 2 min pour actifs prioritaires.

---

## 3. Feuille de route trimestrielle

| Trimestre | Sprints | Focus | Livrable clé |
|---|---|---|---|
| **Q1** | S0-S2 | Fondations + stratégies dynamiques + profils | SaaS utilisable |
| **Q2** | S3-S5 | Prédiction v1 + trailing + feedback | Signaux plus précis |
| **Q3** | S6-S7 | Lab + macro/on-chain | Boucle créer/tester/déployer |
| **Q4** | S8 + améliorations | Prod scale + agent + DEX | Plateforme stable |

---

## 4. Prochaines actions immédiates

### Sprint 9 — Marchés & UX (en cours)

- [x] Analyse fondamentale actions US : PE, EPS, earnings calendar via FMP / Alpha Vantage.
- [x] Market enable/disable : table `market_config`, endpoint, toggle UI, warmup respecte la config.
- [x] Bouton Exécuter sur `SignalCard` : intégration exchange pour passer ordres.
- [x] Bourses africaines : `base_africa_scraper.py` + route pour JSE / NGX / NSE / GSE.
- [x] RSS africains : sources news locales dans `news_scraper.py`.
- [x] Vérifier `warmup_stocks` en CI et en prod.
- [x] Auth engine : `Depends(verify_api_key)` si routes exposées.
- [x] Frontend role-based : rendu conditionnel admin / ops.

### Amélioration continue (non bloquant)

- Vulnérabilités npm : 5 signalées dans le web (1 moderate, 4 high)
- Tests E2E réels contre Postgres
- Couverture tests > 80 % sur `signals`, `positions`, `auth`
- Migration Next.js 15 / ESLint 9
- Dockerfile API multi-stage + lockfile