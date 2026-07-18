-- Add analysis_timeframe and entry_timeframe to strategies
ALTER TABLE "strategies"
  ADD COLUMN IF NOT EXISTS "analysis_timeframe" TEXT,
  ADD COLUMN IF NOT EXISTS "entry_timeframe" TEXT;
