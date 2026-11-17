BEGIN;

ALTER TABLE "signal_execution_events"
  ADD COLUMN "autopilot_status" TEXT NOT NULL DEFAULT 'HISTORICAL',
  ADD COLUMN "autopilot_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "autopilot_next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "autopilot_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN "autopilot_processed_at" TIMESTAMP(3),
  ADD COLUMN "autopilot_last_error" TEXT;

ALTER TABLE "signal_execution_events"
  ALTER COLUMN "autopilot_status" SET DEFAULT 'PENDING',
  ADD CONSTRAINT "signal_execution_events_autopilot_status_check"
    CHECK ("autopilot_status" IN ('HISTORICAL', 'PENDING', 'RETRY', 'COMPLETED', 'SKIPPED', 'FAILED'));

CREATE INDEX "signal_execution_events_autopilot_queue_idx"
  ON "signal_execution_events" ("autopilot_status", "candle_time", "created_at");

COMMIT;
