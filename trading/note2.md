Je pense que ton objectif ne devrait pas être de créer "une application de trading" en 30 jours.

Ton objectif devrait être :

> **Construire le premier noyau d'un AI Investment OS**, suffisamment solide pour que tu puisses l'utiliser toi-même tous les jours.

L'approche que je te propose est celle d'un **MVP utilisable**, pas d'une démo.

---

# Objectif du MVP (30 jours)

À la fin des 30 jours, tu dois pouvoir :

* créer un compte ;
* connecter un portefeuille (manuel au début) ;
* scanner automatiquement les actifs (BRVM si les données sont disponibles, sinon un autre marché pour démarrer) ;
* appliquer une stratégie TKL codée en règles ;
* recevoir des signaux ;
* visualiser ton portefeuille ;
* effectuer du **paper trading** (pas d'argent réel) ;
* consulter un journal de décisions.

Aucune exécution automatique au départ.

---

# Stack technique

## Frontend

* **Next.js**
* TypeScript
* Tailwind CSS
* TanStack Query
* Zustand
* TradingView Lightweight Charts

---

## Backend

* **NestJS**
* TypeScript
* PostgreSQL
* Prisma ORM
* Redis
* BullMQ (jobs)
* JWT

---

## IA

* GPT uniquement pour :

  * expliquer les signaux ;
  * résumer les actualités ;
  * commenter les performances.

---

# Semaine 1 — Fondation

## Jour 1

Créer le monorepo.

```text
apps/

    web/

    api/

packages/

    shared/

    indicators/

    strategy-engine/

    ui/

```

---

## Jour 2

Mettre en place :

* Auth
* PostgreSQL
* Prisma
* JWT

Tables :

* User
* Portfolio
* Asset
* Position

---

## Jour 3

Dashboard vide.

Menu :

```
Dashboard

Scanner

Portfolio

Trades

Settings
```

---

## Jour 4

Créer le modèle Strategy.

Exemple :

```
Nom

Marché

Timeframe

Etat

Règles
```

---

## Jour 5

Créer le moteur d'indicateurs.

Premier objectif :

* EMA
* RSI

Pas plus.

---

## Jour 6

Créer le Scanner.

Pour chaque actif :

```
Télécharger données

↓

Calcul EMA

↓

Calcul RSI

↓

Créer résultat
```

---

## Jour 7

Premier résultat.

Par exemple :

```
SONATEL

EMA20 > EMA50

RSI = 35

Etat :

A surveiller
```

Premier succès.

---

# Semaine 2 — Strategy Engine

C'est le cœur du projet.

Créer une classe :

```ts
class StrategyEngine {

 evaluate()

}
```

---

Créer les règles.

Exemple :

```
IF

Trend == Bullish

AND

RSI < 35

THEN

BUY
```

---

Créer le moteur logique.

Il doit comprendre :

AND

OR

NOT

---

Créer un score.

Exemple :

```
Signal

BUY

Confiance

84%
```

---

À la fin de la semaine :

Le scanner produit des signaux.

---

# Semaine 3 — Portfolio

Créer :

Portfolio

↓

Cash

↓

Positions

↓

Historique

---

Calcul automatique :

Valeur totale

↓

PnL

↓

Drawdown

↓

Allocation

---

Créer le Paper Trading.

Quand l'utilisateur clique :

"Acheter"

Le système crée simplement une position.

Aucun broker.

---

Créer le Journal.

Chaque décision est enregistrée.

---

# Semaine 4 — IA

Maintenant seulement.

Créer :

Investment Assistant.

L'utilisateur clique sur un signal.

L'IA explique.

Exemple :

```
Pourquoi ce signal ?

↓

Résumé

↓

Forces

↓

Faiblesses

↓

Risque

↓

Conclusion
```

---

Créer un résumé quotidien.

Le matin :

```
12 actifs analysés

3 opportunités

1 signal fort

Risque moyen

Faible
```

---

Créer une page Performance.

L'IA répond :

```
Tu prends trop de risques.

Tu trades le mardi moins efficacement.

Les setups RSI fonctionnent mieux que les cassures.
```

---

# Architecture des dossiers

```
apps

    api

    web

packages

    indicators

        ema

        rsi

        atr

        macd

    strategy-engine

    risk-engine

    market

    portfolio

    ai

    shared

```

---

# Ce qu'il NE FAUT PAS développer

Pendant ces 30 jours, n'ajoute pas :

* ❌ exécution automatique
* ❌ paiement
* ❌ abonnements
* ❌ application mobile
* ❌ réseau social
* ❌ multi-utilisateur avancé
* ❌ marketplace de stratégies
* ❌ copy trading
* ❌ IA qui invente des stratégies

Ces fonctionnalités viendront plus tard.

---

# Livrable au 30ᵉ jour

Tu disposes d'une application capable de :

* scanner automatiquement un univers d'actifs ;
* appliquer une stratégie codifiée (TKL ou autre) ;
* générer des signaux avec un niveau de confiance ;
* simuler des investissements ;
* suivre les performances d'un portefeuille ;
* expliquer chaque décision grâce à l'IA.

---

## Si j'étais le CTO de ce projet

Je prévoirais dès le départ une architecture qui permette d'évoluer vers une plateforme beaucoup plus ambitieuse. Le MVP serait organisé autour de quatre moteurs indépendants :

1. **Market Engine** : collecte et normalisation des données de marché.
2. **Strategy Engine** : exécution des règles de trading/investissement (TKL aujourd'hui, d'autres demain).
3. **Risk Engine** : gestion du risque, dimensionnement des positions et contrôle des limites.
4. **AI Engine** : explications, synthèses, assistance et, à terme, optimisation.

Cette séparation te permettra d'ajouter plus tard de nouvelles stratégies, d'autres marchés (comme la BRVM, les actions américaines ou les cryptoactifs) et même plusieurs agents spécialisés, sans devoir réécrire le cœur de l'application. C'est une base beaucoup plus pérenne pour un futur SaaS.
