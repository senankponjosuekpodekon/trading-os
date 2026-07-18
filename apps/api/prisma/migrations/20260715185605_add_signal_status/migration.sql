-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('PENDING', 'ACTIVE', 'INVALIDATED');

-- AlterTable
ALTER TABLE "signals" ADD COLUMN     "status" "SignalStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "signals_status_idx" ON "signals"("status");
