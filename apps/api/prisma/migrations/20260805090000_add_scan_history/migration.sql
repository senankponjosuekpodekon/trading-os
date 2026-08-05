-- CreateTable: scan_history
CREATE TABLE "scan_history" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT,
    "strategy_name" TEXT NOT NULL DEFAULT 'Default',
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "signal" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "explanation" TEXT NOT NULL DEFAULT '',
    "signal_pending" BOOLEAN NOT NULL DEFAULT false,
    "persistence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "asset_type" TEXT,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX "scan_history_strategy_id_scanned_at_idx" ON "scan_history"("strategy_id", "scanned_at" DESC);
CREATE INDEX "scan_history_symbol_timeframe_idx" ON "scan_history"("symbol", "timeframe");
CREATE INDEX "scan_history_scanned_at_idx" ON "scan_history"("scanned_at" DESC);

-- Convert to TimescaleDB hypertable (if extension available)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        PERFORM create_hypertable('scan_history', 'scanned_at', if_not_exists => TRUE);
        ALTER TABLE "scan_history" SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'strategy_id, symbol',
            timescaledb.compress_orderby = 'scanned_at DESC'
        );
        PERFORM add_compression_policy('scan_history', INTERVAL '1 day', if_not_exists => TRUE);
        PERFORM add_retention_policy('scan_history', INTERVAL '14 days', if_not_exists => TRUE);
    END IF;
END $$;
