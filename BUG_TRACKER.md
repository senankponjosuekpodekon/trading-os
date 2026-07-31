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
