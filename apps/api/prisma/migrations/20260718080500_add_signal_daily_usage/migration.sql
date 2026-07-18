-- CreateTable
CREATE TABLE IF NOT EXISTS "signal_daily_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "signals_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "signal_daily_usage_user_date_unique" ON "signal_daily_usage"("user_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "signal_daily_usage_userId_date_idx" ON "signal_daily_usage"("user_id", "date");

-- AddForeignKey
ALTER TABLE "signal_daily_usage"
  ADD CONSTRAINT "signal_daily_usage_userId_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
