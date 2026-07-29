-- CreateTable
CREATE TABLE IF NOT EXISTS "signal_features" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "features_json" JSONB NOT NULL,
    "embedding_vector" JSONB,
    "concept_vector" JSONB,
    "outcome" "SignalOutcome",
    "pnl" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signal_features_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "signal_features_signal_id_fkey" FOREIGN KEY ("signal_id")
        REFERENCES "signals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Ensure signal_id unique
CREATE UNIQUE INDEX IF NOT EXISTS "signal_features_signal_id_key"
    ON "signal_features"("signal_id");
