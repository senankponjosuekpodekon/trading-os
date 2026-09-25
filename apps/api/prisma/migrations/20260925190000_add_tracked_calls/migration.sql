-- CreateTable
CREATE TABLE "tracked_calls" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain" TEXT,
    "token_address" TEXT,
    "coingecko_id" TEXT,
    "entry_price" DOUBLE PRECISION NOT NULL,
    "entry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_price" DOUBLE PRECISION,
    "peak_price" DOUBLE PRECISION,
    "peak_at" TIMESTAMP(3),
    "trough_price" DOUBLE PRECISION,
    "last_check_at" TIMESTAMP(3),
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tracked_calls_source_entry_at_idx" ON "tracked_calls"("source", "entry_at" DESC);

-- CreateIndex
CREATE INDEX "tracked_calls_symbol_idx" ON "tracked_calls"("symbol");
