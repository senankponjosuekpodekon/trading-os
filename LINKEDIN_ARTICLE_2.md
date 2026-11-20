# Article LinkedIn 2 — Trading OS : quand le système commence à apprendre

🧠 **Mon système de trading ne fait plus qu'exécuter — il apprend de ses propres erreurs**

Il y a quelques mois, je vous présentais **Trading OS**, ma plateforme d'analyse et de trading assistée par IA. Depuis, le projet a franchi un cap que je trouve plus intéressant que les features elles-mêmes : **la boucle d'apprentissage s'est refermée**.

## Le problème que je venais de résoudre sans m'en rendre compte

Mon système enregistrait chaque signal, chaque résolution TP/SL, chaque win rate par pattern. Des milliers de données d'outcomes réels… **qui n'influençaient aucune décision**. Le modèle qui avait tort hier avait les mêmes chances d'avoir tort demain. Le risque alloué à un setup qui perdait était identique à celui d'un setup qui gagnait.

J'avais construit un système qui *documentait* ses erreurs. Pas un système qui en *tirait parti*.

## Ce que j'ai changé — 3 mécanismes d'apprentissage réel

**1. Promotion automatique du meilleur modèle**

Deux modèles tournent en parallèle (régression logistique vs XGBoost) — mais XGBoost ne tournait qu'en « shadow », pour comparaison. Désormais : chaque outcome résolu score les deux modèles, et **si XGBoost bat le logistique de 5 points sur ≥100 résolutions réelles, il est promu automatiquement** — avec hystérésis pour éviter le ping-pong. Le meilleur cerveau gagne, sur preuve, pas sur intuition.

**2. Sizing adaptatif borné**

Le budget de risque de chaque ouverture est désormais multiplié par le track record réel du pattern similaire : win rate >60% → ×1.2, <40% → ×0.5 — **strictement borné [0.5, 1.2]**. L'apprentissage module le risque, il ne le supprime ni ne le double jamais. Moins de 20 trades ? ×1.0 neutre — on n'apprend pas sur du bruit.

**3. Des profils de gestion découverts, pas devinés**

Trois modes de sortie (conservative/balanced/runner) tournent en paper ; le meilleur track record devient le profil appliqué — uniquement après 10+ trades prouvés.

## La leçon de marché la plus instructive : la dominance BTC

En auditant mon propre pipeline, j'ai découvert un gap embarrassant : je *mesurais* la dominance du Bitcoin (57.8% à l'heure où j'écris) pour l'afficher… mais **elle n'influençait aucun score de signal**. Deux signaux identiques — un BUY altcoin en plein risk-off vs le même en altseason — recevaient la même confiance.

La dominance est maintenant intégrée aux 3 étages de décision :

→ **Confiance** : bonus/malus par phase de rotation (BTC→ETH→alts→memecoins), −5 supplémentaire sur les alts quand BTC.D ≥ 60
→ **Sizing** : ×0.5 sur les alts en risk-off, ×1.15 en altseason confirmée
→ **Univers microcap** : les Hidden Gems sont bloqués en entrée dès que le marché passe risk-off — les microcaps s'effondrent en premier, toujours

## La partie la moins spectaculaire, la plus importante

En fouillant, j'ai aussi trouvé un **chemin d'exécution zombie** : un endpoint capable d'envoyer de vrais ordres sur une API legacy, contournant toutes les gardes construites depuis des semaines. Supprimé intégralement.

Et un bug concret : **XRP tradait sans profil instrument** — paramètres par défaut au lieu des specs futures réelles.

Un système qui apprend n'a de valeur que si ce qu'il exécute est correct. L'audit précède l'intelligence.

## Ce que je regarde maintenant

Tout reste **paper-first** : chaque position enregistre la phase macro qui l'a vue naître. Dans quelques semaines, les win rates par phase diront si le raisonnement était bon — ou s'il faut resserrer les règles. Un endpoint admin expose déjà `win_rate par macro_phase`.

La suite n'est pas plus de features : c'est **laisser la machine accumuler la preuve**.

Stack : NestJS · FastAPI · Next.js · PostgreSQL · Redis · XGBoost · Docker — déployé sur un VPS 4 cœurs qui tourne aussi un terminal MT5 sous Wine.

Curieux d'échanger sur le ML appliqué au trading, la discipline du build-in-public, ou pourquoi la dominance BTC est le meilleur filtre de régime gratuit qui existe ? 👇

#BuildInPublic #MachineLearning #Trading #AI #FinTech #Crypto #XGBoost

---

# Post LinkedIn (version courte)

🧠 Mon système de trading ne fait plus qu'exécuter — il apprend de ses erreurs.

Suite de Trading OS, 3 changements cette semaine :

→ **Promotion automatique** : XGBoost défie la régression logistique sur outcomes réels. Il gagne de 5 points sur 100+ trades ? Il prend la prod. Sur preuve, pas sur intuition.

→ **Sizing adaptatif** : le risque d'une position est multiplié par le track record réel du pattern — ×1.2 si ça gagne, ×0.5 si ça perd. Borné, jamais extrême.

→ **La dominance BTC partout** : je mesurais BTC.D pour l'afficher… mais elle n'influençait aucun signal. Deux BUY identiques avaient la même confiance en altseason et en capitulation. Maintenant : confiance modulée par phase de rotation, sizing ×0.5 sur alts en risk-off, entrées microcaps bloquées dès que le marché saigne.

Bonus trouvé en audit : un chemin d'exécution zombie capable d'envoyer de vrais ordres hors de toute garde. Supprimé.

Un système qui documente ses erreurs ≠ un système qui en tire parti. C'est toute la différence.

#BuildInPublic #AI #Trading #MachineLearning #Crypto

