"""
RAG Router — Retrieval-Augmented Generation
Embeddings via fastembed (ONNX, 384-dim) + pgvector + LLM
Permet à l'assistant IA de répondre à des questions sur le trading
en s'appuyant sur des documents contextuels indexés.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
import hashlib

router = APIRouter()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://trading_user:trading_pass@localhost:5433/trading_os"
)

# Lazy init des ressources lourdes
_embed_model = None
_db_pool     = None


def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        from fastembed import TextEmbedding
        _embed_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _embed_model


async def _get_pool():
    global _db_pool
    if _db_pool is None:
        import asyncpg
        # Convertir URL psycopg2 → asyncpg
        url = DATABASE_URL.replace("postgresql://", "postgresql://").replace("postgres://", "postgresql://")
        _db_pool = await asyncpg.create_pool(url, min_size=1, max_size=5)
    return _db_pool


def _embed(text: str) -> list:
    model = _get_embed_model()
    vecs  = list(model.embed([text]))
    return vecs[0].tolist()


# ── Modèles ──────────────────────────────────────────────────
class DocumentIn(BaseModel):
    title:    str
    content:  str
    category: str = "general"
    metadata: dict = {}


class QueryIn(BaseModel):
    question:  str
    top_k:     int = 5
    category:  Optional[str] = None
    generate:  bool = True            # False = recherche seule, True = LLM answer


class DocumentOut(BaseModel):
    id:       int
    title:    str
    content:  str
    category: str
    score:    float


# ── Base de connaissances par défaut ──────────────────────────
SEED_DOCUMENTS = [
    {
        "category": "indicateurs",
        "title": "EMA — Exponential Moving Average",
        "content": "L'EMA (Exponential Moving Average) donne plus de poids aux prix récents. EMA20 < EMA50 = tendance baissière. EMA20 > EMA50 = tendance haussière. Un croisement EMA8/EMA21 (golden cross) est un signal d'achat fort. Les EMA servent de support/résistance dynamiques.",
    },
    {
        "category": "indicateurs",
        "title": "RSI — Relative Strength Index",
        "content": "Le RSI mesure la force relative des mouvements de prix sur 14 périodes (par défaut). RSI > 70 = survente (SELL), RSI < 30 = surachat (BUY). Entre 30 et 70 = zone neutre. Le RSI divergence (prix monte, RSI baisse) est un signal de retournement fort.",
    },
    {
        "category": "indicateurs",
        "title": "MACD — Moving Average Convergence Divergence",
        "content": "Le MACD = EMA12 - EMA26. Signal = EMA9 du MACD. Histogramme = MACD - Signal. Croisement MACD au-dessus du Signal = BUY. Croisement en-dessous = SELL. Histogramme positif croissant = momentum haussier. Divergence = signal de retournement.",
    },
    {
        "category": "indicateurs",
        "title": "Bollinger Bands",
        "content": "Bollinger Bands = SMA20 ± 2 écarts-types. Prix touche la bande supérieure = surachat potentiel. Prix touche la bande inférieure = survente potentielle. Squeeze (bandes qui se resserrent) = volatilité à venir. Breakout des bandes = signal fort de continuation.",
    },
    {
        "category": "smc",
        "title": "FVG — Fair Value Gap",
        "content": "Le Fair Value Gap (FVG) est un déséquilibre de prix visible sur une bougie avec un gap entre la mèche haute de la bougie N-2 et la mèche basse de la bougie N. Les FVG haussiers sont des zones de support potentielles. Les FVG baissiers sont des zones de résistance. Le prix revient souvent combler ces gaps.",
    },
    {
        "category": "smc",
        "title": "Order Block (OB)",
        "content": "Un Order Block est la dernière bougie baissière avant un fort mouvement haussier (bullish OB) ou la dernière bougie haussière avant un fort mouvement baissier (bearish OB). Ces zones représentent des accumulations institutionnelles. Le prix revient souvent tester ces zones pour une réaction.",
    },
    {
        "category": "smc",
        "title": "BOS et CHoCH — Structure de marché",
        "content": "BOS (Break of Structure) = rupture dans la direction de la tendance, confirmation de continuation. CHoCH (Change of Character) = première rupture contre la tendance, signal potentiel de retournement. Identifier la structure (Higher Highs/Higher Lows vs Lower Highs/Lower Lows) est la base de l'analyse SMC.",
    },
    {
        "category": "risk",
        "title": "Risk Management — Position Sizing",
        "content": "Règle des 1-2% : ne jamais risquer plus de 1-2% du capital par trade. Taille position = (Capital × Risk%) / (Entry - Stop Loss). Le ratio Risk/Reward doit être minimum 1:2, idéalement 1:3. En paper trading, simuler avec des tailles réalistes pour développer la discipline.",
    },
    {
        "category": "risk",
        "title": "Stop Loss et Take Profit",
        "content": "Le Stop Loss protège le capital. Placer le SL sous un support récent (BUY) ou au-dessus d'une résistance récente (SELL). Le Take Profit peut être placé au prochain niveau de résistance/support, ou utiliser un ratio R/R fixe (2R, 3R). Un trailing stop permet de sécuriser les gains.",
    },
    {
        "category": "brvm",
        "title": "BRVM — Bourse Régionale des Valeurs Mobilières",
        "content": "La BRVM est la bourse de l'UEMOA (8 pays d'Afrique de l'Ouest). Les cotations sont en XOF (Franc CFA). Les titres les plus liquides sont ONTBF, SGBF, BOABF, ETIT, SIVC, PALC. La séance se tient du lundi au vendredi. Les signaux momentum basés sur la variation quotidienne et le volume sont efficaces sur ce marché.",
    },
    {
        "category": "deriv",
        "title": "Volatility 75 Index (V75) — Stratégie Scalp",
        "content": "Le V75 (R_75) est un indice synthétique Deriv simulant 75% de volatilité annualisée. Stratégie scalp 1 minute : EMA8/EMA21 crossover + RSI 14 + Bollinger Bands. Signal CALL si EMA8 > EMA21 + RSI < 50 en hausse + prix sur BB Lower. Signal PUT si EMA8 < EMA21 + RSI > 50 en baisse + prix sur BB Upper. Durée recommandée : 1-5 minutes.",
    },
    {
        "category": "trading",
        "title": "Paper Trading — Trading en Simulation",
        "content": "Le paper trading permet de tester des stratégies sans risquer de capital réel. Dans Trading OS, ouvrir une position paper depuis un signal, définir un Stop Loss et Take Profit, puis surveiller automatiquement via le Watcher. Les résultats sont enregistrés dans le journal pour analyse.",
    },
    {
        "category": "trading",
        "title": "Backtest — Validation de Stratégie",
        "content": "Le backtest simule une stratégie sur des données historiques. Métriques clés : Win Rate (% trades gagnants), Profit Factor (total gains / total pertes), Max Drawdown (perte maximale consécutive), Sharpe Ratio. Un Win Rate > 55% avec R/R 1:2 est rentable sur le long terme.",
    },
]


async def _seed_if_empty():
    """Insère les documents de base si la table est vide."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM rag_documents")
        if count == 0:
            model = _get_embed_model()
            for doc in SEED_DOCUMENTS:
                emb = list(model.embed([doc["content"]]))[0].tolist()
                emb_str = "[" + ",".join(str(x) for x in emb) + "]"
                await conn.execute(
                    """INSERT INTO rag_documents (category, title, content, embedding)
                       VALUES ($1, $2, $3, $4::vector)""",
                    doc["category"], doc["title"], doc["content"], emb_str
                )


# ── Endpoints ─────────────────────────────────────────────────
@router.get("/rag/health")
async def rag_health():
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM rag_documents")
        return {"status": "ok", "documents": count, "embedding_model": "BAAI/bge-small-en-v1.5", "dim": 384}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/rag/seed")
async def seed_documents():
    """Initialise la base de connaissances avec les documents par défaut."""
    try:
        pool = await _get_pool()
        model = _get_embed_model()
        inserted = 0
        async with pool.acquire() as conn:
            for doc in SEED_DOCUMENTS:
                emb     = list(model.embed([doc["content"]]))[0].tolist()
                emb_str = "[" + ",".join(str(x) for x in emb) + "]"
                await conn.execute(
                    """INSERT INTO rag_documents (category, title, content, embedding)
                       VALUES ($1, $2, $3, $4::vector)
                       ON CONFLICT DO NOTHING""",
                    doc["category"], doc["title"], doc["content"], emb_str
                )
                inserted += 1
        return {"inserted": inserted, "total": len(SEED_DOCUMENTS)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/rag/documents")
async def add_document(doc: DocumentIn):
    """Ajoute un document à la base de connaissances."""
    try:
        emb     = _embed(doc.content)
        emb_str = "[" + ",".join(str(x) for x in emb) + "]"
        pool    = await _get_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO rag_documents (category, title, content, embedding, metadata)
                   VALUES ($1, $2, $3, $4::vector, $5)
                   RETURNING id, created_at""",
                doc.category, doc.title, doc.content, emb_str,
                doc.metadata or {}
            )
        return {"id": row["id"], "title": doc.title, "created_at": str(row["created_at"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/rag/query")
async def query_rag(req: QueryIn):
    """
    Recherche sémantique + génération LLM (RAG).
    1. Embed la question
    2. Recherche les top_k documents les plus proches (cosine)
    3. Construit un prompt avec le contexte
    4. Appelle le LLM pour générer une réponse contextualisée
    """
    try:
        # 1. Embedding de la question
        q_emb     = _embed(req.question)
        q_emb_str = "[" + ",".join(str(x) for x in q_emb) + "]"

        # 2. Recherche vectorielle
        pool = await _get_pool()
        async with pool.acquire() as conn:
            # S'assurer que des docs existent
            count = await conn.fetchval("SELECT COUNT(*) FROM rag_documents")
            if count == 0:
                await _seed_if_empty()

            where   = "WHERE category = $3" if req.category else ""
            params  = [q_emb_str, req.top_k]
            if req.category:
                params.append(req.category)

            rows = await conn.fetch(
                f"""SELECT id, title, content, category,
                           1 - (embedding <=> $1::vector) AS score
                    FROM rag_documents
                    {where}
                    ORDER BY embedding <=> $1::vector
                    LIMIT $2""",
                *params
            )

        docs = [
            {"id": r["id"], "title": r["title"], "content": r["content"],
             "category": r["category"], "score": round(float(r["score"]), 4)}
            for r in rows
        ]

        if not req.generate:
            return {"question": req.question, "documents": docs, "answer": None}

        # 3. Vérifier le cache de réponses
        q_hash = hashlib.sha256(req.question.encode("utf-8")).hexdigest()
        async with pool.acquire() as conn:
            cached = await conn.fetchrow(
                "SELECT answer, provider, model FROM rag_cache WHERE question_hash = $1", q_hash
            )

        if cached:
            return {
                "question":  req.question,
                "answer":    cached["answer"],
                "documents": docs,
                "model":     cached["model"],
                "provider":  cached["provider"],
                "retrieved": len(docs),
                "cached":    True,
            }

        # 4. Construire le contexte
        context = "\n\n".join(
            f"[{d['category'].upper()}] {d['title']}\n{d['content']}"
            for d in docs
        )

        prompt = f"""Tu es un assistant expert en trading et marchés financiers.
Réponds à la question en te basant UNIQUEMENT sur le contexte fourni.
Si la réponse n'est pas dans le contexte, dis-le clairement.
Réponds en français, de façon concise et précise.

=== CONTEXTE ===
{context}

=== QUESTION ===
{req.question}

=== RÉPONSE ==="""

        # 5. Appeler le LLM avec fallback local : Ollama -> OpenAI -> mock
        from routers.llm import _call_llm_with_fallback
        answer, provider_used, model_used = await _call_llm_with_fallback(prompt, max_tokens=500)

        # 6. Sauvegarder la réponse dans le cache
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO rag_cache (question_hash, question, answer, provider, model)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (question_hash) DO UPDATE SET
                     answer = EXCLUDED.answer,
                     provider = EXCLUDED.provider,
                     model = EXCLUDED.model,
                     created_at = now()""",
                q_hash, req.question, answer, provider_used, model_used,
            )

        return {
            "question":  req.question,
            "answer":    answer,
            "documents": docs,
            "model":     model_used,
            "provider":  provider_used,
            "retrieved": len(docs),
            "cached":    False,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/rag/documents")
async def list_documents(category: Optional[str] = None, limit: int = 50):
    """Liste les documents indexés."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn:
            if category:
                rows = await conn.fetch(
                    "SELECT id, title, category, created_at FROM rag_documents WHERE category=$1 ORDER BY id LIMIT $2",
                    category, limit
                )
            else:
                rows = await conn.fetch(
                    "SELECT id, title, category, created_at FROM rag_documents ORDER BY id LIMIT $1",
                    limit
                )
        return {
            "documents": [dict(r) for r in rows],
            "count":     len(rows),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/rag/documents/{doc_id}")
async def delete_document(doc_id: int):
    pool = await _get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM rag_documents WHERE id=$1", doc_id)
    return {"deleted": doc_id}
