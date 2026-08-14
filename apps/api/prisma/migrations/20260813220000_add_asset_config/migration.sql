-- CreateTable
CREATE TABLE "asset_config" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'market',
    "market_type" TEXT NOT NULL,
    "symbol" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "warmup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "scan_interval" INTEGER,
    "max_strategies" INTEGER,
    "timeframes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_config_market_type_symbol_key" ON "asset_config"("market_type", "symbol");

-- CreateIndex
CREATE INDEX "asset_config_market_type_idx" ON "asset_config"("market_type");
