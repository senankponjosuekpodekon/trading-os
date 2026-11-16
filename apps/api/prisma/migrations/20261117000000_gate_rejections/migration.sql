-- Journal structuré des rejets du pipeline de signaux.
-- Aujourd'hui les rejets sont neutralisés (signal → NEUTRAL) et perdus :
-- impossible de mesurer où les SELL disparaissent (4.4:1 → 24:1 → 105:1)
-- ni quelle couche du gate filtre quoi. Chaque rejet garde direction,
-- couche responsable et raison.
CREATE TABLE IF NOT EXISTS gate_rejections (
  id            TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  direction     TEXT NOT NULL,           -- BUY / SELL avant neutralisation
  layer         TEXT NOT NULL,           -- liquidity | red_flags | quality_gate:* | ...
  reason        TEXT NOT NULL,
  asset_type    TEXT,
  strategy_id   TEXT,
  strategy_name TEXT,
  entry_price   DOUBLE PRECISION,
  quality_score INTEGER,
  metadata      JSONB,
  rejected_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gate_rejections_symbol ON gate_rejections (symbol, rejected_at);
CREATE INDEX IF NOT EXISTS idx_gate_rejections_dir    ON gate_rejections (direction, layer, rejected_at);
CREATE INDEX IF NOT EXISTS idx_gate_rejections_time   ON gate_rejections (rejected_at);
