-- Add trailing stop configuration columns to positions
ALTER TABLE "positions"
  ADD COLUMN IF NOT EXISTS "trailingMethod" TEXT DEFAULT 'atr',
  ADD COLUMN IF NOT EXISTS "trailingActive" BOOLEAN DEFAULT true;

-- Backfill existing rows
UPDATE "positions"
  SET "trailingMethod" = COALESCE("trailingMethod", 'atr'),
      "trailingActive" = COALESCE("trailingActive", true);
