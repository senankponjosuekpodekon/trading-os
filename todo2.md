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

- **Bloquant prod** : scan hardcodé `EMA Trend + RSI` ; `strategy_eval.py` non branché.
- **Bloquant prod** : aucun `profileSuitability` / filtrage par profil.
- **Bloquant prod** : tests critiques, migrations Prisma prod, rate limiting manquants.
- **Important** : signaux réactifs, pas prédictifs (pas de `DPS`/`TPS`/`P(win)`).
- **Important** : pas de modes d’entrée (`RETEST`, `BREAKOUT`, `LIMIT`, etc.).
- **Stratégique** : Testeur Lab non déployé.
- **Stratégique** : on-chain / macro non intégrés.
- **Long terme** : agent analyste, DEX avancé, omni-chain — non priorisés.

---

## 2. Sprints

### Sprint 0 — Fondations (semaines 1-2)

**Objectif** : repo déployable et testé sans rupture.

- [x] Stabiliser `docker-compose` + `dev.sh`. ✅ (healthchecks validés — build Docker local en attente réseau)
- [ ] `prisma migrate deploy` en prod et scripts de seed.
- [x] Tests unitaires critiques NestJS (`auth`, `positions`, `watcher`). ✅ (+ `signals`, `strategies`, `signal-outcome`, `backtest` — 45 tests)
- [ ] Rate limiting Twelve Data / Coinglass / CryptoQuant.
- [ ] Centraliser logs et erreurs HTTP.

**DOD** : `docker compose up` OK, `npm run test:api` passe, rate limit actif.

---

### Sprint 1 — Stratégies dynamiques (semaines 3-4)

**Objectif** : le moteur utilise `Strategy`/`UserStrategy` au lieu du hardcode.

- [ ] Étendre `strategy_eval.py` pour `analysis_timeframe`, `entry_timeframe`, `trigger`, `invalidation`, `exit_rules`.
- [ ] Modifier `scan.py` pour charger les stratégies actives et appeler `evaluate_strategy`.
- [ ] Supprimer le hardcodage `EMA Trend + RSI` dans `signals.service.ts`.
- [ ] Migrer les paramètres actuels en stratégies par défaut.
- [ ] Validation du DSL JSON.

**DOD** : créer une stratégie dans l’UI → utilisée au prochain scan.

---

### Sprint 2 — Profils & `profileSuitability` (semaines 5-6)

**Objectif** : tagguer chaque signal par profil, sans activation utilisateur complexe.

- [ ] Ajouter `profileSuitability` au modèle `Signal`.
- [ ] Définir `INVESTOR`, `SWING`, `DAY`, `SCALPER`.
- [ ] Adapter scoring, SL/TP/RR par profil.
- [ ] API `/signals?profile=SWING`.
- [ ] UI : badge `profileSuitability`.

**DOD** : filtrage par profil fonctionnel, pas de sélection active utilisateur.

---

### Sprint 3 — Modes d’entrée & invalidation (semaines 7-8)

**Objectif** : définir comment entrer et quand annuler un setup.

- [ ] Implémenter `RETEST`, `BREAKOUT`, `LIMIT`, `VOLATILITY_EXPANSION`, `MOMENTUM_CONFIRMATION`.
- [ ] Calcul `entryPrice` selon le mode.
- [ ] Gérer `invalidation` (close beyond OB/FVG, `max_wait_bars`, régime change).
- [ ] État `PENDING` pour les setups en attente de déclencheur.
- [ ] Scheduler différencié `analysis_timeframe` / `entry_timeframe`.

**DOD** : signal `RETEST` passe de `PENDING` à `ACTIVE` ou `INVALIDATED`.

---

### Sprint 4 — Moteur prédictif v1 (semaines 9-10)

**Objectif** : passer de réactif à prédictif sans ML lourd.

- [ ] Expected Move Engine (range haut/bas sur 5/10/20 bougies).
- [ ] Direction Probability Score `DPS`.
- [ ] Trigger Probability Score `TPS` pour `RETEST`/`LIMIT`.
- [ ] Conditions : `DPS > 60 %` + edge.
- [ ] `persistence_score` pour remplacer/enrichir l’hystérésis.

**DOD** : signal inclut `expected_move`, `dps`, `tps`; `dps < 60 %` non persisté.

---

### Sprint 5 — Trailing stops & feedback loop (semaines 11-12)

**Objectif** : gérer les positions ouvertes et apprendre des résultats.

- [ ] Trailing stop ATR 2x / structure / EMA / candlestick.
- [ ] Lifecycle `Position` : `OPEN` → `PARTIAL` → `CLOSED`.
- [ ] Journal auto à la clôture.
- [ ] Feedback loop sur `confidence`.
- [ ] `ML Signal Success Predictor` v0.

**DOD** : position avec trailing stop mise à jour à chaque scan; stats par stratégie.

---

### Sprint 6 — Testeur Lab (semaines 13-15)

**Objectif** : créer, backtester et paper-trader une stratégie.

- [ ] Module Lab backend : CRUD `UserStrategy`, paper trading, évaluation.
- [ ] Connecteur `backtest.py` au DSL `Strategy`.
- [ ] UI Lab : création visuelle, lancement backtest, rapports.
- [ ] Rapport : win rate, drawdown, profit factor, expectance.
- [ ] Comparaison vs benchmark.

**DOD** : utilisateur crée une stratégie, lance un backtest, reçoit un rapport.

---

### Sprint 7 — Data avancées & macro (semaines 16-17)

**Objectif** : enrichir le contexte marché.

- [ ] On-chain (Coinglass / CryptoQuant).
- [ ] Macro/fondamentaux (calendrier économique, taux).
- [ ] Sentiment amélioré (LLM RAG).
- [ ] Funding rates / COT / spot-perp.

**DOD** : chaque signal affiche un `context` macro + on-chain + sentiment.

---

### Sprint 8 — SaaS readiness & scale (semaines 18-20)

**Objectif** : production sereine.

- [ ] CI/CD (tests + build + deploy). → **tests + build en place** (jobs api/web/engine/docker dans `.github/workflows/ci.yml`) — reste le deploy
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

1. Sprint 0 — stabiliser migrations, tests, rate limiting.
2. Sprint 1 — brancher `strategy_eval` dans `scan.py` et virer le hardcode.
3. Sprint 2 — ajouter `profileSuitability` et filtrage par profil.





Optionnel / amélioration continue (non bloquant)
Vulnérabilités npm : 5 signalées dans le web (1 moderate, 4 high) → npm audit pour voir si elles sont exploitables
Tests E2E réels : les tests d'intégration mockent Prisma/HTTP ; aucun test contre la vraie DB Postgres que la CI démarre pourtant
Modules API sans specs : portfolios, journal, notifications, ai (si tu veux une couverture complète)
Migration Next.js 15 à terme, pour revenir à ESLint 9 (le downgrade vers ESLint 8 est un contournement, ESLint 8 est EOL)
Dockerfile API non optimisé : npm install sans lockfile ni cache multi-stage — à améliorer quand le build passera
Prochaine étape immédiate
Attendre la fin du Docker build (je peux revérifier son statut), puis si OK, builder l'image engine. Après ça, la todo list est vide — le backend est prêt pour un push et une validation CI sur GitHub.