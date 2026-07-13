-- CreateEnum
CREATE TYPE "SignalOutcome" AS ENUM ('PENDING', 'WIN_TP1', 'WIN_TP2', 'LOSS_SL', 'EXPIRED');

-- CreateTable
CREATE TABLE "signal_logs" (
    "id"              TEXT NOT NULL,
    "signal_id"       TEXT,
    "symbol"          TEXT NOT NULL,
    "timeframe"       TEXT NOT NULL,
    "signal_type"     "SignalType" NOT NULL,
    "confidence"      DOUBLE PRECISION NOT NULL,
    "entry_price"     DECIMAL(65,30) NOT NULL,
    "stop_loss"       DECIMAL(65,30),
    "take_profit_1"   DECIMAL(65,30),
    "take_profit_2"   DECIMAL(65,30),
    "risk_reward"     DOUBLE PRECISION,
    "score_trend"     DOUBLE PRECISION,
    "score_pa"        DOUBLE PRECISION,
    "score_sr"        DOUBLE PRECISION,
    "score_patterns"  DOUBLE PRECISION,
    "score_regime"    DOUBLE PRECISION,
    "score_smc"       DOUBLE PRECISION,
    "score_mtf"       DOUBLE PRECISION,
    "score_sentiment" DOUBLE PRECISION,
    "score_total"     DOUBLE PRECISION NOT NULL,
    "regime"          TEXT,
    "adx"             DOUBLE PRECISION,
    "market"          TEXT,
    "outcome"         "SignalOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_price"   DECIMAL(65,30),
    "outcome_at"      TIMESTAMP(3),
    "bars_to_outcome" INTEGER,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_logs_symbol_timeframe_created_at_idx" ON "signal_logs"("symbol", "timeframe", "created_at" DESC);

-- CreateIndex
CREATE INDEX "signal_logs_outcome_created_at_idx" ON "signal_logs"("outcome", "created_at" DESC);

-- CreateIndex
CREATE INDEX "signal_logs_market_signal_type_outcome_idx" ON "signal_logs"("market", "signal_type", "outcome");
