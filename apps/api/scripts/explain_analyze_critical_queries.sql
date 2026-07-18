-- Performance audit: EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) on critical queries
-- Run with: PGPASSWORD=trading_pass psql -h localhost -p 5433 -U trading_user -d trading_os -f scripts/explain_analyze_critical_queries.sql

\timing on

\set ECHO none

-- 1. Latest signals for a given asset
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "assetId", "signal", "confidence", "createdAt"
FROM "signals"
WHERE "assetId" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
ORDER BY "createdAt" DESC
LIMIT 20;

-- 2. Active signals feed (dashboard / watcher)
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "assetId", "signal", "confidence", "createdAt"
FROM "signals"
WHERE "isActive" = true
ORDER BY "createdAt" DESC
LIMIT 20;

-- 3. Positions for a portfolio filtered by status
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "assetId", "status", "direction", "quantity", "openedAt"
FROM "positions"
WHERE "portfolioId" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  AND "status" IN ('OPEN', 'PARTIAL')
ORDER BY "openedAt" DESC;

-- 4. Open positions for a user via portfolio join (live positions)
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.*
FROM "positions" p
JOIN "portfolios" pf ON p."portfolioId" = pf."id"
WHERE p."status" IN ('OPEN', 'PARTIAL')
  AND pf."userId" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
ORDER BY p."openedAt" DESC;

-- 5. Refresh token lookup by hash
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "user_id", "expires_at", "revoked_at"
FROM "refresh_tokens"
WHERE "token_hash" = 'deadbeefdeadbeefdeadbeefdeadbeef';

-- 6. User lookup by email (auth login)
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "email", "password", "role", "isActive"
FROM "users"
WHERE "email" = 'test@example.com';

-- 7. Portfolios for a user
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "name", "type", "currentCapital"
FROM "portfolios"
WHERE "userId" = 'aaaaaaaaaaaaaaaaaaaaaaaa';

-- 8. Signal logs for symbol/timeframe (calibration pipeline)
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "symbol", "timeframe", "score_total", "outcome", "created_at"
FROM "signal_logs"
WHERE "symbol" = 'BTC/USDT'
  AND "timeframe" = '1h'
ORDER BY "created_at" DESC
LIMIT 50;

-- 9. Recent notifications for a user
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "type", "title", "read_at", "created_at"
FROM "notifications"
WHERE "user_id" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
ORDER BY "created_at" DESC
LIMIT 20;

-- 10. Recent journal entries for a user
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "title", "emotion", "grade", "createdAt"
FROM "journal_entries"
WHERE "userId" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
ORDER BY "createdAt" DESC
LIMIT 20;

-- 11. Daily alert cap count (alert engine anti-spam)
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) AS sent_today
FROM "notifications"
WHERE "user_id" = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  AND "created_at" >= CURRENT_DATE
  AND "type" = 'SIGNAL';

\set ECHO all
