-- Exchange connections + Signal channels (copy-trading)
-- Creates tables and RLS policies for:
--   1. exchange_connections — encrypted user exchange API keys
--   2. signal_channels — mentor-owned signal distribution channels
--   3. signal_channel_subscriptions — user subscriptions to channels

-- ─── exchange_connections ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "exchange_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "api_secret" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_valid_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exchange_connections_user_id_idx" ON "exchange_connections"("user_id");
CREATE INDEX IF NOT EXISTS "exchange_connections_user_id_exchange_idx" ON "exchange_connections"("user_id", "exchange");

ALTER TABLE "exchange_connections"
  ADD CONSTRAINT "exchange_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- ─── signal_channels ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "signal_channels" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscriber_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_channels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "signal_channels_owner_id_idx" ON "signal_channels"("owner_id");
CREATE INDEX IF NOT EXISTS "signal_channels_visibility_is_active_idx" ON "signal_channels"("visibility", "is_active");

ALTER TABLE "signal_channels"
  ADD CONSTRAINT "signal_channels_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- ─── signal_channel_subscriptions ─────────────────────────────
CREATE TABLE IF NOT EXISTS "signal_channel_subscriptions" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_channel_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "signal_channel_subscriptions_channel_id_user_id_key"
  ON "signal_channel_subscriptions"("channel_id", "user_id");
CREATE INDEX IF NOT EXISTS "signal_channel_subscriptions_user_id_idx" ON "signal_channel_subscriptions"("user_id");

ALTER TABLE "signal_channel_subscriptions"
  ADD CONSTRAINT "signal_channel_subscriptions_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "signal_channels"("id") ON DELETE CASCADE;
ALTER TABLE "signal_channel_subscriptions"
  ADD CONSTRAINT "signal_channel_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

-- ─── RLS policies for new tables ──────────────────────────────
ALTER TABLE "exchange_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exchange_connections_user_isolation ON exchange_connections;
CREATE POLICY exchange_connections_user_isolation ON exchange_connections
  USING (user_id = current_setting('app.current_user_id', true));

ALTER TABLE "signal_channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signal_channels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_channels_owner_isolation ON signal_channels;
CREATE POLICY signal_channels_owner_isolation ON signal_channels
  USING (owner_id = current_setting('app.current_user_id', true));

ALTER TABLE "signal_channel_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signal_channel_subscriptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_channel_subscriptions_user_isolation ON signal_channel_subscriptions;
CREATE POLICY signal_channel_subscriptions_user_isolation ON signal_channel_subscriptions
  USING (user_id = current_setting('app.current_user_id', true));
