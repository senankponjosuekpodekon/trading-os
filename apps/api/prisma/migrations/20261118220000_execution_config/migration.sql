-- Config d'exécution pilotable depuis l'UI : une seule ligne (id='default').
-- Priorité : DB > env. L'engine relit cette table toutes les ~30 s.
CREATE TABLE IF NOT EXISTS execution_config (
    id              TEXT PRIMARY KEY DEFAULT 'default',
    mode            TEXT NOT NULL DEFAULT 'shadow',        -- shadow | paper | live
    live_venues     JSONB NOT NULL DEFAULT '[]',           -- ["FUTURES","MARGIN",...]
    gate_fail_closed BOOLEAN NOT NULL DEFAULT false,
    updated_by      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO execution_config (id) VALUES ('default') ON CONFLICT DO NOTHING;
