import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CriticalQuery {
  name: string;
  sql: string;
}

export interface PlanResult {
  name: string;
  plan: any;
  warnings: string[];
  executionTimeMs?: number;
}

@Injectable()
export class DbPerformanceService {
  private readonly logger = new Logger(DbPerformanceService.name);

  constructor(private prisma: PrismaService) {}

  private readonly criticalQueries: CriticalQuery[] = [
    {
      name: 'positions_by_portfolio_status',
      sql: `SELECT * FROM positions WHERE "portfolioId" = 'dummy-portfolio-id' AND status IN ('OPEN','PARTIAL') ORDER BY "openedAt" DESC LIMIT 20`,
    },
    {
      name: 'signals_active_recent',
      sql: `SELECT * FROM signals WHERE "isActive" = true ORDER BY "createdAt" DESC LIMIT 50`,
    },
    {
      name: 'signals_by_asset_createdAt',
      sql: `SELECT * FROM signals WHERE "assetId" = 'dummy-asset-id' ORDER BY "createdAt" DESC LIMIT 50`,
    },
    {
      name: 'lab_sessions_by_user',
      sql: `SELECT * FROM lab_sessions WHERE "userId" = 'dummy-user-id' ORDER BY "createdAt" DESC LIMIT 50`,
    },
    {
      name: 'user_refresh_tokens',
      sql: `SELECT * FROM refresh_tokens WHERE "userId" = 'dummy-user-id' AND "revokedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 10`,
    },
  ];

  async analyze(): Promise<{ checkedAt: string; results: PlanResult[] }> {
    const results: PlanResult[] = [];

    for (const query of this.criticalQueries) {
      try {
        const explain = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`;
        const raw: any[] = await this.prisma.$queryRawUnsafe(explain);
        const plan = raw?.[0]?.['QUERY PLAN'] ?? raw?.[0];
        const planString = typeof plan === 'string' ? plan : JSON.stringify(plan);

        const warnings: string[] = [];
        if (/Seq\s+Scan/i.test(planString)) {
          warnings.push('Sequential scan detected — consider adding an index');
        }

        const execTimeMatch = planString.match(/"Execution Time":\s*([\d.]+)/);
        const executionTimeMs = execTimeMatch ? parseFloat(execTimeMatch[1]) : undefined;
        if (executionTimeMs && executionTimeMs > 50) {
          warnings.push(`Slow query: ${executionTimeMs.toFixed(2)} ms`);
        }

        results.push({ name: query.name, plan, warnings, executionTimeMs });
      } catch (err: any) {
        this.logger.warn({ query: query.name, error: err?.message }, 'EXPLAIN ANALYZE failed');
        results.push({ name: query.name, plan: null, warnings: [`Failed: ${err?.message}`] });
      }
    }

    return { checkedAt: new Date().toISOString(), results };
  }
}
