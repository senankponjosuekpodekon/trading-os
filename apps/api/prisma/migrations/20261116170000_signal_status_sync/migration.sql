-- SignalStatus.CLOSED : les signaux résolus (TP/SL/time-stop) passaient
-- execution_status → CLOSED_* mais status restait 'ACTIVE' à vie, ce qui
-- rendait l'historique inutilisable (tout semblait "en cours").
ALTER TYPE "SignalStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- Backfill : synchronise status avec execution_status déjà résolu
UPDATE "signals" SET "status" = 'CLOSED'
  WHERE "execution_status" IN ('CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BREAKEVEN')
    AND "status" = 'ACTIVE';
UPDATE "signals" SET "status" = 'INVALIDATED'
  WHERE "execution_status" = 'EXPIRED' AND "status" = 'ACTIVE';
