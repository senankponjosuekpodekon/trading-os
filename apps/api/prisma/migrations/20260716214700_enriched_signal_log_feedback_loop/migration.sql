-- Enrich SignalLog with pattern snapshot, feature/metadata, and post-trade scoring

-- Pattern snapshot
ALTER TABLE "signal_logs" ADD COLUMN "pattern_name" TEXT;
ALTER TABLE "signal_logs" ADD COLUMN "pattern_confluence_score" DOUBLE PRECISION;
ALTER TABLE "signal_logs" ADD COLUMN "pattern_confluence_tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Enriched ML / Copilot snapshot
ALTER TABLE "signal_logs" ADD COLUMN "feature_vector" JSONB;
ALTER TABLE "signal_logs" ADD COLUMN "metadata" JSONB;

-- Post-trade scoring
ALTER TABLE "signal_logs" ADD COLUMN "expected_pnl_pct" DOUBLE PRECISION;
ALTER TABLE "signal_logs" ADD COLUMN "realized_pnl_pct" DOUBLE PRECISION;
ALTER TABLE "signal_logs" ADD COLUMN "post_trade_score" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "signal_logs_pattern_name_outcome_idx" ON "signal_logs"("pattern_name", "outcome");
