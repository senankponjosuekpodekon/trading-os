-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SIGNAL', 'POSITION', 'ALERT', 'SYSTEM');

-- CreateTable
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_readAt_idx" ON "notifications"("read_at");

-- CreateIndex
CREATE INDEX "notifications_type_createdAt_idx" ON "notifications"("type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extra indexes for production performance
CREATE INDEX "signals_isActive_createdAt_idx" ON "signals"("isActive", "createdAt" DESC);

CREATE INDEX "signals_strategyId_createdAt_idx" ON "signals"("strategyId", "createdAt" DESC);

CREATE INDEX "signals_profileSuitability_idx" ON "signals"("profileSuitability");

CREATE INDEX "positions_assetId_status_idx" ON "positions"("assetId", "status");

CREATE INDEX "positions_signalId_idx" ON "positions"("signalId");

CREATE INDEX "positions_openedAt_idx" ON "positions"("openedAt" DESC);
