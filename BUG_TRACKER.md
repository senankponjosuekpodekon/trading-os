# Bug Tracker — Trading OS

> Document de suivi consolidé des bugs identifiés lors de l'audit.
> Statuts: ✅ fixé | 🔧 en cours | 🔴 non traité | 🟡 à confirmer

## Engine (Python)

| # | Bug | Fichier | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 1 | regime_filter trop permissif | `scan.py:1217-1227` | ✅ | Haute | Fix #9 original sautait tout regime_filter au lieu de juste VOLATILE. Corrigé: ne skip que VOLATILE quand la stratégie l'autorise explicitement. |
| 2 | Predictive metrics stale après raffinement | `scan.py:1268-1286` | ✅ | Haute | Fix #10b: dps/tps/expected_move calculés sur ancien tp1/sl ATR-based. Ajout recalcul après raffinement liquidity-aware. |
| 3 | Features catégorielles droppées | `signal_scorer.py:36-65` | ✅ | Moyenne | `_coerce_number` rejetait toutes les strings. Ajout one-hot encoding pour regime, pa_trend, bos_dir, session, asset_type, etc. |
| 4 | Seuils compute_dps/tps hardcodés | `predictive.py` + `strategy_eval.py` | ✅ | Moyenne | volume_spike_min (1.3) et bb_bw_min (0.02) hardcodés. Maintenant passés depuis rules via compute_predictive_metrics. |
| 5 | Leaderboard vide | `ml_feedback.py:18-24` | ✅ | Basse | _leaderboard_store jamais peuplé dans submit_feedback. Ajout mise à jour du leaderboard à chaque feedback. |
| 6 | Cron 1h hardcodé | `signals.service.ts:128-192` | ✅ | Haute | Cron utilisait '1h' pour toutes les stratégies. Corrigé: groupage par analysisTimeframe, un triggerScan par groupe. |
| 7 | BRVM sans code path vers evaluate_strategy | `brvm.py:140-261` | ✅ | Moyenne | analyze_brvm_symbols route maintenant via evaluate_strategy avec règles BRVM Value Swing. Indicateurs approximés construits depuis quote data. |
| 8 | probability_engine.py — branchement non confirmé | `probability.py` | ✅ | Moyenne | Confirmé: module autonome (continuation advice, trailing SL) exposé via API. Non branché dans scan — c'est un outil post-trade, pas un bug. |
| 9 | regime_classifier HMM jamais persisté | `ml_regime.py` | ✅ | Moyenne | Ajout persistance sur disque (_save_model/_load_model) + endpoint /ml/regime/auto-train qui fetch BTC closes réels depuis Binance. |
| 10 | regime_classifier HMM input fabriqué | `signals.service.ts:40-60` | ✅ | Moyenne | predictMlRegime fetch maintenant les closes historiques réels via engine /candles au lieu de fabriquer une série synthétique. |
| 11 | 4-5 classifications asset_type divergentes | `scan.py`, `portfolio_risk.py`, `feature_factory.py` | 🟡 | Basse | get_asset_type vs ASSET_CLUSTERS vs _infer_asset_type donnent des résultats différents pour certains symboles (ex: EUR/USDT). |
| 12 | Sous-scores non produits | `scan.py:1442-1456` | ✅ | Moyenne | Ajout score_trend, score_pa, score_sr, score_patterns, score_regime, score_smc, score_mtf, score_sentiment dans indicators. predictMlConfidence et signal-outcome reçoivent maintenant les sous-scores. |

## API (NestJS/TypeScript)

| # | Bug | Fichier | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 13 | bos_dir mismatch (_apply_trigger) | `strategy_eval.py:139-142` | ✅ | Haute | Comparait "up"/"down" au lieu de "BULLISH"/"BEARISH" (format réel de price_action.py). SMC Retest OB/FVG ne produisait jamais de signal. |
| 14 | bos_dir mismatch (price_action_bonus) | `price_action.py:209-219` | ✅ | Haute | Comparait bos_dir == signal_direction ("BUY"/"SELL") au lieu de mapper BULLISH→BUY, BEARISH→SELL. BOS bonus jamais appliqué. |
| 15 | _find_nearest_ob_fvg crash sur dict | `strategy_eval.py:98-107` | ✅ | Haute | smc.py retourne des dicts ({bottom, top, mid}), pas des floats. Ajout extraction du prix. |
| 16 | BRVM mislabeling | `signals.service.ts:391-401` | ✅ | Haute | Tous les signaux BRVM faussement attribués à "EMA Trend + RSI". Corrigé: BRVM signals sans strategy_id ne reçoivent plus defaultStrategy. |
| 17 | PENDING mort | `signals.service.ts:380-383` | ✅ | Haute | signal_pending===true éliminait tout signal avant création. Corrigé: distinction hysteresis (skip) vs RETEST/LIMIT (persist as PENDING). |

## Résumé

- **Total bugs identifiés**: 17
- **Fixés**: 16 (✅)
- **À confirmer**: 1 (🟡 — #11 asset_type divergent, basse priorité)

## Priorités restantes

1. **� #11 — Classifications asset_type divergentes** (basse priorité, impact marginal)
2. **⚠️ Tests NestJS** — Les tests `signals.service.spec.ts` utilisent `_scanActiveAssets` qui n'existe plus (renommé `_scanActiveAssetsByTimeframe`). À mettre à jour.

## Notes

- Fix #10 (liquidity-aware post-merge): le bloc s'exécute **après** `evaluate_strategy` et **avant** le caution filter Synthetic. Pas de duplication avec le bloc pre-strategy (qui s'exécute seulement en mode hardcoded sans stratégie).
- Le `entry` utilisé pour filtrer les zones EQL/EQH est bien le `entry` post-merge (ligne 1236: `z["price"] <= entry`), pas une variable stale.
- Les signaux `signal_pending` avec trigger RETEST/LIMIT sont maintenant persistés avec `status: 'PENDING'` au lieu d'être éliminés.

---

## Addendum — Audit externe (31 juillet 2026)

### Bugs fixés dans cette session

| # | Bug | Fichier | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 18 | Macro events hardcodés en permanence | `market-data.service.ts:132-167` | ✅ | Haute | `getFallbackMacroEvents()` était toujours préfixé au résultat, même quand l'API externe réussissait. Dates fixes (29-30 juil, 1er/12 août) devenaient périmées mais restaient injectées → `decisionTrace` et `should_suspend_forex` faussés. Fix: fallback uniquement dans le `catch`, retourne `[]` sinon. |
| 19 | MTF/DXY/tokenomics/social écrasés par evaluate_strategy | `scan.py:1211-1321` | ✅ | **Critique** | `evaluate_strategy` écrase signal/confidence/score, bypassant silencieusement: macro_risk (suspension Forex avant news), tokenomics danger_flag, DXY momentum, social bonus, MTF confluence. Fix: re-application de tous les garde-fous APRÈS `evaluate_strategy`. |
| 20 | Endpoint /candles/ inexistant | `main.py` + `signals.service.ts:45` | ✅ | Haute | `predictMlRegime` appelait `${engineUrl}/candles/${symbol}` — endpoint qui n'existait pas → catch silencieux → HMM regime classifier jamais utilisé en production. Fix: ajout endpoint `/candles/{symbol}` dans `main.py` avec fallback multi-provider. |
| 21 | Biais intrabar optimiste (backtest) | `backtest.py:182-183` | ✅ | Haute | Si TP et SL touchés sur la même bougie, le code supposait TP en premier → win rate gonflé artificiellement. Fix: résolution pessimiste (SL prioritaire en cas d'ambiguïté). |
| 22 | Timeout backtest fixe (24 bougies) | `backtest.py:182` | ✅ | Moyenne | 24 bougies indépendant du timeframe → pénalise Swing/Investor. Fix: timeout adaptatif par timeframe (15m=96, 1h=72, 4h=42, 1d=21, 1w=12). |
| 23 | Sharpe ratio mal annualisé | `backtest.py:79-85` | ✅ | Moyenne | `sqrt(252)` suppose fréquence journalière, pas par trade. Non comparable entre stratégies à fréquences différentes. Fix: Sharpe par trade sans annualisation. |
| 24 | STAC typo slug | `brvm_reports.py:75` | ✅ | Moyenne | `"slibra"` au lieu de `"solibra"` → fetch 404 → STAC n'a jamais reçu de bonus fondamental. |
| 25 | fetch_all_issuers sans timeout | `brvm_reports.py:141-151` | ✅ | Moyenne | Pas de `asyncio.wait_for` contrairement à `fetch_all_company_reports`. Si brvm.org est lent, tout le scoring fondamental BRVM bloque. Fix: timeout 15s. |
| 26 | feature-store market filter case-sensitive | `feature-store.service.ts:125` | ✅ | Basse | `where.signal.asset = { market: { name: market } }` sans `mode: 'insensitive'`. Même bug que `_statsByMarket` corrigé précédemment. |
| 27 | Synthetic assets non routés vers _analyze_synthetic_candles | `scan.py:723-726` | ✅ | Haute | BOOM1000/USD et autres indices Deriv passaient par EMA/RSI/MACD au lieu du moteur statistique. Fix: early return vers `_analyze_synthetic_candles`. |

### Points ouverts (non traités — à prioriser)

| # | Sujet | Fichier(s) | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 28 | 3 systèmes de calcul R:R non unifiés | `strategy_eval.py`, `risk.py`, `probability_engine.py` | 🔴 | Haute | Trois calculs indépendants de R:R avec formules différentes. Aucun ne sert de référence canonique. Unification nécessaire pour cohérence des signaux et du backtest. |
| 29 | 3 mécanismes de trailing stop non orchestrés | `trailing_stop.py`, `scan.py` (SL liquidity-aware), `probability.py` | 🔴 | Haute | Trois systèmes de trailing stop indépendants. Aucune orchestration définissant quel mécanisme s'applique quand, ni priorité en cas de conflit. |
| 30 | sr_zones.py vs smc.py — définitions divergentes de zone | `sr_zones.py`, `smc.py` | 🔴 | Moyenne | Deux modules calculent des zones de support/résistance avec des méthodes différentes. Les deux alimentent `analyze_candles` mais ne sont pas réconciliés. |
| 31 | Backtest — Binance-only | `backtest.py:13,143` | 🔴 | Moyenne | `fetch_binance_klines` uniquement. Forex, Synthetic, Commodities, BRVM ne sont pas backtestables. Refetch multi-provider nécessaire. |
| 32 | Backtest — contexte manquant à l'appel | `backtest.py:225` | 🔴 | Moyenne | `analyze_candles` appelé sans `htf_regime`/`mtf_regime`/`onchain`/`forex_context`/`tokenomics_context`/`social_context`. Version appauvrie non comparable au pipeline live. |
| 33 | quota.service.ts — TOCTOU race condition | `quota.service.ts` | 🟡 | Moyenne | `assertSignalQuota` (lecture) puis `incrementSignalUsage` (écriture) sans atomicité. Double scan concurrent peut dépasser la limite. Fix: contrainte atomique DB (`UPDATE ... WHERE used < limit RETURNING ...`). |
| 34 | quota.service.ts — fail-open sans abonnement | `quota.service.ts` | 🟡 | Moyenne | `getPlanLimits` retourne `null` si pas d'abonnement → toutes les fonctions `assert*` retournent sans restriction. Accès illimité pour utilisateurs sans abonnement. Décision design: fail-open volontaire ou free tier avec limites? |
| 35 | brvm_reports.py — format date PDF à vérifier | `brvm_reports.py:83-90` | 🟡 | Moyenne | `_extract_pdf_date` suppose `YYYYMMDD-` ou `YYYYMMDD_` dans l'URL du PDF. Si le format réel diffère sur brvm.org, `published_at` reste `None` pour tous → `fundamental_score` retourne 0 silencieusement. À vérifier empiriquement. |
| 36 | brvm.py — EMA/RSI approximés depuis quote unique | `brvm.py:140-261` | 🟡 | Moyenne | `fetch_brvm_quotes` retourne un instantané (prix, change_pct, volume) sans série temporelle. Construction d'EMA20/50/200/RSI/ATR à partir d'une seule observation — possiblement hallucinée. À vérifier. |

## Addendum 2 — Audit du 31/07/2026 (tour 2)

| # | Titre | Fichier(s) | Statut | Priorité | Description |
|---|-------|------------|--------|----------|-------------|
| 37 | Lab DSL incompatible avec StrategyRules — backtest silencieusement baseline | `lab.service.ts`, `strategy_eval.py` | ✅ Fixé | 🔴 Haute | `getStrategyTemplates()` produisait un DSL `{type, filters[], entry, exit}` non reconnu par `parse_rules()`. Tous les backtests Lab testaient la stratégie baseline générique. Fix: templates convertis vers `{rules: {ema_fast, exit_rules, ...}}` compatible avec `StrategyRules`. |
| 38 | positions.service.ts — positions hors 4 paires Binance jamais surveillées | `positions.service.ts:54-65` | ✅ Fixé | 🔴 Haute | `fetchLivePrice` retournait `null` pour tout symbole hors `SYM_MAP` (4 paires Binance). `_syncOneTrailingStop` sortait immédiatement sans vérifier TP/SL/trailing. Fix: fallback vers engine `/candles/{symbol}` (multi-provider: deriv, twelvedata, yfinance). |
| 39 | market_concept_layer.py — clé "zones" inexistante, contribution S/R toujours nulle | `market_concept_layer.py:190` | ✅ Fixé | 🟡 Moyenne | `sr.get("zones", [])` — la clé `zones` n'existe pas dans la sortie de `get_sr_zones()` qui retourne `{supports, resistances}`. Fix: `sr.get("supports", []) + sr.get("resistances", [])`. |
| 40 | openFromSignal — pas de vérification anti-doublon | `positions.service.ts:382+` | ✅ Fixé | 🟡 Moyenne | `openFromSignal` ne vérifiait pas `status IN (OPEN, PARTIAL)` sur même portfolio+asset, contrairement à `create()`. Fix: ajout du même garde-fou `ConflictException('DUPLICATE_POSITION')`. |
| 41 | parse_rules — ignore silencieusement les clés inconnues | `strategy_eval.py:200-206` | ✅ Fixé | 🟡 Moyenne | `if hasattr(r, key)` ignorait toute clé inconnue sans warning. Cause racine des bugs #37 et BRVM historique. Fix: warning `structlog` sur clés non présentes dans `StrategyRules.__dataclass_fields__`. |
| 42 | #28 confirmé: `tp_targets`/`trade_quality_probability`/`entry_zone`/`direction_engine` — code mort | `probability.py` | 📝 Documenté | 🟡 Basse | Grep confirme: aucune fonction de `probability_engine.py` (sauf `continuation_score`) n'est appelée côté API. Le "3e système R:R" n'existe pas en production. 2 systèmes réels: `strategy_eval.py` (signaux) + `risk.py` (sizing manuel). |
| 43 | #29 confirmé: `compute_staged_stop` et `trailing_sl` — code mort | `risk.py`, `probability.py` | 📝 Documenté | 🟡 Basse | Grep confirme: `/risk/staged-stop` n'a aucun appelant côté API. `trailing_sl` n'est appelé par aucun endpoint. 1 système de trailing réellement vivant: `trailing_stop.py` via `/trailing-stop/compute`. |
| 44 | #31 fixé: backtest multi-provider | `backtest.py:13,144` | ✅ Fixé | 🔴 Haute | `fetch_binance_klines` uniquement → Forex/Synthetic/BRVM/Commodities non backtestables. Fix: cascade `binance → deriv → twelvedata → yfinance` réutilisant les fonctions existantes de `scan.py`. |
| 45 | Double cache expected-move | `signals.service.ts`, `ExpectedMoveService` | 📝 Ouvert | 🟡 Basse | Deux implémentations indépendantes de cache expected-move avec TTL séparés. Potentiellement double appel engine pour la même donnée. À unifier. |
| 46 | PatternPredictorService non persisté, pas de cron d'auto-train | `signals.service.ts` | 📝 Ouvert | 🟡 Moyenne | `predict()` retourne `{probability: NaN}` après chaque redémarrage tant que `/signals/pattern-predictor/train` n'est pas appelé manuellement. Même classe de bug que le HMM avant son fix. |
| 47 | price-alerts — vérification limitée aux paires Binance du ticker | `watcher.service.ts` | 📝 Ouvert | 🟡 Moyenne | `checkAlerts` est bien appelé par le cron `WatcherService` (EVERY_5_MINUTES), mais les prix proviennent uniquement du ticker Binance. Alertes sur Forex/Synthetic/BRVM ne se déclencheront jamais. |
