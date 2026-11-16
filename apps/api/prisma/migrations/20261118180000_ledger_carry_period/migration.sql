-- Le UNIQUE(positionId,event) empêche les CARRY périodiques.
-- Remplacé par un index incluant metadata.period ('' pour les événements
-- uniques POSITION_OPEN/CLOSE → dédup identique conservée).
ALTER TABLE account_ledger DROP CONSTRAINT IF EXISTS "account_ledger_positionId_event_key";

CREATE UNIQUE INDEX IF NOT EXISTS account_ledger_idem
    ON account_ledger ("positionId", event, COALESCE(metadata->>'period', ''));
