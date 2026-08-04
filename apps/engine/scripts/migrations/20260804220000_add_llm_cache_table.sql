-- Cache des réponses LLM pour les endpoints /llm/explain et /llm/review-position
-- sur données figées (signaux passés, positions clôturées).
-- Géré par l'engine Python via asyncpg (pas Prisma).

CREATE TABLE IF NOT EXISTS llm_cache (
    cache_key  TEXT PRIMARY KEY,
    endpoint   TEXT NOT NULL,
    response   JSONB NOT NULL,
    provider   TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index secondaire pour debug / purge par endpoint
CREATE INDEX IF NOT EXISTS idx_llm_cache_endpoint ON llm_cache (endpoint);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created  ON llm_cache (created_at);
