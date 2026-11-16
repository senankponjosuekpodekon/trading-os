-- SignalStatus.CLOSED : les signaux résolus (TP/SL/time-stop) passaient
-- execution_status → CLOSED_* mais status restait 'ACTIVE' à vie, ce qui
-- rendait l'historique inutilisable (tout semblait "en cours").
-- Postgres exige que la nouvelle valeur d'enum soit commitée avant usage :
-- le backfill est dans la migration suivante (20261116180000).
ALTER TYPE "SignalStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
