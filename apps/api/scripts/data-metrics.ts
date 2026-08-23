import { logger } from '../src/common/logger';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function formatPct(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function toNumber(value: bigint | number | null): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

async function main() {
  const totalSnapshots = await prisma.signalFeature.count();
  const closedSnapshots = await prisma.signalFeature.count({
    where: { outcome: { not: null } },
  });

  const [outcomeCounts, marketCounts, timeframeCounts] = await Promise.all([
    prisma.$queryRaw<Array<{ outcome: string | null; count: bigint }>>(Prisma.sql`
      SELECT outcome, COUNT(*)::bigint AS count
      FROM signal_features
      WHERE outcome IS NOT NULL
      GROUP BY outcome
      ORDER BY outcome
    `),
    prisma.$queryRaw<Array<{ market: string | null; count: bigint }>>(Prisma.sql`
      SELECT market, COUNT(*)::bigint AS count
      FROM signal_features
      GROUP BY market
      ORDER BY market NULLS LAST
    `),
    prisma.$queryRaw<Array<{ timeframe: string | null; count: bigint }>>(Prisma.sql`
      SELECT timeframe, COUNT(*)::bigint AS count
      FROM signal_features
      GROUP BY timeframe
      ORDER BY timeframe NULLS LAST
    `),
  ]);

  const lastSnapshot = await prisma.signalFeature.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  logger.info('── Signal Feature Metrics ───────────────────────────────');
  logger.info(`Total snapshots      : ${totalSnapshots}`);
  logger.info(`Snapshots w/ outcome : ${closedSnapshots} (${formatPct(closedSnapshots, totalSnapshots)})`);
  if (lastSnapshot) {
    logger.info(`Last snapshot        : ${lastSnapshot.createdAt.toISOString()}`);
  }
  logger.info('');

  logger.info('Outcome distribution');
  if (!outcomeCounts.length) {
    logger.info('  (no outcomes yet)');
  } else {
    outcomeCounts.forEach(({ outcome, count }) => {
      const label = outcome ?? 'UNKNOWN';
      const value = toNumber(count);
      logger.info(`  ${label.padEnd(10)} : ${value} (${formatPct(value, closedSnapshots)})`);
    });
  }
  logger.info('');

  logger.info('Snapshots by market');
  if (!marketCounts.length) {
    logger.info('  (no snapshots yet)');
  } else {
    marketCounts.forEach(({ market, count }) => {
      const value = toNumber(count);
      logger.info(`  ${(market ?? 'UNKNOWN').padEnd(10)} : ${value} (${formatPct(value, totalSnapshots)})`);
    });
  }
  logger.info('');

  logger.info('Snapshots by timeframe');
  if (!timeframeCounts.length) {
    logger.info('  (no snapshots yet)');
  } else {
    timeframeCounts.forEach(({ timeframe, count }) => {
      const value = toNumber(count);
      logger.info(`  ${(timeframe ?? 'UNKNOWN').padEnd(8)} : ${value} (${formatPct(value, totalSnapshots)})`);
    });
  }
  logger.info('──────────────────────────────────────────────────────────────');
}

main()
  .catch((error) => {
    logger.error('data-metrics failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
