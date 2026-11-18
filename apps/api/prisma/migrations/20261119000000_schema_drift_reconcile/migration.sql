-- Reconcile drift between migration history and schema.prisma.
-- Several schema objects were historically applied via `db push` without a
-- migration. CI builds the database from migrations only, so those objects
-- are missing there while production already has them.
--
-- Every statement is idempotent (IF NOT EXISTS / catalog guards) and purely
-- additive: no drops, no type narrowing on existing production data.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExchangeName') THEN
    CREATE TYPE "ExchangeName" AS ENUM ('BINANCE', 'BYBIT', 'OKX', 'DERIV', 'BRVM', 'OANDA', 'MT5');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChannelVisibility') THEN
    CREATE TYPE "ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
  END IF;
END
$$;

ALTER TYPE "PositionStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_2';
ALTER TYPE "PositionStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_expires" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "parent_position_id" TEXT;
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "takeProfit3" DECIMAL(65,30);
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "secondPartialExitPrice" DECIMAL(65,30);
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "secondPartialExitAt" TIMESTAMP(3);
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "secondPartialPnl" DECIMAL(65,30);

CREATE INDEX IF NOT EXISTS "positions_parent_position_id_idx" ON "positions"("parent_position_id");

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "push_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "push_subscription" JSONB;

-- ---------------------------------------------------------------------------
-- exchange_connections.exchange / signal_channels.visibility → native enums
-- Production already stores these as enums; migration-built databases have
-- TEXT columns, so convert only when the column is not already the enum type.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exchange_connections'
      AND column_name = 'exchange'
      AND udt_name <> 'ExchangeName'
  ) THEN
    ALTER TABLE "exchange_connections"
      ALTER COLUMN "exchange" TYPE "ExchangeName"
      USING "exchange"::text::"ExchangeName";
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signal_channels'
      AND column_name = 'visibility'
      AND udt_name <> 'ChannelVisibility'
  ) THEN
    ALTER TABLE "signal_channels" ALTER COLUMN "visibility" DROP DEFAULT;
    ALTER TABLE "signal_channels"
      ALTER COLUMN "visibility" TYPE "ChannelVisibility"
      USING "visibility"::text::"ChannelVisibility";
    ALTER TABLE "signal_channels" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC'::"ChannelVisibility";
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- candles (engine/API candle persistence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "candles" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(18,8) NOT NULL,
    "high" DECIMAL(18,8) NOT NULL,
    "low" DECIMAL(18,8) NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "volume" DECIMAL(18,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "candles_symbol_timeframe_open_time_key" ON "candles"("symbol", "timeframe", "open_time");

-- Production created this index as `idx_candles_symbol_timeframe`; only add
-- the Prisma-named index when neither variant exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'candles'
      AND indexname IN ('candles_symbol_timeframe_idx', 'idx_candles_symbol_timeframe')
  ) THEN
    CREATE INDEX "candles_symbol_timeframe_idx" ON "candles"("symbol", "timeframe");
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- scan_history primary key (created without one; prod gained it via db push)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'scan_history'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "scan_history" ADD CONSTRAINT "scan_history_pkey" PRIMARY KEY ("id");
  END IF;
END
$$;
