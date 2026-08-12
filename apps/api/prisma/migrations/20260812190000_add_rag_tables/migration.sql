-- RAG tables: rag_documents (pgvector embeddings) + rag_cache (LLM answer cache)

CREATE TABLE IF NOT EXISTS rag_documents (
    id          SERIAL PRIMARY KEY,
    category    VARCHAR(100)   NOT NULL DEFAULT 'general',
    title       VARCHAR(500)   NOT NULL,
    content     TEXT           NOT NULL,
    embedding   vector(384),
    metadata    JSONB          DEFAULT '{}',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_documents_category_idx ON rag_documents(category);

CREATE TABLE IF NOT EXISTS rag_cache (
    id              SERIAL PRIMARY KEY,
    question_hash   VARCHAR(64)  UNIQUE NOT NULL,
    question        TEXT         NOT NULL,
    answer          TEXT         NOT NULL,
    provider        VARCHAR(50),
    model           VARCHAR(100),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
