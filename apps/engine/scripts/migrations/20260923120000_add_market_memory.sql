CREATE TABLE IF NOT EXISTS market_memory (
    pattern_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    setup_type TEXT NOT NULL,
    features_json JSONB,
    confidence REAL DEFAULT 0,
    outcome TEXT,
    pnl_pct REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    signal_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_memory_lookup
ON market_memory (symbol, timeframe, signal_type, setup_type);
CREATE INDEX IF NOT EXISTS idx_market_memory_outcome
ON market_memory (outcome) WHERE outcome IS NOT NULL;
