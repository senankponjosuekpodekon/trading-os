# Verification

- API: run `npx tsc --noEmit` and `npx jest --coverage --runInBand` from `apps/api`.
- AutoPilot PostgreSQL outbox tests use `AUTOPILOT_TEST_DATABASE_URL` pointing to a dedicated disposable database with the Prisma schema applied. In CI they use the CI `DATABASE_URL`. They create isolated fixtures and a migration probe schema; never point them at production.
- API auth integration tests use Redis through FeatureFlagsService. Supply a dedicated disposable test Redis with `REDIS_URL`; do not point tests at production Redis. Disable SMTP for tests with `SMTP_HOST=`.
- Web: run `npx tsc --noEmit` from `apps/web`. Target Jest files with `npx jest --runInBand --runTestsByPath '<path>'` (quote paths containing parentheses).
- Cron-owned AutoPilot operations require `PrismaSystemService`; request-scoped `PrismaService` uses the `app_runtime` role and portfolio/position RLS fails closed without a user context.
- AutoPilot paper positions are managed only by the durable event worker. Generic position/trailing watchers must exclude `AUTOPILOT_EMAIL`. Outbox migration marks existing events `HISTORICAL`; do not reset old entries for automatic replay.
- Signal execution events describe theoretical price tracking, not proof of a paper portfolio position or a broker fill. Verify linked positions separately.
- Keep production deployment CI-driven. Do not change execution mode, enable live venues, or send broker orders during paper-pipeline verification.
