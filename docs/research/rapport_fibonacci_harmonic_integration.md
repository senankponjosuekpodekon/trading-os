# Rapport d’analyse — Fibonacci, Harmonic Patterns & Architecture trading-os

**Date** : 16/07/2026  
**Fichiers analysés** : `lang.md`, `searc.md`, `Harmonic Patterns_ Complete Trading Guide (2026) _ Quantum Algo.html`, `Harmonic Patterns_ Gartley, Bat, Butterfly & Crab Explained.html`, `Fibonacci Extensions_ How to Set Profit Targets Like a Pro _ Audacity Capital.html`, `Fibonacci Retracements_ Complete 2026 Guide.html`, `Fibonacci Tools - TakeProfit.html`, `What are Harmonic Patterns & How to Trade Them_ _ Axi.html`.

---

## 1. Synthèse des concepts clés

### 1.1 Fibonacci : un langage de description, pas une prédiction

- Les niveaux de **retracement** (23.6 %, 38.2 %, 50 %, 61.8 %, 78.6 %) servent à identifier des zones d’entrée et de correction.
- Les **extensions** (127.2 %, 161.8 %, 200 %, 261.8 %) projettent des objectifs après un retracement.
- Le marché ne “respecte” pas Fibonacci ; c’est un outil de structuration du risque et de description de comportements fractals fréquents.

### 1.2 Harmonic Patterns : des contraintes géométriques précises

Un pattern harmonique = une structure **XABCD** (ou ABCD pour le plus simple) dont les jambes doivent respecter des ratios Fibonacci.

| Pattern | Caractéristique principale | Point d’entrée D |
|---|---|---|
| **ABCD** | 4 points, CD ≈ AB | D |
| **Gartley** | D à 78.6 % de XA, B à 61.8 % | Retracement modéré |
| **Bat** | D à 88.6 % de XA, B à 38.2–50 % | Stop serré, bon R/R |
| **Butterfly** | D au-delà de X (127.2–161.8 %) | Contre-intuitif, nécessite confirmation HTF |
| **Crab** | D à 161.8 % de XA, CD très étendu | PRZ étroit mais risqué |
| **Deep Crab** | Similar au Crab, B plus profond | Rareté |
| **Shark** | 5 points O-X-A-B-C, C = reversal | Rapide |
| **5-0** | Suit souvent le Shark | Flattened W/M |

**Règles communes** :
- Entrée au point D, dans la **PRZ (Potential Reversal Zone)**.
- SL au-delà du point d’invalidation (souvent X ou D).
- TP sur retracements/extensions de CD (38.2 %, 61.8 %, 100 %).
- **Jamais** trade un pattern sans confirmation (rejection candle, BOS/CHoCH, RSI).

### 1.3 Smart Money confluence : le vrai filtre

Les patterns harmoniques gagnent en fiabilité quand ils coïncident avec :
- **Order Block (OB)** institutionnel
- **Liquidity sweep** au-delà d’un swing précédent
- **Fair Value Gap (FVG)**
- **BOS / CHoCH** en confirmation
- Contexte HTF (tendance, demand/supply zone)

Un pattern sans confluence est un simple dessin.

---

## 2. Gestion du risque : le SL “évolutif”

### 2.1 Peut-on avoir plusieurs SL ?

**Oui**, sous forme d’un **stop actif qui change de niveau** au fur et à mesure que le trade progresse.

| Étape | Niveau de stop | Déclencheur |
|---|---|---|
| 1. SL initial | Au-delà de l’invalidation structurelle (X, D, EQL, dernier swing) | Ouverture position |
| 2. Break-Even (BE) | Prix d’entrée | TP1 atteint |
| 3. Stop structurel | Sous le dernier Higher Low (BUY) ou au-dessus du Lower High (SELL) | TP2 atteint |
| 4. Trailing dynamique | Suivi du prix selon ATR, chandelier, swing, EMA | TP3+ atteint |

### 2.2 Pourquoi c’est utile

- **Protection du capital** : le trade ne devient jamais perdant une fois TP1 touché.
- **Verrouillage des profits** : chaque objectif atteint libère une partie du risque.
- **Alignement avec la structure** : on ne place pas le SL “20 pips plus bas” mais là où l’idée devient fausse.

### 2.3 Ce qu’il faut éviter

- Placer le SL au milieu de la PRZ (les wicks y passent souvent).
- Tight stop excessif (arrêté par le bruit).
- Changer de SL sans règle (émotion).

---

## 3. Ce que ces concepts apportent à trading-os

### 3.1 Utilité immédiate

| Domaine | Apport |
|---|---|
| **Risk Engine** | SL structuré, BE après TP1, trailing structurel, sizing fixe. |
| **Signal Engine** | Détection de patterns + scoring de confluence (pas un signal brut). |
| **Probability Engine** | Probabilité conditionnelle : P(reversal \| pattern + OB + sweep + HTF). |
| **Journal / Backtesting** | Outcome par pattern : quel pattern, quel timeframe, quel contexte gagne. |
| **UI SignalCard** | Affichage PRZ, niveaux Fibonacci, confluence, SL/TP étagés. |

### 3.2 Utilité moyen / long terme

- **Geometry Engine** : détecter automatiquement toutes les structures XABCD et plus.
- **Market Graph** : représenter le marché comme un graphe de pivots/arêtes pour du ML (GNN).
- **Rust / PyO3** : accélérer les calculs de patterns sur des gros volumes de candles.

---

## 4. Architecture proposée

### 4.1 Pattern Engine v0 (court terme)

```
apps/engine/patterns/
├── pattern.py          # classe de base MarketPattern
├── double_top.py       # DoubleTop / DoubleBottom
├── head_shoulders.py   # Head & Shoulders
├── harmonic.py         # ABCD, Gartley, Bat (ratios simples)
└── detector.py         # coordonne la détection sur une série de pivots
```

Chaque pattern retourne :

```python
{
  "name": "bat_bullish",
  "category": "reversal",
  "direction": "BUY",
  "confidence": 0.72,
  "points": {"X": ..., "A": ..., "B": ..., "C": ..., "D": ...},
  "prz": {"min": ..., "max": ...},
  "entry": ...,      # zone d’entrée
  "stop_loss": ...,   # invalidation
  "targets": [tp1, tp2, tp3],
  "confluence": ["order_block", "liquidity_sweep"],
}
```

### 4.2 Staged Stop Engine (court terme)

```python
# apps/engine/routers/risk.py
class StagedStop:
    initial: float
    break_even: float
    structure: float | None
    trailing: float | None

    def active_stop(self, reached_tps: list[int]) -> float:
        ...
```

Règles :
- Si TP1 atteint → `active_stop = max(initial, break_even)` selon direction.
- Si TP2 atteint → `active_stop = max(active_stop, structure)`.
- Sinon trailing continue de calculer un niveau.

### 4.3 Intégration dans le signal (court terme)

`scan.py` enrichit `metadata` :

```json
{
  "metadata": {
    "detectedPatterns": ["bat_bullish", "double_top"],
    "prz": {"min": 100.0, "max": 101.2},
    "fibTargets": [105.0, 108.5, 112.0],
    "confluenceScore": 0.81
  }
}
```

### 4.4 Market Graph Engine (long terme)

- Nœuds = pivots avec attributs (price, volume, RSI, ATR, strength).
- Arêtes = swings avec durée, amplitude, slope.
- Ratios Fibonacci = poids ou features du graphe.
- GNN pour apprendre la probabilité de reversal au niveau d’un nœud/clique.

### 4.5 Rust / performance (optionnel, plus tard)

- **Court terme** : rester en Python + NumPy/Polars.
- **Si latence critique** : extraire les fonctions “hot path” (détection de pivots, calcul de patterns) en Rust via **PyO3**.
- **Ne pas** réécrire toute la stack NestJS/Python maintenant.

---

## 5. Ce qu’il faut considérer / éviter

### ✅ Considérer

1. **Commencer simple** : ABCD, DoubleTop, DoubleBottom, Head & Shoulders avant les patterns harmoniques complexes.
2. **Tolérances** : les ratios ne tombent jamais exactement. Définir une tolérance (ex. ±2 %).
3. **Confirmation obligatoire** : un pattern détecté = feature, pas ordre d’achat.
4. **Contexte HTF** : un pattern bearish dans une tendance haussière HTF a peu de valeur.
5. **Backtest par pattern** : tracker le win rate, le R/R moyen, la durée moyenne par pattern et actif.
6. **Sizing adapté** : les patterns extension (Butterfly, Crab) demandent un SL plus large → size réduite.

### ❌ Éviter

1. **Ne pas trader tout pattern détecté** : sur-optimisation et faux positifs.
2. **Ne pas ajuster les ratios “à la main”** pour forcer un pattern.
3. **Ne pas mettre le SL au milieu de la PRZ**.
4. **Ne pas promettre la précision** : ce sont des outils probabilistes.
5. **Ne pas intégrer Rust pour le plaisir** : coût d’intégration élevé ; le faire uniquement si un profiler le justifie.

---

## 6. Roadmap d’intégration recommandée

### Phase A — Immédiat (1–2 sessions)

1. **Staged Stop Engine** dans `risk.py`.
   - SL initial / BE / structurel / trailing.
   - Tests unitaires.
2. **Affichage TP1/TP2/TP3 + probabilités** dans SignalCard (déjà en cours).
3. **Pattern Engine minimal** :
   - `MarketPattern` base class.
   - `DoubleTop`, `DoubleBottom`.
   - Intégration `metadata.detectedPatterns`.

### Phase B — Court terme (2–4 sessions)

1. Ajouter **ABCD**, **Gartley**, **Bat**.
2. Scoring de confluence : pattern + OB + liquidity sweep + HTF.
3. Enrichir le journal : logger le pattern déclenché à l’ouverture et le outcome.
4. UI : afficher la PRZ, les niveaux Fibonacci, les patterns détectés.

### Phase C — Moyen terme

1. **Harmonic Patterns avancés** : Butterfly, Crab, Shark, 5-0.
2. **Geometry Engine** : abstraction des structures de marché sous forme de graphe.
3. **ML sur patterns** : prédiction du outcome d’un pattern via features structurels.

### Phase D — Long terme

1. **Market Graph Engine** / GNN.
2. **Rust/PyO3** si le profiling montre un goulot d’étranglement Python.
3. **Hébergement edge/cloud optimisé** si latence globale devient critique.

---

## 7. Exemple concret d’utilisation dans trading-os

### Scénario

- Actif : `BTC/USDT`, timeframe 4H.
- Le moteur détecte un **Bat haussier** dans une zone de demande HTF.
- Un **liquidity sweep** a eu lieu juste sous la PRZ.
- Le RSI est en survente.

### Ce que trading-os ferait

1. `pattern.detector` renvoie `bat_bullish` avec `confidence=0.74`.
2. `confluence.scorer` ajoute +0.15 grâce à l’OB et au sweep → `0.89`.
3. `risk.calculate` calcule :
   - Entry = zone PRZ.
   - SL initial = sous X (invalidation).
   - TP1 = 38.2 % de CD.
   - TP2 = 61.8 % de CD.
   - Position size = 1 % du capital avec SL respecté.
4. Le signal est généré avec `metadata.detectedPatterns` et les niveaux.
5. Watcher :
   - Quand TP1 atteint → active BE.
   - Quand TP2 atteint → déplace le SL sous le dernier HL.
   - Continue trailing pour le reste.
6. Journal enregistre le pattern + outcome pour améliorer le modèle.

---

## 8. Conclusion

Les concepts de Fibonacci, Harmonic Patterns et Smart Money confluence sont **très pertinents** pour trading-os, mais ils doivent être traités comme des **features probabilistes** et des **outils de structuration du risque**, pas comme des signaux magiques.

La meilleure approche est incrémentale :
1. **Risk Engine avancé** (SL étagé) → valeur immédiate.
2. **Pattern Engine simple** (DoubleTop/Bottom, ABCD) → base solide.
3. **Confluence scoring** → fiabiliser les signaux.
4. **Harmonics + Graph ML** → différentiateur à moyen terme.

Le Rust n’est pas prioritaire aujourd’hui ; la qualité des modèles, des tests et de la gestion du risque l’est bien plus.
