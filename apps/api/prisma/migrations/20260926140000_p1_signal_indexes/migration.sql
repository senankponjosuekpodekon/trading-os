-- P1 hardening + résorption du drift schema↔migrations :
-- plusieurs colonnes de `signals` et toute la table `signal_execution_events`
-- existaient en prod via `db push` mais aucune migration ne les créait —
-- un replay de migrations (CI, fresh install) produisait un schema incomplet.
-- Tout est idempotent (IF NOT EXISTS / DO blocks) pour rester sûr en prod.

-- ── Types manquants ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SignalExecutionStatus') THEN
    CREATE TYPE "SignalExecutionStatus" AS ENUM
      ('PENDING', 'ACTIVE', 'CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BREAKEVEN', 'EXPIRED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SignalExecutionEventType') THEN
    CREATE TYPE "SignalExecutionEventType" AS ENUM
      ('ENTRY_HIT', 'SL_MOVED', 'SL_HIT', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'MANUAL_CLOSE', 'EXPIRED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntrabarResolutionMethod') THEN
    CREATE TYPE "IntrabarResolutionMethod" AS ENUM
      ('CANDLE_CLOSE', 'LOWER_TIMEFRAME', 'CONSERVATIVE_SL_FIRST');
  END IF;
END $$;

-- ── Colonnes signals manquantes ─────────────────────────────────────────
ALTER TABLE "signals"
  ADD COLUMN IF NOT EXISTS "takeProfit3" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "execution_status" "SignalExecutionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "quality_score" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "current_stop_loss" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "worst_excursion_price" DECIMAL(18,8),
  ADD COLUMN IF NOT EXISTS "last_processed_candle" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "final_pnl_pct" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "max_adverse_excursion_pct" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "max_favorable_excursion_pct" DECIMAL(8,4),
  ADD COLUMN IF NOT EXISTS "risk_reward_ratio" DECIMAL(8,4);

-- ── Table signal_execution_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "signal_execution_events" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "type" "SignalExecutionEventType" NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "size_pct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "candle_time" TIMESTAMP(3) NOT NULL,
    "candle_timeframe" TEXT NOT NULL,
    "resolved_by" "IntrabarResolutionMethod" NOT NULL DEFAULT 'CANDLE_CLOSE',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_execution_events_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signal_execution_events_signal_id_fkey'
  ) THEN
    ALTER TABLE "signal_execution_events"
      ADD CONSTRAINT "signal_execution_events_signal_id_fkey"
      FOREIGN KEY ("signal_id") REFERENCES "signals"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── P1 proprement dit ───────────────────────────────────────────────────
-- Suppression des doublons existants avant la contrainte unique
-- (conserve la plus ancienne ligne par triplet).
DELETE FROM signal_execution_events a
USING signal_execution_events b
WHERE a.signal_id = b.signal_id
  AND a.type = b.type
  AND a.candle_time = b.candle_time
  AND a.id > b.id;

-- Index sur execution_status — le tracker filtre
-- executionStatus IN ('PENDING','ACTIVE') à chaque bougie close.
CREATE INDEX IF NOT EXISTS "signals_execution_status_idx" ON "signals"("execution_status");

-- Unicité logique : un même type d'événement sur une même bougie ne doit
-- pas être inséré deux fois (crons overlappés, retries).
CREATE UNIQUE INDEX IF NOT EXISTS "signal_execution_events_signal_id_type_candle_time_key"
    ON "signal_execution_events"("signal_id", "type", "candle_time");

CREATE INDEX IF NOT EXISTS "signal_execution_events_signal_id_candle_time_idx"
    ON "signal_execution_events"("signal_id", "candle_time");

CREATE INDEX IF NOT EXISTS "signal_execution_events_signal_id_type_idx"
    ON "signal_execution_events"("signal_id", "type");
