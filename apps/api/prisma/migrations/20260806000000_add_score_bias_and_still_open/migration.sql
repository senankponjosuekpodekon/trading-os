-- AlterEnum
ALTER TYPE "SignalOutcome" ADD VALUE 'STILL_OPEN';

-- Add score_bias column to SignalLog
ALTER TABLE "SignalLog" ADD COLUMN "score_bias" DOUBLE PRECISION;
