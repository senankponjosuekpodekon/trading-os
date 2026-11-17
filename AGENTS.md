# Verification

- API: run `npx tsc --noEmit` and `npx jest --coverage --runInBand` from `apps/api`.
- API auth integration tests use Redis through FeatureFlagsService. Supply a dedicated disposable test Redis with `REDIS_URL`; do not point tests at production Redis. Disable SMTP for tests with `SMTP_HOST=`.
- Web: run `npx tsc --noEmit` from `apps/web`. Target Jest files with `npx jest --runInBand --runTestsByPath '<path>'` (quote paths containing parentheses).
- Cron-owned AutoPilot operations require `PrismaSystemService`; request-scoped `PrismaService` uses the `app_runtime` role and portfolio/position RLS fails closed without a user context.
- Signal execution events describe theoretical price tracking, not proof of a paper portfolio position or a broker fill. Verify linked positions separately.
- Keep production deployment CI-driven. Do not change execution mode, enable live venues, or send broker orders during paper-pipeline verification.
