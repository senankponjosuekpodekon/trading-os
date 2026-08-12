-- BRVM daily candles: accumulate OHLCV locally since brvm-package is unreliable
CREATE TABLE IF NOT EXISTS brvm_daily_candles (
    symbol      VARCHAR(20)   NOT NULL,
    date        DATE          NOT NULL,
    open        NUMERIC(20,4),
    high        NUMERIC(20,4),
    low         NUMERIC(20,4),
    close       NUMERIC(20,4) NOT NULL,
    volume      BIGINT        DEFAULT 0,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, date)
);
