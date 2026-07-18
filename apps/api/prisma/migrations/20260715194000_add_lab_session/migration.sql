-- CreateEnum
CREATE TYPE "LabSessionStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "lab_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "strategy" JSONB NOT NULL,
    "status" "LabSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "backtestMetrics" JSONB,
    "tradeList" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_sessions_userId_status_idx" ON "lab_sessions"("userId", "status");

-- CreateIndex
CREATE INDEX "lab_sessions_createdAt_idx" ON "lab_sessions"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "lab_sessions" ADD CONSTRAINT "lab_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
