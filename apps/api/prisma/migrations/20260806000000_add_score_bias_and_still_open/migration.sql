-- AlterEnum
ALTER TYPE "SignalOutcome" ADD VALUE IF NOT EXISTS 'STILL_OPEN';

-- Add score_bias column to signal_logs
ALTER TABLE "signal_logs" ADD COLUMN IF NOT EXISTS "score_bias" DOUBLE PRECISION;
