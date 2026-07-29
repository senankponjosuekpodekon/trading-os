/*
  Warnings:

  - Made the column `trailingActive` on table `positions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "positions" ALTER COLUMN "trailingActive" SET NOT NULL;

-- AlterTable
ALTER TABLE "signal_features" ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameForeignKey
ALTER TABLE "notifications" RENAME CONSTRAINT "notifications_userId_fkey" TO "notifications_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "signal_daily_usage" RENAME CONSTRAINT "signal_daily_usage_userId_fkey" TO "signal_daily_usage_user_id_fkey";

-- RenameIndex
ALTER INDEX "notifications_readAt_idx" RENAME TO "notifications_read_at_idx";

-- RenameIndex
ALTER INDEX "notifications_type_createdAt_idx" RENAME TO "notifications_type_created_at_idx";

-- RenameIndex
ALTER INDEX "notifications_userId_createdAt_idx" RENAME TO "notifications_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "notifications_userId_readAt_idx" RENAME TO "notifications_user_id_read_at_idx";

-- RenameIndex
ALTER INDEX "signal_daily_usage_userId_date_idx" RENAME TO "signal_daily_usage_user_id_date_idx";
