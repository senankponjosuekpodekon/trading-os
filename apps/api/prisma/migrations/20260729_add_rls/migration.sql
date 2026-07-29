-- Row-Level Security: per-user data isolation.
--
-- This migration is idempotent and safe to re-run. It:
--   1. Creates a dedicated, non-superuser runtime role `app_runtime` used by
--      the API/engine at request-time (migrations keep using the owner role).
--   2. Grants it the minimum privileges needed (CRUD on tables, usage on
--      sequences it does not otherwise need since all PKs are cuid()).
--   3. Enables + FORCES RLS on every table that has a direct or indirect
--      `user_id` column, with a policy based on the session var
--      `app.current_user_id` (set per-request by PrismaService).
--
-- IMPORTANT: `root` (or whichever role owns the tables) keeps BYPASSRLS by
-- default as table owner, and is still used by cron/system jobs that must
-- read across all users (trailing-stop sync, watcher, outcome resolver...).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'CHANGE_ME_APP_RUNTIME_PASSWORD' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE app TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- ─── Tables with a direct user id column ───────────────────────
-- NOTE: the actual column name is inconsistent across tables depending on
-- whether the Prisma model used @map("user_id") or not — verified against
-- information_schema, do not assume "userId" everywhere.
DO $$
DECLARE
  t TEXT;
  col TEXT;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('portfolios', 'userId'),
      ('journal_entries', 'userId'),
      ('lab_sessions', 'userId'),
      ('user_strategies', 'userId'),
      ('notifications', 'user_id'),
      ('price_alerts', 'user_id'),
      ('audit_logs', 'user_id'),
      -- refresh_tokens intentionally excluded: it is looked up BY TOKEN HASH
      -- (login/refresh/logout) before the caller's identity is known —
      -- security there comes from possessing an unguessable 512-bit secret,
      -- not from session-based row isolation. RLS-by-user_id would break auth.
      ('subscriptions', 'user_id'),
      ('signal_feedbacks', 'user_id'),
      ('signal_daily_usage', 'user_id')
    ) AS x(table_name, col_name)
  LOOP
    t := rec.table_name;
    col := rec.col_name;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_user_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (%I = current_setting(''app.current_user_id'', true))',
      t || '_user_isolation', t, col
    );
  END LOOP;
END
$$;

-- ─── positions: isolated indirectly via portfolios.userId ─────
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS positions_user_isolation ON positions;
CREATE POLICY positions_user_isolation ON positions
  USING (
    "portfolioId" IN (
      SELECT id FROM portfolios WHERE "userId" = current_setting('app.current_user_id', true)
    )
  );
