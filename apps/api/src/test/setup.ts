/**
 * Jest setup file.
 * CI / local runner must inject DATABASE_URL (e.g. via .env.test or exported variables).
 * This guard prevents accidental runs against a non-test database when FORCE_TEST_DB=true.
 */

if (process.env.FORCE_TEST_DB === 'true' && process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('test')) {
  throw new Error(`Refusing to run tests against non-test database: ${process.env.DATABASE_URL}`);
}
