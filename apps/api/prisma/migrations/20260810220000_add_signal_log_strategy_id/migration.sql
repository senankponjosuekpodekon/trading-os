-- AlterTable: add strategyId column to signal_logs
ALTER TABLE "signal_logs" ADD COLUMN "strategy_id" TEXT;

-- CreateIndex: for matching signalLog by strategyId
CREATE INDEX "signal_logs_strategy_id_idx" ON "signal_logs"("strategy_id");
