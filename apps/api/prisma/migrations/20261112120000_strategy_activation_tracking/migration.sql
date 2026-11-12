-- AlterTable : suivi des timestamps d'activation/désactivation de stratégie
ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "activated_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3);

-- Backfill : les stratégies actives existantes sont considérées activées depuis leur création
UPDATE "strategies" SET "activated_at" = "createdAt" WHERE "isActive" = true AND "activated_at" IS NULL;
UPDATE "strategies" SET "deactivated_at" = "updatedAt" WHERE "isActive" = false AND "deactivated_at" IS NULL;

-- CreateTable : historique générique des changements de statut (réutilisable)
CREATE TABLE IF NOT EXISTS "status_history" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by" TEXT,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "status_history_entity_type_entity_id_idx" ON "status_history"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "status_history_changed_at_idx" ON "status_history"("changed_at");
