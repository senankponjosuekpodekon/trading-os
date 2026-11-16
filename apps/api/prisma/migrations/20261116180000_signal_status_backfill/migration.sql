-- Backfill : synchronise status avec execution_status déjà résolu.
-- Séparé de l'ADD VALUE (55P04 : une nouvelle valeur d'enum ne peut pas
-- être utilisée dans la même transaction que son ALTER TYPE).
UPDATE "signals" SET "status" = 'CLOSED'
  WHERE "execution_status" IN ('CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BREAKEVEN')
    AND "status" = 'ACTIVE';
UPDATE "signals" SET "status" = 'INVALIDATED'
  WHERE "execution_status" = 'EXPIRED' AND "status" = 'ACTIVE';
