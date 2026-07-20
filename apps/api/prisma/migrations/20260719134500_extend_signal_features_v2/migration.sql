-- Extend signal_features for Feature Store v2 metadata
ALTER TABLE "signal_features"
  ADD COLUMN IF NOT EXISTS "symbol" TEXT,
  ADD COLUMN IF NOT EXISTS "market" TEXT,
  ADD COLUMN IF NOT EXISTS "timeframe" TEXT,
  ADD COLUMN IF NOT EXISTS "signal_type" "SignalType",
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ml_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "ml_regime" TEXT,
  ADD COLUMN IF NOT EXISTS "expected_move_json" JSONB,
  ADD COLUMN IF NOT EXISTS "snapshot_version" TEXT NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS "source" TEXT;

CREATE INDEX IF NOT EXISTS "signal_features_market_timeframe_idx"
  ON "signal_features" ("market", "timeframe");

CREATE INDEX IF NOT EXISTS "signal_features_direction_outcome_idx"
  ON "signal_features" ("signal_type", "outcome");
