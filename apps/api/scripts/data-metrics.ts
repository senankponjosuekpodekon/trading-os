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

  console.log('── Signal Feature Metrics ───────────────────────────────');
  console.log(`Total snapshots      : ${totalSnapshots}`);
  console.log(`Snapshots w/ outcome : ${closedSnapshots} (${formatPct(closedSnapshots, totalSnapshots)})`);
  if (lastSnapshot) {
    console.log(`Last snapshot        : ${lastSnapshot.createdAt.toISOString()}`);
  }
  console.log('');

  console.log('Outcome distribution');
  if (!outcomeCounts.length) {
    console.log('  (no outcomes yet)');
  } else {
    outcomeCounts.forEach(({ outcome, count }) => {
      const label = outcome ?? 'UNKNOWN';
      const value = toNumber(count);
      console.log(`  ${label.padEnd(10)} : ${value} (${formatPct(value, closedSnapshots)})`);
    });
  }
  console.log('');

  console.log('Snapshots by market');
  if (!marketCounts.length) {
    console.log('  (no snapshots yet)');
  } else {
    marketCounts.forEach(({ market, count }) => {
      const value = toNumber(count);
      console.log(`  ${(market ?? 'UNKNOWN').padEnd(10)} : ${value} (${formatPct(value, totalSnapshots)})`);
    });
  }
  console.log('');

  console.log('Snapshots by timeframe');
  if (!timeframeCounts.length) {
    console.log('  (no snapshots yet)');
  } else {
    timeframeCounts.forEach(({ timeframe, count }) => {
      const value = toNumber(count);
      console.log(`  ${(timeframe ?? 'UNKNOWN').padEnd(8)} : ${value} (${formatPct(value, totalSnapshots)})`);
    });
  }
  console.log('──────────────────────────────────────────────────────────────');
}

main()
  .catch((error) => {
    console.error('data-metrics failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
