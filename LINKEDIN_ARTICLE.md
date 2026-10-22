# Article LinkedIn — Trading OS

🚀 **J'ai construit un système d'exploitation d'investissement assisté par IA — voici ce que j'ai appris**

Après des mois de développement, je partage aujourd'hui **Trading OS** : une plateforme complète d'analyse et de trading assistée par intelligence artificielle.

**Le problème** : les traders particuliers jonglent entre 10 outils — screener technique, backtest, journal, alertes, sentiment de marché — sans jamais avoir une vue unifiée. Et sur les marchés africains comme la BRVM, ces outils n'existent tout simplement pas.

**La solution** : un monorepo de ~120 000 lignes de code articulé autour de 3 services :

🔹 **Frontend Next.js 15** — dashboards temps réel, graphiques avec marqueurs de signaux, assistant IA conversationnel (RAG + pgvector)

🔹 **API NestJS** — 326 endpoints, authentification JWT + 2FA, Row-Level Security PostgreSQL, chiffrement des clés d'exchanges, notifications SSE/WebSocket

🔹 **Moteur Python FastAPI** — le cerveau : 77 modules couvrant scan technique multi-actifs (EMA/RSI/MACD/SMC), backtesting, 20 modules de ML (XGBoost, FinBERT pour le sentiment, classification de régimes de marché), 17 détecteurs de patterns (harmoniques, orderflow, liquidité), et un moteur de risque complet (kill switch, tail risk, corrélation)

**Ce qui le distingue** :

✅ Couverture de la **BRVM** (Bourse Régionale des Valeurs Mobilières) — quasiment aucun outil moderne ne couvre ce marché

✅ Indices synthétiques **Deriv** (Boom/Crash/Volatility)

✅ LLM local possible via **Ollama** — zéro coût d'API

✅ Paper trading + journal automatique + alertes prix

**Les leçons clés** :

→ La discipline de tracking paie : 57 bugs documentés et corrigés méthodiquement

→ La sécurité n'est pas optionnelle : RLS, chiffrement, rate-limiting par utilisateur dès le départ

→ L'IA explique, ne décide pas : chaque signal vient avec un raisonnement lisible par l'humain

La stack : NestJS · FastAPI · Next.js 15 · PostgreSQL + pgvector · Redis · Docker · Turborepo

Prochaine étape : portage des tests au-delà de 80% de couverture et ouverture d'un accès early-alpha.

Curieux d'échanger sur l'architecture, le ML appliqué au trading, ou les marchés africains ? Mes DM sont ouverts. 👇

#BuildInPublic #AI #FinTech #Trading #MachineLearning #BRVM #NextJS #Python
