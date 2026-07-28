---
description: Runbook collecte de données & tests manuels
---

# Runbook — Collecte de données ML & Tests manuels

## 1. Objectif
Accumuler des snapshots `signal_features` avec outcome réel et exécuter les tests manuels MVP. On vise :
- ≥ 200 signaux clôturés (WIN/LOSS) pour entraîner SignalScorer.
- ≥ 50 signaux par marché (CRYPTO/FOREX/SYNTHETIC/BRVM) si possible.
- Rapport quotidien des tests manuels.

## 2. Pré-requis
- Docker Desktop ou équivalent.
- Node 20+, Python 3.11+, npm 10.
- Variables `.env` complètes :
  - `DATABASE_URL`, `REDIS_URL`
  - `ENGINE_URL=http://localhost:8000`
  - Clés API min : `BINANCE_API_KEY`, `NEWS_API_KEY`, `TWELVE_DATA_API_KEY` (sinon fallback/mocks).
  - Sentry optionnel (`SENTRY_DSN_API`, `SENTRY_DSN_ENGINE`, `NEXT_PUBLIC_SENTRY_DSN`).

## 3. Démarrer la stack
```bash
# 1. Base de données + Redis
cd trading-os
docker compose up postgres redis -d

# 2. API NestJS
echo "API" && npm run dev:api

# 3. Engine FastAPI
cd apps/engine
.source .venv/bin/activate
python main.py

# 4. Web Next.js
echo "WEB" && npm run dev:web
```
Tips : utiliser tmux ou 4 terminaux. Vérifier `http://localhost:3001/api/health` et `http://localhost:8000/health`.

## 4. Générer des signaux
1. Onboard un utilisateur via l'UI (`/auth/register`).
2. Lancer manuellement un scan toutes les 4h :
   - UI : bouton "Scanner" page /signals.
   - ou API : `POST /api/signals/scan` avec une sélection d'actifs.
3. Laisser les signaux "vivre" : ne pas supprimer les positions, attendre que TP/SL se déclenchent.
4. Le watcher outcome (`SignalOutcomeService`) s'exécute via les Cron Nest (`scheduledMorningScan`, etc.). Laisser l'API tourner en continu.

### Suivi quotidien
- `SELECT COUNT(*) FROM signal_features WHERE outcome IS NOT NULL;`
- `SELECT outcome, COUNT(*) FROM signal_features GROUP BY outcome;`
- `SELECT market, COUNT(*) FROM signal_features GROUP BY market;`
Consigner ces chiffres dans `docs/runbooks/data-collection-log.md`.

### Script de métriques
Un raccourci est disponible :

```bash
npm run data:metrics --workspace=apps/api
```

Sortie typique :

```
── Signal Feature Metrics ───────────────────────────────
Total snapshots      : 142
Snapshots w/ outcome : 78 (54.9%)
Outcome distribution
  WIN_TP1   : 42 (53.8%)
  LOSS_SL   : 26 (33.3%)
  EXPIRED   : 10 (12.8%)
Snapshots by market
  CRYPTO     : 95 (66.9%)
  FOREX      : 33 (23.2%)
  SYNTHETIC  : 14 (9.9%)
Snapshots by timeframe
  15m      : 40 (28.2%)
  1h       : 62 (43.7%)
  4h       : 30 (21.1%)
```

Reporter les totaux pertinents dans le log quotidien.

## 5. Checklist tests manuels (à répéter au moins 1x/jour)
| Test | Étapes | Résultat |
| --- | --- | --- |
| Auth | Register → Login → Logout | ✅/⚠️ |
| Dashboard | Vérifier prix live BTC/ETH/SOL (WebSocket) | |
| Scan | Lancer scan 4 actifs, vérifier signaux créés + notifications | |
| Portfolio | Créer position paper, close, voir journal | |
| Backtest | BTC/USDT 1h → vérifier metrics/graphes | |
| BRVM | Charger page BRVM, vérifier données fundamentals | |
| Deriv | Page Deriv, analyser V75, vérifier score | |
| Chat RAG | poser question SMC/RSI → réponse cohérente | |
| Notifications SSE | Ouvrir /notifications, vérifier stream sans 401 | |

Documenter les anomalies dans `docs/runbooks/data-collection-log.md` + ouvrir issues GitHub.

## 6. Contrôler la pipeline ML
- Commande entraînement manuel : `POST /api/signals/predictor/train?market=CRYPTO&timeframe=1h&limit=2000`.
- UI "SignalScorer (ML)" : vérifier accuracy, date d'entraînement.
- Historique DB : `SELECT samples, accuracy, trained_market, updated_at FROM signal_models WHERE name='signal_scorer';`
- Relancer l'entraînement seulement si `sample_count` a augmenté de ≥ 50 depuis le run précédent.

## 7. Routines quotidiennes
1. 08:00 UTC — lancer scan manuel si aucun Cron n'a tourné.
2. 12:00 UTC — vérifier dashboard /predictor status.
3. 18:00 UTC — exécuter checklist tests manuels.
4. 23:00 UTC — snapshot SQL rapide : `pg_dump -t signal_features trading_os > backups/signal_features_$(date +%F).sql`

## 8. Backfill (optionnel)
- Script Python à écrire (TODO) : rejouer `scan` sur historique (via `backtest` ou `scan` custom) pour générer des features et outcomes plus rapidement.
- Attention à ne pas mélanger données synthétiques et réelles : tagger `snapshot_version`.

## 9. SLA / Alertes
- Si `signal_features` n'augmente pas pendant 24h → vérifier Cron + `SignalOutcomeService`.
- Si accuracy SignalScorer chute < 55% → suspendre l'utilisation en prod.
- Si websocket prix tombe, fallback REST `/prices/latest`.

## 10. Points de contact
- `docs/runbooks/data-collection-log.md` : log quotidien, anomalies, correctifs.
- `TODO.md` → coche rituels quand faits.
- Sentry API/Engine/Web pour erreurs runtime.
