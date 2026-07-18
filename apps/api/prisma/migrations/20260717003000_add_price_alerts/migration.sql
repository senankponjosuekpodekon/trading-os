-- CreateTable
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "target_price" DECIMAL(65,30) NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "price_alerts_user_id_triggered_idx" ON "price_alerts"("user_id", "triggered");

-- CreateIndex
CREATE INDEX "price_alerts_asset_symbol_triggered_idx" ON "price_alerts"("asset_symbol", "triggered");
