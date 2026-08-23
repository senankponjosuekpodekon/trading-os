# TODO — Items manquants

> ⚠️ **Ce fichier est un inventaire de recherche statique. Le backlog actif est maintenu dans `docs/todo2.md`.**

**Total non cochés :** 248

## Sommaire des sections
- [Clés API MVP (4)](#clés-api-mvp)
- [Clés API Phase A (post-déploiement) (4)](#clés-api-phase-a-post-déploiement)
- [Tests manuels à faire (9)](#tests-manuels-à-faire)
- [🧠 Phase B — Machine Learning & Feedback Loop (7)](#phase-b--machine-learning--feedback-loop)
- [🔮 Phase C — Alpha Pré-Listing & Analyse Asymétrique Avancée (4)](#phase-c--alpha-pré-listing--analyse-asymétrique-avancée)
- [🚀 Phase D — Autonomie & Multi-Agents (Vision Long Terme) (9)](#phase-d--autonomie--multi-agents-vision-long-terme)
- [📢 Notifications SSE (complétude MVP) (1)](#notifications-sse-complétude-mvp)
- [RAG & IA (enrichissement) (3)](#rag--ia-enrichissement)
- [Scrapers (1)](#scrapers)
- [Linting & Formatage (2)](#linting--formatage)
- [Modularité & Architecture (3)](#modularité--architecture)
- [Scalabilité & Performance Frontend (5)](#scalabilité--performance-frontend)
- [Scalabilité & Performance Python Engine (1)](#scalabilité--performance-python-engine)
- [Responsivité (3)](#responsivité)
- [Gestion efficace des ressources (2)](#gestion-efficace-des-ressources)
- [Chargement & Vitesse (4)](#chargement--vitesse)
- [API & Réseau (2)](#api--réseau)
- [Authentification & Autorisation (3)](#authentification--autorisation)
- [Données sensibles (2)](#données-sensibles)
- [Backend NestJS (1)](#backend-nestjs)
- [Engine Python (1)](#engine-python)
- [Frontend Next.js (3)](#frontend-nextjs)
- [Canaux (3)](#canaux)
- [Intelligence (3)](#intelligence)
- [Migrations (1)](#migrations)
- [Connection Pooling (2)](#connection-pooling)
- [Performance requêtes (3)](#performance-requêtes)
- [Maintenance & Résilience (3)](#maintenance--résilience)
- [Philosophie & Outillage (2)](#philosophie--outillage)
- [`test_swing.py` — SwingDetectionEngine (à créer avec le module) (7)](#test_swingpy--swingdetectionengine-à-créer-avec-le-module)
- [`test_synthetic_engine.py` — Synthetic Market Engine (à créer) (8)](#test_synthetic_enginepy--synthetic-market-engine-à-créer)
- [`test_probability_engine.py` — Probability Engine (à créer) (8)](#test_probability_enginepy--probability-engine-à-créer)
- [`test_backtesting.py` — Backtesting Engine (à créer) (8)](#test_backtestingpy--backtesting-engine-à-créer)
- [`test_scan.py` — Compléments (tests existants à étendre) (7)](#test_scanpy--compléments-tests-existants-à-étendre)
- [`test_risk.py` — Compléments (tests existants à étendre) (4)](#test_riskpy--compléments-tests-existants-à-étendre)
- [`signal-outcome.service.spec.ts` — SignalLog ✅ (12 tests passants) (1)](#signal-outcomeservicespects--signallog--12-tests-passants)
- [`notifications.service.spec.ts` ✅ (10 tests — implémentation actuelle in-memory/SSE, pas encore persistée en DB) (2)](#notificationsservicespects--10-tests--implémentation-actuelle-in-memorysse-pas-encore-persistée-en-db)
- [`signals.service.spec.ts` — Compléments (4)](#signalsservicespects--compléments)
- [`portfolios.service.spec.ts` — Compléments (4)](#portfoliosservicespects--compléments)
- [`SignalCard.spec.tsx` — Nouveau composant enrichi (7)](#signalcardspectsx--nouveau-composant-enrichi)
- [`useTradingStore.spec.ts` — Store Zustand (5)](#usetradingstorespects--store-zustand)
- [`useScanner.spec.ts` (à créer avec la page) (4)](#usescannerspects-à-créer-avec-la-page)
- [`SyntheticRegimeCard.spec.tsx` (à créer avec la page) (4)](#syntheticregimecardspectsx-à-créer-avec-la-page)
- [`MarketScanner.spec.tsx` (à créer avec la page) (4)](#marketscannerspectsx-à-créer-avec-la-page)
- [🔗 Tests d'intégration — À ajouter (4)](#tests-dintégration--à-ajouter)
- [⚙️ CI / CD Tests (2)](#ci--cd-tests)
- [🔵 Priorité 4 — SaaS Readiness (post-déploiement) (3)](#priorité-4--saas-readiness-post-déploiement)
- [�🚀 Déploiement (priorité) (9)](#déploiement-priorité)
- [📊 Features UX (post-déploiement) (7)](#features-ux-post-déploiement)
- [Phase A — Pages prioritaires (court terme) (4)](#phase-a--pages-prioritaires-court-terme)
- [Phase A+ / A++ — Pages architecture avancée (2)](#phase-a--a--pages-architecture-avancée)
- [Phase B — Pages ML & Backtesting (2)](#phase-b--pages-ml--backtesting)
- [Phase D — Pages autonomie & mémoire (2)](#phase-d--pages-autonomie--mémoire)
- [Composants partagés à créer (cross-pages) (10)](#composants-partagés-à-créer-cross-pages)
- [🎯 Trading Copilot UX — Ch.21 (Phase D+) (9)](#trading-copilot-ux--ch21-phase-d)
- [Tâches à faire (5)](#tâches-à-faire)
- [Feedback loop et expérience utilisateur (5)](#feedback-loop-et-expérience-utilisateur)
- [Mécanismes concrets à implémenter (1)](#mécanismes-concrets-à-implémenter)
- [1. Stratégies : le moteur ne les utilise pas encore (critique) ⚠️ **SECTION OBSOLÈTE — vérifiée, 4/5 déjà faits** (1)](#1-stratégies--le-moteur-ne-les-utilise-pas-encore-critique--section-obsolète--vérifiée-45-déjà-faits)
- [3. Détection précoce de tendance (early trend) (2)](#3-détection-précoce-de-tendance-early-trend)
- [4. Continuation et épuisement d'une tendance en cours (3)](#4-continuation-et-épuisement-dune-tendance-en-cours)
- [6. Testeur Lab (validation stratégies par profil et marché) (1)](#6-testeur-lab-validation-stratégies-par-profil-et-marché)
- [8. On-chain / macro / fondamentaux avancés (4)](#8-on-chain--macro--fondamentaux-avancés)
- [9. Fiabilité et scalabilité (4)](#9-fiabilité-et-scalabilité)

---

## Clés API MVP

- **—** — L75: 👤 Créer compte **newsapi.org** (gratuit) → copier `NEWS_API_KEY` dans `.env`
- **Basse** — L77: 👤 Optionnel : créer compte **OpenAI** → `OPENAI_API_KEY` pour activer GPT-4o
- **Basse** — L79: 👤 Optionnel : créer compte **Twelve Data** → `TWELVE_DATA_API_KEY` pour Forex réel
- **Basse** — L81: 👤 Optionnel : générer **DERIV_TOKEN** pour trades réels

## Clés API Phase A (post-déploiement)

- **—** — L85: 👤 Créer compte **Coinglass** → `COINGLASS_API_KEY` (gratuit limité)
- **—** — L87: 👤 Créer compte **LunarCrush** → `LUNARCRUSH_API_KEY` (500 req/jour gratuit)
- **—** — L89: 👤 Créer compte **CryptoQuant** → `CRYPTOQUANT_API_KEY` (free tier limité)
- **Basse** — L91: 👤 Optionnel : compte **Glassnode** → `GLASSNODE_API_KEY` (free tier)

## Tests manuels à faire

- **—** — L95: 👤 Tester Auth : Register → Login → Logout → vérifier JWT
- **—** — L96: 👤 Tester Dashboard : prix live WebSocket BTC/ETH/SOL
- **—** — L97: 👤 Tester Scan : lancer scan 4 actifs → vérifier signaux générés
- **—** — L98: 👤 Tester Portfolio : créer position paper → close → vérifier journal
- **—** — L99: 👤 Tester Backtest : BTC/USDT 1h → vérifier courbe capital + métriques
- **—** — L100: 👤 Tester BRVM : charger cours (si brvm.org répond)
- **—** — L101: 👤 Tester Deriv : analyser V75 → signal CALL/PUT/WAIT
- **—** — L102: 👤 Tester Chat RAG : questions SMC, RSI, risk management
- **—** — L103: 👤 Tester Notifications SSE : vérifier stream sans 401

## 🧠 Phase B — Machine Learning & Feedback Loop

- **—** — L329: 🤖 **`engine/ml/feature_store.py` v2** — Table dédiée + pgvector
- **—** — L334: 🤖 **`engine/ml/signal_scorer.py`** — XGBoost/LightGBM
- **—** — L341: 🤖 **`engine/ml/regime_classifier.py`** — Hidden Markov Model
- **—** — L346: 🤖 **Migration pandas-ta**
- **—** — L352: 🤖 **Probability Engine complet** — Ch.17 (remplace le scoring linéaire actuel)
- **—** — L365: 🤖 **Backtester ML** — valider edge du modèle
- **—** — L370: 🤖 **`engine/backtest/engine.py`** — Backtesting scientifique anti-overfitting (Ch.20)

## 🔮 Phase C — Alpha Pré-Listing & Analyse Asymétrique Avancée

- **[x]** — L395: 🤖 **`engine/routers/presale_scanner.py`** — API `/phase-c/presales` (early stage) ✅
- **[x]** — L406: 🤖 **`engine/routers/whale_tracker.py`** — API `/phase-c/whales` ✅
- **[x]** — L412: 🤖 **`engine/routers/developer_activity.py`** — API `/phase-c/dev-activity` ✅
- **[x]** — L418: 🤖 **`engine/routers/defi_metrics.py`** — API `/phase-c/defi` ✅

## 🚀 Phase D — Autonomie & Multi-Agents (Vision Long Terme)

- **—** — L429: 🤖 **Architecture multi-agents — 10 agents spécialisés**
- **—** — L452: 🤖 **`engine/agents/`** — Extraction progressive depuis `scan.py`
- **—** — L458: 🤖 **Exécution automatique paper → réel**
- **—** — L463: 🤖 **Continuous learning pipeline**
- **—** — L467: 🤖 **Self-Learning Market Memory Engine** — Ch.19 (différenciateur SaaS majeur)
- **—** — L483: 🤖 **Market Memory System** — pgvector (différenciateur SaaS majeur)
- **—** — L492: 🤖 **Signal Object vivant** — Ch.17 + Ch.21 (entité dynamique, pas snapshot statique)
- **—** — L506: 🤖 **Signal vivant** — recalcul dynamique post-émission
- **—** — L513: 🤖 **Data Pipeline — Architecture scalable (Ch.18)**

## 📢 Notifications SSE (complétude MVP)

- **—** — L529: Frontend : badge compteur + toast notification dans `AppLayout`

## RAG & IA (enrichissement)

- **—** — L533: 🤖 **Ingestion auto quotidienne RAG**
- **—** — L537: 🤖 **Vectoriser le journal de trading**
- **—** — L541: 🤖 **Strategy Builder Agent**

## Scrapers

- **—** — L547: 🤖 **`engine/scrapers/crypto_news_scraper.py`**

## Linting & Formatage

- **—** — L612: 🤖 **ESLint strict + Prettier** — frontend
- **—** — L616: 🤖 **Ruff + Black** — Python engine

## Modularité & Architecture

- **—** — L622: 🤖 **Barrel exports** dans chaque dossier `components/`, `hooks/`, `lib/`
- **—** — L624: 🤖 **Séparation concerns Next.js** — règle stricte
- **—** — L629: 🤖 **Séparation concerns Python** — règle stricte

## Scalabilité & Performance Frontend

- **—** — L638: 🤖 **React.memo + useMemo + useCallback** systématiques sur composants lourds
- **—** — L641: 🤖 **Zustand selectors atomiques** — ne pas souscrire au store entier
- **—** — L644: 🤖 **Virtualisation listes longues** — `@tanstack/react-virtual`
- **—** — L648: 🤖 **Code splitting par route** — déjà partiel, compléter
- **—** — L651: 🤖 **Image optimization** — `next/image` obligatoire, pas de `<img>` natif

## Scalabilité & Performance Python Engine

- **—** — L663: 🤖 **Pagination côté Python Engine** sur tous les endpoints liste

## Responsivité

- **—** — L668: 🤖 **Breakpoints Tailwind standardisés** — `sm:640 md:768 lg:1024 xl:1280`
- **—** — L671: 🤖 **Touch targets ≥ 44px** sur mobile — boutons, liens, onglets
- **—** — L672: 🤖 **Tableaux → Cards automatique** sur `< 768px` — pattern existant à étendre aux nouvelles pages

## Gestion efficace des ressources

- **—** — L680: 🤖 **Fermeture propre des connexions Python**
- **—** — L683: 🤖 **Limiter le volume de données WebSocket**

## Chargement & Vitesse

- **—** — L688: 🤖 **Skeleton loaders sur toutes les nouvelles pages** — pas de flash blanc
- **Haute** — L690: 🤖 **Optimistic UI** sur mutations critiques
- **—** — L693: 🤖 **Prefetch intelligent** — charger les données probables avant navigation
- **—** — L696: 🤖 **SWR / TanStack Query staleTime par type de donnée**

## API & Réseau

- **—** — L714: 🤖 **Protection XSS** — sanitiser sorties affichées
- **—** — L723: 🤖 **HTTPS obligatoire en production**

## Authentification & Autorisation

- **—** — L730: 🤖 **2FA TOTP**
- **—** — L734: 🤖 **Row Level Security (RLS) — PostgreSQL**
- **—** — L738: 🤖 **Scopes d'autorisation par plan**

## Données sensibles

- **—** — L743: 🤖 **Chiffrement données sensibles en DB**
- **—** — L746: 🤖 **Logs sans données sensibles**

## Backend NestJS

- **—** — L763: 🤖 **Timeout sur toutes les requêtes Prisma**

## Engine Python

- **—** — L774: 🤖 **Dead Letter Queue pour tâches background**

## Frontend Next.js

- **—** — L779: 🤖 **Error boundaries par section** — pas seulement global
- **—** — L782: 🤖 **Toast notifications d'erreur** — feedback utilisateur immédiat
- **—** — L785: 🤖 **Empty states sur toutes les pages**

## Canaux

- **—** — L805: 🤖 **Web Push (PWA)** — notification navigateur même app fermée
- **—** — L809: 🤖 **Telegram Bot**
- **—** — L813: 🤖 **Email**

## Intelligence

- **—** — L823: 🤖 **Filtre anti-spam** — qualité > quantité
- **—** — L827: 🤖 **Page `/settings/notifications`**
- **—** — L830: 🤖 **Notification dégradation signal**

## Migrations

- **—** — L858: 🤖 **Migrations backward-compatible** — zéro downtime

## Connection Pooling

- **—** — L863: 🤖 **PgBouncer** — pool de connexions
- **—** — L867: 🤖 **`connection_limit` dans `DATABASE_URL` Prisma**

## Performance requêtes

- **Haute** — L871: 🤖 **`EXPLAIN ANALYZE`** sur les requêtes critiques avant production
- **—** — L873: 🤖 **Pagination curseur** sur grandes tables (préférer au `OFFSET`)
- **—** — L876: 🤖 **Archivage automatique** — données froides

## Maintenance & Résilience

- **—** — L881: 🤖 **Soft-delete pattern** — données utilisateur
- **—** — L884: 🤖 **Backup automatique** — compléter le déploiement existant
- **—** — L888: 🤖 **Read replicas** (Phase D — forte charge)

## Philosophie & Outillage

- **—** — L910: 🤖 **Pyramid de tests** — respecter la hiérarchie
- **—** — L914: 🤖 **Coverage reporting** — activer et surveiller

## `test_swing.py` — SwingDetectionEngine (à créer avec le module)

- **—** — L926: `detect_swing_highs()` : série haussière → 3 HH détectés
- **—** — L927: `detect_swing_lows()` : série baissière → 3 LL détectés
- **—** — L928: `detect_bos()` : cassure confirmée = `BOS_BULL` | non-cassure = `None`
- **—** — L929: `detect_choch()` : CHoCH après tendance baissière → renversement détecté
- **—** — L930: `bos_quality_score()` : BOS avec fort volume → score > 70 | BOS faible → score < 40
- **—** — L931: Série plate (range) → aucun swing détecté
- **—** — L932: Séries trop courtes (< 10 bougies) → `None` sans crash

## `test_synthetic_engine.py` — Synthetic Market Engine (à créer)

- **—** — L935: `spike_features()` : 34 spikes dans 1000 ticks → `{spikes: 34, avg_size: X, time_since: Y}`
- **—** — L936: `volatility_regime()` : ATR très bas + BB étroite → `LOW_VOL`
- **—** — L937: `volatility_regime()` : ATR expansion → `VOL_EXPANSION`
- **—** — L938: `volatility_regime()` : spikes fréquents → `SPIKE_RISK`
- **—** — L939: `autocorrelation()` : série avec forte corrélation t/t-1 → valeur > 0.7
- **Haute** — L940: `entropy()` : série aléatoire → entropie haute | série structurée → entropie basse
- **—** — L941: `distance_to_extreme()` : prix à -15% du haut → `-0.15`
- **—** — L942: Actif non-synthétique passé par erreur → exception `WrongAssetTypeError`

## `test_probability_engine.py` — Probability Engine (à créer)

- **—** — L945: `direction_engine()` : tous agents bullish → probability > 75%
- **—** — L946: `direction_engine()` : agents mixtes → probability 45-55%
- **—** — L947: `trade_quality_probability()` : direction 78% + RR 0.8 → quality < 50% → REJECTED
- **—** — L948: `trade_quality_probability()` : direction 65% + RR 4.0 → quality > 60% → ACCEPTED
- **—** — L949: `entry_zone()` : OB + FVG proches → zone cohérente sans contradiction
- **—** — L950: `tp_targets()` : 3 niveaux retournés avec `{price, rr, probability}` chacun
- **Haute** — L951: `tp_targets()` : probabilité TP3 < probabilité TP1 toujours
- **—** — L952: `trailing_sl()` : nouveau HL créé → SL mis à jour sous nouveau HL

## `test_backtesting.py` — Backtesting Engine (à créer)

- **—** — L970: Anti-lookahead : BOS calculé sur bougie t n'utilise jamais de données de t+1
- **—** — L971: `market_replay()` : 100 bougies rejoué séquentiellement → état identique à live candle par candle
- **—** — L972: SL touché avant TP dans même bougie → `LOSS` (pas `WIN`)
- **—** — L973: Coûts appliqués : spread + commission déduits du P&L
- **—** — L974: Walk-forward : cycle 1 test set = données inconnues du train set (pas d'overlap)
- **—** — L975: Monte Carlo N=100 : distribution résultats non-identique à chaque run (aléatoire)
- **—** — L976: `calibration_score()` : prédictions 80% gagnent entre 75-85% → calibration OK
- **—** — L977: `calibration_score()` : prédictions 80% gagnent 50% → calibration FAIL

## `test_scan.py` — Compléments (tests existants à étendre)

- **[x]** — L980: `analyze_candles()` sur actif `SYNTHETIC` → pipeline synthétique appelé (pas SMC) ✅
- **—** — L981: `analyze_candles()` sur actif `CRYPTO` → on-chain bonus appliqué si data dispo
- **—** — L982: `analyze_candles()` sur actif `FOREX` → macro calendar factor appliqué
- **—** — L983: `regime_filter()` : signal BUY en régime BEAR_STRONG → `allowed = False`
- **—** — L984: `regime_filter()` : signal NEUTRAL toujours autorisé (quelque soit le régime)
- **—** — L985: Anti-repaint : dernière bougie non-clôturée exclue du calcul
- **—** — L986: Cache Redis : 2ème appel identique dans le TTL → résultat identique sans re-calcul

## `test_risk.py` — Compléments (tests existants à étendre)

- **—** — L989: `sl_liquidity_aware()` : SL classique tombe sur zone EQL → SL décalé en-dessous
- **Haute** — L990: `tp_linked_to_liquidity()` : TP1 aligné sur prochain EQH détecté
- **—** — L991: Position size : capital 10000 + risk 1% + SL 50 pips → lot size correct
- **—** — L992: Plafonnement : position size jamais > 5% du capital quelles que soient les entrées

## `signal-outcome.service.spec.ts` — SignalLog ✅ (12 tests passants)

- **—** — L1005: `resolveOutcomes()` : N bougies sans résultat → outcome `EXPIRED`

## `notifications.service.spec.ts` ✅ (10 tests — implémentation actuelle in-memory/SSE, pas encore persistée en DB)

- **—** — L1014: `create()` / `markAsRead()` / `markAllRead()` / `getUnread()` : à ajouter si le modèle passe en DB (`readAt`)
- **—** — L1015: `shouldNotify()` anti-spam / quiet hours / seuil utilisateur : logique pas encore implémentée

## `signals.service.spec.ts` — Compléments

- **—** — L1018: `scan()` : rate limit dépassé → erreur `RATE_LIMITED` (pas 500)
- **—** — L1019: `scan()` : engine down → erreur gracieuse avec message clair
- **—** — L1020: `findAll()` : pagination curseur correcte — `lastId` retourne suite correcte
- **[x]** — L1021: `findAll()` : filtre `market=CRYPTO` → uniquement signaux crypto ✅

## `portfolios.service.spec.ts` — Compléments

- **[x]** — L1024: `findByUser()` : retourne portfolios avec positions ouvertes ✅
- **—** — L1025: `openPosition()` : RR < 1.0 → rejeté avec erreur `RR_TOO_LOW` (logique dans `positions.service`)
- **—** — L1026: `openPosition()` : position déjà ouverte sur même actif → erreur `DUPLICATE_POSITION`
- **—** — L1027: `closePosition()` : position inexistante → `NotFoundException`

## `SignalCard.spec.tsx` — Nouveau composant enrichi ✅

- **[x]** — L1034: Render avec signal `ACTIVE` → badge vert visible ✅
- **[x]** — L1035: Render avec signal `INVALIDATED` → badge rouge + card grisée ✅
- **[x]** — L1036: `entry_zone` affichée → deux valeurs visibles (range) ✅
- **[x]** — L1037: TP1/TP2/TP3 avec probabilités → 3 lignes affichées ✅
- **[x]** — L1038: Clic "Pourquoi ?" → section raisons scorées s'expand ✅
- **[x]** — L1039: Clic "Pourquoi PAS ?" → section risques s'expand ✅
- **—** — L1040: `React.memo` : prix change mais signal inchangé → pas de re-render (test avec `renderCount`)

## `useTradingStore.spec.ts` — Store Zustand ✅

- **[x]** — L1043: `setPrice()` : mise à jour d'un seul symbole → autres symboles inchangés ✅
- **[x]** — L1044: `fetchSignals()` : appel en cours → deuxième appel ignoré (`signalsLoading = true`) ✅
- **[x]** — L1045: `fetchSignals()` : cache valide (< 30s) → pas de nouveau fetch réseau ✅
- **[x]** — L1046: `fetchSignals()` : force=true → fetch même si cache valide ✅
- **[x]** — L1047: `setSignals()` : met à jour `signalsFetchedAt` avec timestamp actuel ✅

## `useScanner.spec.ts` (à créer avec la page) ✅ → page testée directement

- **[x]** — L1049: `ScannerPage` rendu et scan déclenché ✅
- **[x]** — L1050: Affichage multi-signaux ✅

## `SyntheticRegimeCard.spec.tsx` (à créer avec la page) ✅

- **[x]** — L1056: `LOW_VOL` → régime affiché avec style de couleur ✅
- **[x]** — L1057: `SPIKE_RISK` → alerte visible ✅
- **[x]** — L1058: `spike_probability = 0.78` → jauge à 78% ✅
- **[x]** — L1059: Actif CRYPTO passé par erreur → message d'erreur "Marché non synthétique" ✅

## `MarketScanner.spec.tsx` (ScannerPage) ✅

- **[x]** — L1062: 0 résultats → empty state ✅
- **[x]** — L1063: Tri par Opportunity Score → ordre décroissant vérifié ✅
- **[x]** — L1064: Filtre direction SELL → seuls les signaux SELL affichés ✅
- **[x]** — L1065: Loading state → skeleton visible ✅

## 🔗 Tests d'intégration — À ajouter

- **[x]** — L1071: 🤖 **`scan → signalLog`** — `SignalsController` scan déclenche `SignalOutcomeService.logSignal` ✅
- **[x]** — L1073: 🤖 **`auth → refresh → logout`** — flux token ✅
- **[x]** — L1075: 🤖 **`openPosition → watcher → closePosition`** — flux paper trading (TP hit) ✅
- **[x]** — L1077: 🤖 **`notification → canaux`** — endpoint `/notifications` testé ✅ (SSE streaming non testé car stream infini)

## ⚙️ CI / CD Tests

- **[x]** — L1089: 🤖 **Test database isolée** — `.env.test` + garde `FORCE_TEST_DB` + `resetTestDatabase` + `prisma.integration.spec` ✅
- **[x]** — L1093: 🤖 **Mocks standardisés** — `createMockPrisma()` dans `src/test/prisma.mock.ts` + exemple `audit.service.spec.ts` ✅

## 🔵 Priorité 4 — SaaS Readiness (post-déploiement)

- **[x]** — L1164: 🤖 **Plans & abonnements** — page `/billing` liste plans + souscription / annulation ✅
- **[x]** — L1172: 🤖 **Audit trail** — modèle `audit_logs`, service global, log auth + positions, page `/audit` ✅
  - Migrations `audit_logs` à appliquer en prod
- **[x]** — L1177: 🤖 **2FA TOTP** — endpoints setup/enable/disable/status, vérification au login, page `/settings/2fa` et QR code ✅
  - Migrations `totp_secret` / `totp_enabled` à appliquer en prod

## �🚀 Déploiement (priorité)

- **—** — L1185: 👤 Louer VPS Hetzner (CX21 min — 2 vCPU, 4GB RAM, 40GB SSD)
- **—** — L1188: 👤 Pointer domaine DNS → IP VPS
- **[x]** — L1189: 🤖 `docker-compose.prod.yml` avec tous les services ✅
- **[x]** — L1190: 🤖 `Dockerfile.prod` Next.js Web ✅
- **[x]** — L1191: 🤖 Nginx reverse proxy + SSL Let's Encrypt prêt ✅
- **[x]** — L1192: 🤖 Script `deploy.sh` (pull → build → restart) ✅
- **[x]** — L1193: 🤖 Health checks Docker Compose ✅
- **[x]** — L1194: 🤖 Backup automatique PostgreSQL (pg_dump cron quotidien) ✅
- **Basse** — L1195: 👤 Configurer secrets GitHub pour CI/CD optionnel

## 📊 Features UX (post-déploiement)

- **[x]** — L1201: 🤖 **Alertes prix** — CRUD backend, déclenchement via watcher, page frontend + notif SSE ✅
  - Migration `price_alerts` ajoutée ; exécuter `npx prisma migrate deploy` en prod
- **[x]** — L1202: 🤖 **Multi-compte** — backend POST `/portfolios` + page `/portfolios` pour créer et lister plusieurs comptes ✅
- **[x]** — L1203: 🤖 **Export CSV** — journal + rapport performance ✅
- **[x]** — L1203b: 🤖 **Export PDF** — rapport performance via jsPDF + jspdf-autotable ✅
- **[x]** — L1204: 🤖 **Calendrier économique** — catégories FOMC/NFP/CPI/BRVM + fallback events + filtres page ✅
- **[x]** — L1205: 🤖 **Page "Early Alpha"** — endpoints `/early-alpha/presales` et `/early-alpha/onchain` + page `/early-alpha` + tests ✅
- **[x]** — L1206: 🤖 **Heatmap marchés** — vue globale Fear & Greed, funding, basis, on-chain BTC/ETH ✅
- **[x]** — L1207: 👤 **Application mobile / PWA** — `manifest.json`, service worker, offline fallback, `ServiceWorkerRegistration`, tests ✅

## Phase A — Pages prioritaires (court terme)

- **[x]** — L1216: 🤖 **`/app/scanner/page.tsx`** — Market Scanner global ✅
- **[x]** — L1226: 🤖 **`/app/synthetic/page.tsx`** — Synthetic Markets (Deriv V75/Boom/Crash) ✅
- **[x]** — L1235: 🤖 **`/app/onchain/page.tsx`** — On-Chain Dashboard Crypto ✅
- **[x]** — L1245: 🤖 **`/app/economic-calendar/page.tsx`** — Calendrier économique ✅

## Phase A+ / A++ — Pages architecture avancée

- **[x]** — L1255: 🤖 **`/app/chart/[symbol]/page.tsx`** — Chart intelligent annoté ✅
- **[x]** — L1265: 🤖 **Refactor `components/signals/SignalCard.tsx`** — Signal Object vivant complet ✅

## Phase B — Pages ML & Backtesting

- **[x]** — L1279: 🤖 **`/app/backtest/page.tsx`** — Backtesting Engine (métriques + Monte-Carlo + calibration + walk-forward) ✅
- **[x]** — L1288: 🤖 **`/app/features/page.tsx`** — Feature Factory Inspector (debug/dev) ✅

## Phase D — Pages autonomie & mémoire

- **[x]** — L1297: 🤖 **`/app/memory/page.tsx`** — Market Memory System ✅
- **[x]** — L1311: 🤖 **`/app/performance/page.tsx`** — Performance & Statistiques utilisateur ✅

## Composants partagés à créer (cross-pages)

- **[x]** — L1321: 🤖 **`components/ui/PageSkeleton.tsx`** — skeleton générique réutilisable par page ✅
- **[x]** — L1322: 🤖 **`components/ui/OpportunityScore.tsx`** — affichage score étoiles + valeur numérique ✅
- **[x]** — L1323: 🤖 **`components/ui/ProbabilityBar.tsx`** — barre de probabilité colorée (rouge→vert) ✅
- **[x]** — L1324: 🤖 **`components/ui/RegimeBadge.tsx`** — badge `TRENDING_BULL / RANGE / VOLATILE` ✅
- **[x]** — L1325: 🤖 **`components/ui/AssetTypeBadge.tsx`** — badge `CRYPTO / FOREX / SYNTHETIC / BRVM` ✅
- **[x]** — L1326: 🤖 **`components/ui/ConfidenceGauge.tsx`** — gauge circulaire animée pour confidence ✅
- **[x]** — L1327: 🤖 **`components/ui/RRRatioBadge.tsx`** — badge `1:2`, `1:4`, `1:8` colorés ✅
- **[x]** — L1328: 🤖 **`components/ui/TimeAgo.tsx`** — "il y a 3min" avec mise à jour automatique ✅
- **[x]** — L1329: 🤖 **`components/ui/LiveDot.tsx`** — point vert animé "LIVE" / rouge "OFFLINE" ✅
- **[x]** — L1330: 🤖 **`components/layout/ModeToggle.tsx`** — switch Débutant / Professionnel (persisté en localStorage) ✅

## 🎯 Trading Copilot UX — Ch.21 (Phase D+)

- **[x]** — L1336: 🤖 **Market Scanner — Ranking Engine** ✅
- **[x]** — L1341: 🤖 **Signal Card enrichie** — entrée zone + point optimal + TPs probabilistes ✅
- **—** — L1345: 🤖 **Graphique intelligent annoté** — TradingView Lightweight Charts
- **—** — L1349: 🤖 **"Pourquoi ce trade ?" + "Pourquoi PAS ?"** — AI Decision Trace
- **—** — L1354: 🤖 **Timeline du signal** — évolution probabilité en temps réel
- **—** — L1358: 🤖 **Mode débutant / professionnel**
- **—** — L1362: 🤖 **AI Conversation Layer — Market Copilot** (Ch.18 + Ch.21)
- **[x]** — L1367: 🤖 **Risk Management Dashboard** ✅
- **[x]** — L1372: 🤖 **Alert Engine intelligent** ✅ — `AlertService` utilisé par `SignalsService`, filtre par score d’opportunité, cap journalier 5, cooldown par symbole/timeframe, endpoint `/signals/alerts/stats`

## Tâches à faire

- **[x]** — L1571: 🤖 **Champ `profileSuitability` sur `Signal`** : calculé par `scan.py` via `derive_profile_suitability()` ✅
- **[x]** — L1572: 🤖 **Fonction `compute_profile_suitability`** : déjà implémentée côté engine (`derive_profile_suitability`) ✅
- **[x]** — L1573: 🤖 **Endpoint `/signals` avec filtre `?profile=`** : `SignalsService.findAll()` filtre par `profileSuitability` ✅
- **[x]** — L1574: 🤖 **Badges profils sur les cartes signaux** + filtre par profil dans la page Signaux ✅
- **[x]** — L1579: 🤖 **Onboarding profil optionnel** ✅ : questionnaire rapide dans Settings avec recommandation de profil

## Feedback loop et expérience utilisateur

- **—** — L1677: 🤖 **Journal enrichi** : enregistrer features du signal au moment de l'ouverture.
- **—** — L1678: 🤖 **Score post-trade** : comparer expected value vs realized PnL.
- **—** — L1679: 🤖 **Ajustement auto du score** : réduire le poids des features/conditions qui sous-performent.
- **—** — L1680: 🤖 **"Trading Copilot"** : expliquer après chaque trade fermé pourquoi le système avait raison ou tort.
- **—** — L1681: 🤖 **A/B testing stratégies** : tester variantes de règles sur papier avant mise en production.

## Mécanismes concrets à implémenter

- **—** — L1931: 🤖 ML Signal Success Predictor (`P(win)`) — nécessite un modèle entraîné (XGBoost/logistic) sur `SignalLog`/outcomes, pas fait

## 1. Stratégies : le moteur ne les utilise pas encore (critique) ⚠️ **SECTION OBSOLÈTE — vérifiée, 4/5 déjà faits**

- **[x]** — L1945: 🤖 Permettre `UserStrategy.customRules` pour outrepasser certains paramètres par utilisateur ✅ — `SignalsService.triggerScan()` fetch `userStrategy` enabled, merge `customRules` sur `strategy.rules` et envoie à l'engine

## 3. Détection précoce de tendance (early trend)

- **—** — L1967: 🤖 Volume profile (distribution des volumes par niveau de prix)
- **—** — L1968: 🤖 Momentum leading (ROC, Stochastique, Williams %R)

## 4. Continuation et épuisement d'une tendance en cours

- **[x]** — L1975: 🤖 Score de continuation basé sur ADX, structure intacte, volume, divergence HTF ✅
- **[x]** — L1976: 🤖 Détection d'épuisement : divergence HTF, structure cassée ✅ — `EXHAUSTED` dans `continuation_score()`
- **[x]** — L1977: 🤖 Ajuster TP2 ou activer trailing stop selon ce score ✅ — endpoint `/probability/continuation` + conseil Portfolio

## 6. Testeur Lab (validation stratégies par profil et marché)

- **—** — L2009: 🤖 Comparaison backtest vs paper trading (nécessite données paper en temps réel).

## 8. On-chain / macro / fondamentaux avancés

- **—** — L2034: 🤖 Fear & Greed, funding rates, exchange flows, MVRV, OI.
- **—** — L2035: 🤖 Calendrier économique Forex + DXY momentum + COT report.
- **—** — L2036: 🤖 Fondamentaux BRVM (P/E, dividendes, revenus, rapports émetteurs).
- **—** — L2037: 🤖 Début DEX / memecoins (Helius/Birdeye/dRPC) — Phase C/D.

## 9. Fiabilité et scalabilité

- **—** — L2042: WebSocket Binance : reconnexion, heartbeat, gestion des déconnexions.
- **—** — L2043: Rate limiting Twelve Data / Coinglass / CryptoQuant.
- **Haute** — L2044: Tests unitaires NestJS critiques (auth, positions, watcher) manquants.
- **—** — L2045: Migrations Prisma strictes (`prisma migrate deploy` en prod).

---

## 🔥 Short-list priorisée (top 15)

1. **[x]** Chargement & Vitesse — L690: 🤖 **Optimistic UI** sur mutations critiques (toggle/remove stratégies dans Settings) ✅
2. **[x]** Performance requêtes — L871: 🤖 **`EXPLAIN ANALYZE`** sur les requêtes critiques avant production via `GET /admin/db-performance` ✅
3. **[x]** `test_synthetic_engine.py` — Synthetic Market Engine ✅ — L940: `entropy()` + edge cases
4. **[x]** `test_probability_engine.py` — Probability Engine ✅ — L951: `tp_targets()` : probabilité TP3 < probabilité TP1 toujours + edge cases
5. **[x]** `test_risk.py` — Risk Engine ✅ — L990: `tp_linked_to_liquidity()` + staged stop + ajustement profil
6. **[x]** `SignalCard.spec.tsx` — Nouveau composant enrichi ✅ — L1037: TP1/TP2/TP3 avec probabilités → 3 lignes affichées
7. **[x]** 🎯 Trading Copilot post-trade review UI — Ch.21 (Phase D+) — L1372: review IA sur chaque trade fermé via `POST /ai/review/position/:id` ✅
8. **[x]** 9. Fiabilité et scalabilité — L2044: Tests unitaires NestJS critiques (auth, positions, watcher) complétés ✅
9. **[x]** 4. Continuation et épuisement d'une tendance en cours — L1977: 🤖 Ajuster TP2 ou activer trailing stop selon le score via `/probability/continuation` + UI Portfolio ✅
10. **[Basse]** Clés API MVP — L77: 👤 Optionnel : créer compte **OpenAI** → `OPENAI_API_KEY` pour activer GPT-4o
11. **[Basse]** Clés API MVP — L79: 👤 Optionnel : créer compte **Twelve Data** → `TWELVE_DATA_API_KEY` pour Forex réel
12. **[Basse]** Clés API MVP — L81: 👤 Optionnel : générer **DERIV_TOKEN** pour trades réels
13. **[Basse]** Clés API Phase A (post-déploiement) — L91: 👤 Optionnel : compte **Glassnode** → `GLASSNODE_API_KEY` (free tier)
14. **[Basse]** �🚀 Déploiement (priorité) — L1195: 👤 Configurer secrets GitHub pour CI/CD optionnel
15. **[x]** Tâches à faire — L1579: 🤖 **Onboarding profil optionnel** ✅ : questionnaire dans Settings avec recommandation de profil

---

## Fibonacci, Harmonic Patterns & Pattern Engine (nouveau — 16/07/2026)

- **[x]** — TODO Phase A: Staged Stop Engine (`risk.py`) ✅
- **[x]** — TODO Phase A: Pattern Engine minimal (`apps/engine/patterns/`) ✅
- **[x]** — TODO Phase A: Intégration scan : `metadata.detectedPatterns`, `prz`, `fibTargets`, `confluenceScore` ✅
- **[x]** — TODO Phase B: Harmonics avancés (Butterfly, Crab + placeholders Shark/5-0) ✅
- **[x]** — TODO Phase B: Confluence scorer + UI SignalCard PRZ/Fibonacci ✅
- **[x]** — TODO Phase B: Journal / Backtest par pattern ✅
- **[x]** — TODO Phase B: Feedback loop — journal enrichi, score post-trade, ajustement auto via `SignalPredictor` ✅
- **[x]** — TODO Phase C: Geometry Engine (`apps/engine/geometry/`) ✅
- **[x]** — TODO Phase C: ML sur patterns — `PatternPredictorService` ✅
- **[x]** — UI `/patterns` : stats par pattern + analyse post-trade ✅
- **Basse** — TODO Phase D: Market Graph Engine / GNN, Rust/PyO3 si profiling.
