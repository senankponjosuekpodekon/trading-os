-- Portfolio engine : snapshots d'état, ledger append-only, ordres d'exécution.
-- Additif/idempotent.

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "portfolioId"   TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    equity          DOUBLE PRECISION NOT NULL,
    cash            DOUBLE PRECISION NOT NULL,
    cash_free       DOUBLE PRECISION NOT NULL,
    margin_locked   DOUBLE PRECISION NOT NULL,
    unrealized_pnl  DOUBLE PRECISION NOT NULL,
    n_positions     INT NOT NULL,
    risk_to_stop    DOUBLE PRECISION NOT NULL,
    risk_budget     DOUBLE PRECISION,
    gap_loss        DOUBLE PRECISION,
    clusters        JSONB,
    venues          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_pf_time
    ON portfolio_snapshots ("portfolioId", created_at DESC);

-- Journal comptable append-only : une ligne par événement.
-- unique(positionId,event) → idempotent par construction.
CREATE TABLE IF NOT EXISTS account_ledger (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "portfolioId"   TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    "positionId"    TEXT,
    event           TEXT NOT NULL,        -- POSITION_OPEN | POSITION_CLOSE | PNL | FEE | CARRY | DEPOSIT | WITHDRAW
    amount          DOUBLE PRECISION NOT NULL,  -- signé : +crédit / −débit
    balance_after   DOUBLE PRECISION,
    symbol          TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE ("positionId", event)
);
CREATE INDEX IF NOT EXISTS account_ledger_pf_time
    ON account_ledger ("portfolioId", created_at DESC);

-- Ordres d'exécution : shadow (mesuré, pas exécuté) → paper → live.
CREATE TABLE IF NOT EXISTS execution_orders (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "portfolioId"   TEXT REFERENCES portfolios(id) ON DELETE SET NULL,
    "signalId"      TEXT,
    symbol          TEXT NOT NULL,
    direction       TEXT NOT NULL,
    qty             DOUBLE PRECISION NOT NULL,
    requested_price DOUBLE PRECISION,
    fill_price      DOUBLE PRECISION,
    status          TEXT NOT NULL,        -- SHADOW | PAPER_FILLED | SUBMITTED | FILLED | REJECTED | FAILED
    mode            TEXT NOT NULL,        -- shadow | paper | live
    venue           TEXT,
    reason          TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE ("signalId", mode)
);
CREATE INDEX IF NOT EXISTS execution_orders_symbol_time
    ON execution_orders (symbol, created_at DESC);
