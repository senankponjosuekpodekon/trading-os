import { PrismaClient } from '@prisma/client';
import { logger } from '../common/logger';

/**
 * Prisma client for integration tests.
 * Uses the standard DATABASE_URL; CI should point it to an isolated test DB.
 */
export const prismaTestClient = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const TABLES_TO_TRUNCATE = [
  'audit_logs',
  'price_alerts',
  'notifications',
  'lab_sessions',
  'journal_entries',
  'positions',
  'signals',
  'strategies',
  'portfolios',
  'refresh_tokens',
  'subscriptions',
  'users',
];

/**
 * Reset the test database by truncating all known tables.
 * Safe to call in a `beforeEach` when running against an isolated test DB.
 */
export async function resetTestDatabase() {
  for (const table of TABLES_TO_TRUNCATE) {
    try {
      await prismaTestClient.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
    } catch (e: any) {
      // Some tables may not exist in every migration state; ignore.
      if (!e?.message?.includes('does not exist')) {
        logger.warn(`Failed to truncate ${table}: ${e.message}`);
      }
    }
  }
}
