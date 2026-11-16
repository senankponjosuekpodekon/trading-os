-- Fiche instrument : une seule source pour les coûts, le contrat et les
-- feeds de prix, lue par l'engine, l'API et le backtest.
-- cf. docs/instrument_spec.md
CREATE TABLE IF NOT EXISTS instrument_profile (
  symbol              TEXT PRIMARY KEY,          -- = assets.symbol
  venue               TEXT NOT NULL,             -- SPOT | MARGIN | FUTURES | SYNTHETIC
  asset_class         TEXT,                      -- forex | commodité | crypto | indice | action | brvm | synthetic
  quote_currency      TEXT,
  shortable           BOOLEAN NOT NULL DEFAULT TRUE,

  -- contrat
  multiplier          DOUBLE PRECISION NOT NULL DEFAULT 1,
  tick_size           DOUBLE PRECISION,
  lot_min             DOUBLE PRECISION,
  notional_min        DOUBLE PRECISION,
  max_leverage        DOUBLE PRECISION,

  -- coûts en unité de risque (fraction du prix, aller-retour)
  spread_rt           DOUBLE PRECISION NOT NULL DEFAULT 0,
  taker_rt            DOUBLE PRECISION NOT NULL DEFAULT 0,
  maker_rt            DOUBLE PRECISION NOT NULL DEFAULT 0,
  slippage_rt_obs     DOUBLE PRECISION NOT NULL DEFAULT 0,   -- observé, pas constant
  carry_source        TEXT NOT NULL DEFAULT 'none',          -- funding | swap | none
  carry_freq          TEXT,                                  -- '8h' | 'daily'
  carry_rate          DOUBLE PRECISION,

  -- prix & résolution (fix iv)
  price_source_scan    TEXT,
  price_source_resolve TEXT,
  feed_offset_obs      DOUBLE PRECISION NOT NULL DEFAULT 0,  -- écart moyen mesuré (fraction du prix)

  -- perp / risque
  liq_buffer          DOUBLE PRECISION NOT NULL DEFAULT 0.015,
  tradable            BOOLEAN NOT NULL DEFAULT TRUE,
  candles_since       DATE,

  -- gouvernance
  capital_max_exchange DOUBLE PRECISION,
  source              TEXT NOT NULL DEFAULT 'default',       -- 'default' | 'measured' | 'manual'
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instrument_profile_venue ON instrument_profile (venue, tradable);

-- Backfill depuis assets + venue() équivalent (CRYPTO set du backtest).
INSERT INTO instrument_profile (symbol, venue, asset_class, quote_currency,
                                shortable, spread_rt, taker_rt, slippage_rt_obs,
                                carry_source, carry_freq, carry_rate,
                                price_source_resolve, candles_since)
SELECT
  a.symbol,
  CASE
    WHEN m.name = 'BRVM' THEN 'SPOT'
    WHEN split_part(a.symbol,'/',1) IN
      ('BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK','DOT','MATIC','NEAR',
       'DOGE','LTC','ATOM','UNI','TRX') THEN 'FUTURES'
    WHEN m.name = 'Synthetic' THEN 'SYNTHETIC'
    ELSE 'MARGIN'
  END,
  lower(m.name),
  a."baseCurrency",
  m.name NOT IN ('BRVM'),
  CASE WHEN m.name IN ('Forex','Commodities','Indices','Synthetic') THEN 0.0002 ELSE 0 END,
  CASE WHEN m.name = 'Crypto' OR m.name = 'BRVM' THEN
      CASE WHEN m.name = 'Crypto' THEN 0.001 ELSE 0.002 END
    ELSE 0 END,
  CASE WHEN m.name = 'Crypto' THEN 0.0004 ELSE 0 END,
  CASE
    WHEN split_part(a.symbol,'/',1) IN
      ('BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK','DOT','MATIC','NEAR',
       'DOGE','LTC','ATOM','UNI','TRX') THEN 'funding'
    WHEN m.name IN ('Forex','Commodities','Indices','Synthetic') THEN 'swap'
    ELSE 'none'
  END,
  CASE
    WHEN split_part(a.symbol,'/',1) IN
      ('BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK','DOT','MATIC','NEAR',
       'DOGE','LTC','ATOM','UNI','TRX') THEN '8h'
    WHEN m.name IN ('Forex','Commodities','Indices','Synthetic') THEN 'daily'
    ELSE NULL
  END,
  CASE
    WHEN split_part(a.symbol,'/',1) IN
      ('BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK','DOT','MATIC','NEAR',
       'DOGE','LTC','ATOM','UNI','TRX') THEN 0.0001
    WHEN m.name IN ('Forex','Commodities','Indices','Synthetic') THEN 0.0000781
    ELSE NULL
  END,
  CASE WHEN m.name = 'Crypto' THEN 'binance'
       WHEN a.symbol = 'XAG/USD' THEN 'alphavantage'
       ELSE 'twelvedata' END,
  NULL
FROM assets a
JOIN markets m ON m.id = a."marketId"
ON CONFLICT (symbol) DO NOTHING;

-- candles est une table engine (hors migrations Prisma) : backfill seulement
-- si elle existe dans cette base (prod oui, CI neuve non — le cron la
-- recalcule toutes les 6h de toute façon).
DO $$
BEGIN
  IF to_regclass('candles') IS NOT NULL THEN
    EXECUTE $u$
      UPDATE instrument_profile ip
      SET candles_since = sub.first_candle
      FROM (SELECT symbol, MIN(open_time)::date AS first_candle
            FROM candles GROUP BY symbol) sub
      WHERE ip.symbol = sub.symbol
    $u$;
  END IF;
END $$;
