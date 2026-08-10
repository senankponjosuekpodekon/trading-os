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
| 11 | 4-5 classifications asset_type divergentes | `scan.py`, `portfolio_risk.py`, `feature_factory.py` | ✅ | Basse | `feature_factory.py::_infer_asset_type` avait sa propre logique de classification divergente de `scan.py::get_asset_type`. Fix: `_infer_asset_type` délègue maintenant à `get_asset_type` (source unique). `portfolio_risk.py::get_cluster` reste séparé intentionnellement (clusters de corrélation, pas asset_type). |
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
- **Fixés**: 17 (✅)
- **À confirmer**: 0

## Priorités restantes

1. **⚠️ Tests NestJS** — Les tests `signals.service.spec.ts` utilisent `_scanActiveAssets` qui n'existe plus (renommé `_scanActiveAssetsByTimeframe`). À mettre à jour.

## Notes

- Fix #10 (liquidity-aware post-merge): le bloc s'exécute **après** `evaluate_strategy` et **avant** le caution filter Synthetic. Pas de duplication avec le bloc pre-strategy (qui s'exécute seulement en mode hardcoded sans stratégie).
- Le `entry` utilisé pour filtrer les zones EQL/EQH est bien le `entry` post-merge (ligne 1236: `z["price"] <= entry`), pas une variable stale.
- Les signaux `signal_pending` avec trigger RETEST/LIMIT sont maintenant persistés avec `status: 'PENDING'` au lieu d'être éliminés.
- **Hardcoded pipeline → DEFAULT_STRATEGY**: Quand aucune stratégie n'est fournie, `analyze_candles` utilise maintenant `DEFAULT_STRATEGY` (nom="Default", min_confidence=40, use_smc=True) au lieu du pipeline hardcoded. Tous les signaux passent par `evaluate_strategy` avec ses filtres (confidence, regime, DPS, profile). Le résultat inclut `is_default: true` pour traçabilité. Le pipeline hardcoded (lignes 810-999) s'exécute toujours pour préparer les données (sr, smc, pa, regime) mais son score est écrasé par `evaluate_strategy`.

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
| 28 | 3 systèmes de calcul R:R non unifiés | `strategy_eval.py`, `risk.py`, `scan.py`, `synthetic_engine.py`, `brvm.py` | ✅ | Haute | Fonctions mortes supprimées de `probability.py` (`direction_engine`, `trade_quality_probability`, `entry_zone`, `tp_targets`, `trailing_sl`) et `compute_staged_stop` supprimé de `risk.py`. Calcul R:R unifié via `utils/risk_reward.py::compute_rr(entry, sl, tp1)`. Tous les modules (`strategy_eval.py`, `risk.py`, `scan.py`, `synthetic_engine.py`, `brvm.py`) importent maintenant cette fonction canonique. |
| 29 | 3 mécanismes de trailing stop non orchestrés | `trailing_stop.py`, `scan.py` (SL liquidity-aware), `probability.py` | ✅ | Haute | `compute_staged_stop` (code mort confirmé par #43) supprimé de `risk.py` avec son endpoint `/risk/staged-stop` et ses tests. `trailing_sl` (code mort dans `probability.py`) supprimé. Reste 1 système vivant : `trailing_stop.py::compute_trailing_stop` (endpoint `/trailing-stop/compute`) + SL liquidity-aware dans `scan.py`. Ces 2 systèmes sont intentionnels : `trailing_stop.py` gère le trailing dynamique post-trade, le SL liquidity-aware ajuste le SL initial. |
| 30 | sr_zones.py vs smc.py — définitions divergentes de zone | `sr_zones.py`, `smc.py`, `strategy_eval.py` | ✅ | Moyenne | Deux modules calculent des zones S/R avec des méthodes différentes (statistique vs institutionnel). Complémentaires, pas en conflit. Fix: ajout de `use_smc` flag (opt-in, défaut False) dans `StrategyRules` + `smc_bonus` intégré dans `evaluate_strategy`. SMC Retest seed mise à jour avec `use_smc: true`. |
| 31 | Backtest — Binance-only | `backtest.py:13,143` | ✅ | Moyenne | Fixé par #44 : cascade `binance → deriv → twelvedata → yfinance` réutilisant les fonctions de `scan.py`. |
| 32 | Backtest — contexte manquant à l'appel | `backtest.py:249` | ✅ | Moyenne | `analyze_candles` était appelé sans `htf_regime`/`mtf_regime`. Fix: calcul du régime MTF/HTF par resampling des données historiques (LTF → MTF/HTF via `df.resample()`) et passage à `analyze_candles`. On-chain/forex/tokenomics/social non passés (non disponibles en backtest hors-ligne). |
| 33 | quota.service.ts — TOCTOU race condition | `quota.service.ts` | ✅ | Moyenne | `assertSignalQuota` (lecture) puis `incrementSignalUsage` (écriture) sans atomicité. Fix: `incrementSignalUsage` utilise maintenant `updateMany` avec `WHERE signals_used < limit` (atomic check-and-increment). Si aucune ligne n'est retournée, le quota est dépassé. Gestion de la race condition sur création de ligne avec retry atomique. |
| 34 | quota.service.ts — fail-open sans abonnement | `quota.service.ts` | ✅ | Moyenne | `getPlanLimits` retournait `null` si pas d'abonnement → toutes les fonctions `assert*` retournaient sans restriction. Fix: free tier par défaut (1 portfolio, 1 stratégie, 5 signaux/jour) retourné quand aucune souscription active. |
| 35 | brvm_reports.py — format date PDF à vérifier | `brvm_reports.py:83-90` | ✅ | Moyenne | Vérifié empiriquement sur brvm.org : les URLs PDF utilisent le format `YYYYMMDD_-_` (ex: `20260724_-_rapport_dactivites...`). Le regex `r"/(\d{4})(\d{2})(\d{2})[-_]"` matche correctement. Pas de bug. |
| 36 | brvm.py — EMA/RSI approximés depuis quote unique | `brvm.py:140-261` | ✅ | Moyenne | EMA20/50/200 étaient toutes égales au prix courant, RSI estimé via `50 + chg*4`, ATR via `price * |chg| / 100`. Fix: `fetch_brvm_history()` ajoutée dans `brvm_scraper.py` via `brvm-package` (PyPI) qui fournit l'historique OHLCV (2 ans). Indicateurs (EMA, RSI Wilder, ATR, MACD, BB, volume ratio) maintenant calculés depuis la série temporelle réelle. Fallback approximatif conservé si l'historique est indisponible. |

## Addendum 2 — Audit du 31/07/2026 (tour 2)

| # | Titre | Fichier(s) | Statut | Priorité | Description |
|---|-------|------------|--------|----------|-------------|
| 37 | Lab DSL incompatible avec StrategyRules — backtest silencieusement baseline | `lab.service.ts`, `strategy_eval.py` | ✅ Fixé | 🔴 Haute | `getStrategyTemplates()` produisait un DSL `{type, filters[], entry, exit}` non reconnu par `parse_rules()`. Tous les backtests Lab testaient la stratégie baseline générique. Fix: templates convertis vers `{rules: {ema_fast, exit_rules, ...}}` compatible avec `StrategyRules`. |
| 38 | positions.service.ts — positions hors 4 paires Binance jamais surveillées | `positions.service.ts:54-65` | ✅ Fixé | 🔴 Haute | `fetchLivePrice` retournait `null` pour tout symbole hors `SYM_MAP` (4 paires Binance). `_syncOneTrailingStop` sortait immédiatement sans vérifier TP/SL/trailing. Fix: fallback vers engine `/candles/{symbol}` (multi-provider: deriv, twelvedata, yfinance). |
| 39 | market_concept_layer.py — clé "zones" inexistante, contribution S/R toujours nulle | `market_concept_layer.py:190` | ✅ Fixé | 🟡 Moyenne | `sr.get("zones", [])` — la clé `zones` n'existe pas dans la sortie de `get_sr_zones()` qui retourne `{supports, resistances}`. Fix: `sr.get("supports", []) + sr.get("resistances", [])`. |
| 40 | openFromSignal — pas de vérification anti-doublon | `positions.service.ts:382+` | ✅ Fixé | 🟡 Moyenne | `openFromSignal` ne vérifiait pas `status IN (OPEN, PARTIAL)` sur même portfolio+asset, contrairement à `create()`. Fix: ajout du même garde-fou `ConflictException('DUPLICATE_POSITION')`. |
| 41 | parse_rules — ignore silencieusement les clés inconnues | `strategy_eval.py:200-206` | ✅ Fixé | 🟡 Moyenne | `if hasattr(r, key)` ignorait toute clé inconnue sans warning. Cause racine des bugs #37 et BRVM historique. Fix: warning `structlog` sur clés non présentes dans `StrategyRules.__dataclass_fields__`. |
| 42 | #28 confirmé: `tp_targets`/`trade_quality_probability`/`entry_zone`/`direction_engine` — code mort | `probability.py` | ✅ Supprimé | 🟡 Basse | Fonctions mortes supprimées dans le fix #28. Seul `continuation_score` reste. |
| 43 | #29 confirmé: `compute_staged_stop` et `trailing_sl` — code mort | `risk.py`, `probability.py` | ✅ Supprimé | 🟡 Basse | Fonctions mortes supprimées dans le fix #29. `compute_staged_stop`, endpoint `/risk/staged-stop`, et `trailing_sl` retirés. |
| 44 | #31 fixé: backtest multi-provider | `backtest.py:13,144` | ✅ Fixé | 🔴 Haute | `fetch_binance_klines` uniquement → Forex/Synthetic/BRVM/Commodities non backtestables. Fix: cascade `binance → deriv → twelvedata → yfinance` réutilisant les fonctions existantes de `scan.py`. |
| 45 | Double cache expected-move | `signals.service.ts`, `ExpectedMoveService` | ✅ | Basse | `SignalsService` maintenait son propre cache `expectedMoveCache` (TTL 5min) + inflight map, dupliquant `ExpectedMoveService` (TTL 1min). Fix: `SignalsService.fetchExpectedMove` délègue maintenant à `ExpectedMoveService.getExpectedMove()`. Cache local et inflight map supprimés. `ExpectedMoveModule` importé dans `SignalsModule`. |
| 46 | PatternPredictorService non persisté, pas de cron d'auto-train | `signals.service.ts` | ✅ | Moyenne | `predict()` retournait `{probability: NaN}` après chaque redémarrage. Fix: cron `@Cron('45 */6 * * *')` ajouté — auto-train toutes les 6h (30 min après le predictor training). `PatternPredictorService` injecté dans `SignalsService`. |
| 47 | price-alerts — vérification limitée aux paires Binance du ticker | `watcher.service.ts` | ✅ | Moyenne | `checkAlerts` est appelé par le cron `WatcherService` (EVERY_5_MINUTES), mais les prix proviennent uniquement du ticker Binance. Alertes sur Forex/Synthetic/BRVM ne se déclencheront jamais. Fix: `_fetchAllPrices` utilise déjà `_fetchEnginePrices` pour les symboles non-Binance (forex, synthetic, BRVM, commodities) via le moteur multi-provider. Bug déjà résolu par le fix #38. |

## Addendum 3 — Audit du 31/07/2026 (tour 3 — patterns & direction normalization)

| # | Titre | Fichier(s) | Statut | Priorité | Description |
|---|-------|------------|--------|----------|-------------|
| 48 | patterns_bonus — pénalité inversée BULLISH/BUY | `patterns.py:104-136` | ✅ Fixé | 🔴 Haute | `pin == signal_direction` comparait "BULLISH" avec "BUY" → jamais vrai (bonus +15 mort), `pin != signal_direction` → toujours vrai (pénalité -8 systématique). Fix: `directions_aligned`/`directions_opposed` via `utils/direction.py`. |
| 49 | confluence.py — pa_trend et bos_dir jamais alignés | `confluence.py:77-84` | ✅ Fixé | 🔴 Haute | Même mismatch: `pa_trend == direction` comparait "BULLISH" avec "BUY". 0.18 de score (23% du max) structurellement inatteignable pour tous les patterns. Fix: `normalize_direction()` avant comparaison. |
| 50 | price_action.py — mapping en dur migré | `price_action.py:185-220` | ✅ Fixé | 🟡 Moyenne | Quatre paires `("BUY" and "BULLISH")` en dur migrées vers `directions_aligned()`/`normalize_direction()` pour cohérence avec la source de vérité centralisée. |
| 51 | strategy_eval.py — mapping BOS en dur migré | `strategy_eval.py:142-148` | ✅ Fixé | 🟡 Moyenne | Deux branches `signal == "BUY" and bos_dir in ("up", "BULLISH")` migrées vers `directions_aligned(bos_dir, signal)`. |
| 52 | harmonic.py — KeyError FIB["2.24"] et FIB["3.14"] | `harmonic.py:13-24,242,290` | ✅ Fixé | 🔴 Haute | `FIB` dict manquait les clés `2.24` (Butterfly) et `3.14` (Crab). KeyError non attrapé → toute la détection harmonique crashait silencieusement. Fix: ajout `2.24` et `3.618` (ratio Pesavento standard, `3.14` était une faute de frappe). |
| 53 | harmonic.py + detector.py — crashes silencieux | `harmonic.py:348-360`, `detector.py:41-43` | ✅ Fixé | 🔴 Haute | Aucun try/except par candidat dans `detect_harmonic` → un crash sur Butterfly/Crab tuait tous les ABCD/Gartley/Bat déjà trouvés. `detector.py` avalait l'exception sans logger. Fix: try/except par check + `logger.warning` dans le coordinateur. |
| 54 | detector.py::_recency — right_trough manquant | `detector.py:46-54` | ✅ Fixé | 🟡 Moyenne | `detect_double_bottom` produit `points = {left_trough, right_trough, neckline}` — aucune des clés vérifiées ne matchait → recency toujours 0. Fix: ajout `if "right_trough" in points`. |
| 55 | _alternating_pivots — close.std() global vs local | `harmonic.py:69` | ✅ Fixé | 🟡 Moyenne | `close.std()` calculé sur toute la fenêtre (200+ bougies) au lieu d'une fenêtre glissante. Sur tendance longue, seuil explose → pivots filtrés → détection harmonique vide. Fix: `close.rolling(14, min_periods=3).std()`. |
| 56 | Buffer methodology — single-candle range au lieu d'ATR(14) | `double_top.py`, `head_shoulders.py` | ✅ Fixé | 🟡 Moyenne | `buffer = range(dernière bougie) * 0.3` → une bougie anormale fausse le stop-loss. Fix: `_pattern_buffer()` utilise ATR(14) avec fallback single-candle, cohérent avec `smc.py`, `regime.py`, `price_action.py`. |
| 57 | test_buy_targets_with_atr — assertion périmée | `test_risk.py:52-55` | ✅ Fixé | 🟡 Moyenne | Test encodait l'ancien comportement ATR-based (`106.0`/`110.5`) de `calc_targets`, mais le Fix #8 avait remplacé par R/R-based (`110.0`/`115.0`). Test jamais relancé en suite complète jusqu'ici. Fix: assertion mise à jour. |

### Addendum 4: Audit Sécurité & Consolidation (Batch #4)

**#58 `/deriv/scalp` — exécution de trades réels sans risk system**
- **Status**: Fixed (live disabled)
- **Priority**: 🔴 Critical
- **Description**: Le endpoint `/deriv/scalp` plaçait de vrais contrats Deriv avec argent réel dès que `DERIV_API_TOKEN` était configuré, via sa propre logique de scoring (`_v75_scalp_strategy`) complètement séparée de `evaluate_strategy`/DSL. Aucun garde-fou : pas de risk engine, pas de drawdown guard, pas de position sizing, pas de quota, pas d'audit log, pas de RLS, pas de tracking dans `Portfolio.currentCapital`. Le frontend (`deriv/page.tsx`), le proxy NestJS (`engine-proxy.controller.ts`) et l'engine (`deriv.py`) formaient une chaîne complète exposée en production.
- **Fix**: Bloc d'exécution live commenté dans `deriv.py::scalp_v75()`. Le endpoint retourne toujours `PAPER` avec un message explicite. Pour réactiver : intégrer le risk system complet avant toute exécution.

**#59 `_stress_index` — seuil ATR% absolu 3% au lieu de percentile relatif**
- **Status**: Fixed
- **Priority**: 🟡 Moyenne
- **Description**: `market_concept_layer.py::_stress_index` utilisait `vol_stress = min(1.0, atr_pct / 3.0)` avec un seuil absolu de 3%, réintroduisant le problème que `regime.py::detect_regime` avait explicitement corrigé avec `atr_percentile` (percentile relatif à l'historique propre de l'actif). Conséquence : Forex (ATR% ~0.1-0.5%) toujours sous-détecté, Synthetic (ATR% naturellement élevé) toujours sur-détecté. Embeddings cross-asset faussés.
- **Fix**: Remplacé par `atr_percentile = regime.get("atr_percentile", 0.5)` (déjà calculé et disponible dans le dict `regime`).

**#60 `geometry/core.py::filter_significant` — close.std() global au lieu de local**
- **Status**: Fixed
- **Priority**: 🟡 Moyenne
- **Description**: Même bug que #55 corrigé dans `harmonic.py` : `close.std()` calculé sur toute la série au lieu d'une fenêtre glissante. `geometry.py` est un scaffold non branché (aucun module de pattern detection ne l'importe activement), mais le bug aurait ressurgi lors d'une future migration.
- **Fix**: Remplacé par `close.rolling(14).std().iloc[p.idx]`.

**#61 `llm_health()` — healthcheck ment sur l'état d'Ollama**
- **Status**: Fixed
- **Priority**: 🟡 Moyenne
- **Description**: `_effective_provider()` retournait toujours `"ollama"` car `OLLAMA_BASE_URL` a une valeur par défaut non-vide (`http://localhost:11434`). Le healthcheck `/llm/health` affichait `"status": "ready"` même sur un serveur sans Ollama. Le fallback mock fonctionnait correctement à l'appel réel, mais le monitoring était trompeur.
- **Fix**: `llm_health()` est maintenant `async` et fait un vrai ping `GET /api/tags` vers Ollama avec timeout 3s. Si pas de réponse → `provider = "mock"`.

**#62 Mapping Deriv wire-symbol "N" dupliqué en 4 endroits**
- **Status**: Fixed
- **Priority**: 🟡 Moyenne
- **Description**: La traduction `BOOM300→BOOM300N` / `CRASH300→CRASH300N` était hardcodée indépendamment dans `deriv.py`, `ws.py`, `synthetic_engine.py`, et `scan.py`. Quatre sources divergentes qui auraient inévitablement divergé si Deriv renomme un autre symbole.
- **Fix**: Création de `utils/deriv_symbols.py` avec `to_wire_symbol()` comme source unique. Les 4 modules importent maintenant cette fonction au lieu de hardcoder le mapping.

**#63 `_mock_candles` — mutation RNG global NumPy**
- **Status**: Fixed
- **Priority**: 🟢 Basse
- **Description**: `np.random.seed()` mute l'état RNG global, risquant une contamination croisée avec d'autres simulations Monte Carlo du même process (`tick_stats.py`, `synthetic_engine.py`).
- **Fix**: Remplacé par `rng = np.random.default_rng()` (Generator local).


## Addendum 5 — Audit Risk Engine & Signal Pipeline (10 août 2026)

### Bugs fixés

| # | Bug | Fichier(s) | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 64 | Token Grade TypeError masqué par except:pass | `scan.py:2363` | ✅ | 🔴 Haute | `onchain_score=` et `tokenomics_score=` n'existent pas dans `compute_token_grade` → TypeError avalé par `except Exception: pass`. Token grade jamais calculé. Fix: `onchain_bonus=`, `tokenomics_penalty=`, ajout `technical_confidence=`. |
| 65 | Fuite pool DB xgboost_shadow | `xgboost_shadow.py:59` | ✅ | 🔴 Haute | `XGBoostSignalScorer()` instancié à chaque appel → nouveau pool asyncpg jamais fermé. Fix: utilise le singleton `xgboost_scorer` + `_ensure_state()`. |
| 66 | confluence.py sr= jamais passé | `scan.py:1875` | ✅ | 🔴 Haute | `score_pattern_confluence(p, pa, smc, mtf_context=..., regime=...)` — `sr` calculé ligne 1263 mais jamais passé. Critère S/R proximity (5% du score) inactif. Fix: `sr=sr` ajouté. |
| 67 | AI Defense liquidity=0 faux positifs | `scan.py:2289` | ✅ | 🔴 Haute | `liquidity=0` en dur → `vol_liq_ratio` explose → faux positif "high severity" quasi systématique. Fix: `liquidity=_liquidity if _liquidity else 0`. |
| 68 | BRVM mislabeling (heuristique fragile) | `signals.service.ts:462` | ✅ | 🔴 Haute | `!r.symbol.includes('/')` matchait V75, BOOM1000 (synthetic sans slash) comme BRVM → signaux silencieusement supprimés. Fix: `asset.market?.name === 'BRVM'`. |
| 69 | compute_calmar annualisation par trade count | `scientific_backtest.py:52` | ✅ | 🟡 Moyenne | `n_periods = len(equity)` (= nombre de trades) → annualisation `(1+r)^(252/n_trades)` fausse pour fréquence ≠ 1 trade/jour. Fix: ratio brut `total_return / max_dd`. |
| 70 | scan_multi Phase 0++ non persisté | `scan.py:2789-2870` | ✅ | 🔴 Haute | `scan_multi` appelait `analyze_candles` sans `news_context`, `gold_dxy`, `market_cap_tier`, `liquidity_data`, `red_flags_data`, `fear_greed_value`. Garde-fous (anti-scam, news macro, risk level, DCA) inactifs sur le chemin persisté. Fix: bloc `1c-quinquies` de pré-fetch batch + passage dans les lambdas. |
| 71 | RegimeFilter stratégies ne matchent jamais | `regime_filter.py:117` | ✅ | 🟡 Moyenne | `"ema_trend_+_rsi"`, `"macd_momentum"` etc. ne matchent aucune clé de `DEFAULT_COMPATIBILITY` → toujours fallback `default` (0.5). Fix: `_STRATEGY_CATEGORY_MAP` normalise les slugs réels vers les catégories. |
| 72 | SignalLog race condition cross-stratégie | `signals.service.ts:601` | ✅ | 🟡 Moyenne | `updateMany` matche sur `(symbol, timeframe, signalType, createdAt<60s)` sans `strategyId` → 2 stratégies BUY même symbole+TF → même `signal.id`. Fix: `strategyId` ajouté au schéma SignalLog + migration + `where.strategyId`. |
| 73 | DisciplineController capital/P&L jamais mis à jour | `risk.py`, `positions.service.ts` | ✅ | 🔴 Haute | `update_capital()` et `record_trade_result()` jamais appelés. KillSwitch, DrawdownManager, CooldownManager, PerformanceMonitor, TailRiskManager tous inactifs. Fix: 4 nouveaux endpoints engine (`/risk/update-capital`, `/risk/record-trade`, `/risk/register-position`, `/risk/record-daily-return`) + bridge NestJS depuis `create()`, `close()`, `closeByWatcher()`. |
| 74 | xgboost_scorer pool non fermé au shutdown | `main.py:91-95` | ✅ | 🟡 Moyenne | Pool asyncpg du singleton `xgboost_scorer` jamais fermé au shutdown. Fix: `close_pool()` ajouté dans le lifespan cleanup. |

### Points ouverts (non traités)

| # | Sujet | Fichier(s) | Statut | Priorité | Description |
|---|---|---|---|---|---|
| 75 | CorrelationManager jamais nourri | `correlation_manager.py`, `scan.py` | ✅ | Haute | `update_price_history()` et `register_position()` jamais appelés depuis `scan.py`. Fix: `update_price_history` appelé dans `scan_multi` (batch sur tous les symboles fetchés) et `fetch_and_analyze` (single-symbol). `register_position`/`unregister_position` déjà bridge via endpoints #73 depuis NestJS. |
| 76 | PositionSizer branche de blocage inatteignable | `position_sizer.py` | ✅ | Moyenne | `effective_risk_pct = min(max(..., min_risk_pct), max_risk_pct)` appliquait le plancher 0.2% avant le test `<= 0` → code mort. Fix: test `below floor` déplacé avant le clamp. Un signal réduit sous 0.2% par les facteurs (vol/score/dd/corr) est maintenant bloqué au lieu de trader au plancher. |
| 77 | Patterns v2 non branché | `patterns/chart_scoring.py`, `patterns/detector.py` | ✅ | Moyenne | `_BASE_SCORES` utilisait des noms fictifs (`hs_breakdown`, `bull_flag_breakout`, `triangle_breakout`) ne matchant pas les producteurs (`head_and_shoulders`, `flag`, `symmetrical_triangle`). Fix: `_BASE_SCORES` aligné avec les noms réels. `detect_all()` étendu avec `detect_flag`, `detect_pennant`, `detect_all_compression`. `harmonic_v2.py` laissé de côté (structure différente, migration séparée). |
| 78 | self_learning_feedback_loop / market_memory non branchés | `ml/feedback_loop.py`, `ml/market_memory.py` | ✅ | Basse | **Faux positif** — `market_memory` et `feedback_loop` sont utilisés par `routers/phase_d.py` qui est inclus dans `main.py` (ligne 186). Modules bien branchés via Phase D. |
| 79 | multi_agent.py — AlphaAgent token_grade bug | `ml/multi_agent.py:237` | ✅ | Basse | `AlphaAgent` lisait `token_grade.get("overall_grade", 0)` mais `TokenGrade` est une dataclass avec champ `.grade` (pas un dict, pas `overall_grade`). Fix: `getattr(token_grade, "grade", 0)`. |
| 80 | Prolifération pools DB indépendants | `utils/db_pool.py`, `xgboost_scorer.py`, `signal_scorer.py`, `rag.py`, `llm.py` | ✅ | Moyenne | 4 pools asyncpg indépendants (min 4, max 14 connexions). Fix: `utils/db_pool.py` créé avec singleton `get_shared_pool()` (min_size=2, max_size=10). Les 4 modules migrés vers le pool partagé. `close_shared_pool()` appelé au shutdown dans `main.py`. |

