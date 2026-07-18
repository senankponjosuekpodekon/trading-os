CREATE TABLE "signal_feedbacks" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "comment" TEXT,
    "outcome" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "signal_feedbacks_signal_id_created_at_idx" ON "signal_feedbacks"("signal_id", "created_at" DESC);
CREATE INDEX "signal_feedbacks_user_id_created_at_idx" ON "signal_feedbacks"("user_id", "created_at" DESC);

ALTER TABLE "signal_feedbacks" ADD CONSTRAINT "signal_feedbacks_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "signal_feedbacks" ADD CONSTRAINT "signal_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "quality_score" DOUBLE PRECISION;
