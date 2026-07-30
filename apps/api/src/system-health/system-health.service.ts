import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  details?: Record<string, any>;
}

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);
  private lastAlertTime = new Map<string, Date>();
  private readonly alertCooldownMs = 30 * 60 * 1000;

  constructor(
    private prismaSystem: PrismaSystemService,
    private http: HttpService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  @Cron('*/15 * * * *')
  async runHealthChecks() {
    const results: HealthCheckResult[] = [];
    results.push(await this.checkEngine());
    results.push(await this.checkDatabase());
    results.push(await this.checkAssetsAndStrategies());
    results.push(await this.checkRecentSignals());

    const criticals = results.filter((r) => r.status === 'critical');
    const warnings = results.filter((r) => r.status === 'warning');

    if (criticals.length > 0 || warnings.length > 0) {
      this.logger.warn(
        `Health checks: ${criticals.length} critical, ${warnings.length} warning`,
      );
      await this.alertSuperAdmins(results);
    } else {
      this.logger.log('Health checks: all OK');
    }
  }

  private async checkEngine(): Promise<HealthCheckResult> {
    const engineUrl = this.config.get<string>('ENGINE_URL') ?? 'http://localhost:8000';
    try {
      const res = await firstValueFrom(
        this.http.get(`${engineUrl}/health`, { timeout: 5000 }),
      );
      if (res.data?.status === 'ok') {
        return { name: 'engine', status: 'ok', message: 'Engine healthy' };
      }
      return { name: 'engine', status: 'warning', message: `Engine responded: ${JSON.stringify(res.data)}` };
    } catch (err: any) {
      return {
        name: 'engine',
        status: 'critical',
        message: `Engine unreachable: ${err.message}`,
        details: { url: engineUrl },
      };
    }
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      await this.prismaSystem.$queryRaw`SELECT 1`;
      return { name: 'database', status: 'ok', message: 'Database connected' };
    } catch (err: any) {
      return {
        name: 'database',
        status: 'critical',
        message: `Database unreachable: ${err.message}`,
      };
    }
  }

  private async checkAssetsAndStrategies(): Promise<HealthCheckResult> {
    try {
      const [assetCount, strategyCount] = await Promise.all([
        this.prismaSystem.asset.count({ where: { isActive: true } }),
        this.prismaSystem.strategy.count({ where: { isActive: true } }),
      ]);

      if (assetCount === 0 && strategyCount === 0) {
        return {
          name: 'seed',
          status: 'critical',
          message: 'No active assets and no active strategies — seed was never run',
          details: { assets: assetCount, strategies: strategyCount },
        };
      }
      if (assetCount === 0) {
        return {
          name: 'assets',
          status: 'critical',
          message: 'No active assets in database — crons will skip scans',
          details: { count: assetCount },
        };
      }
      if (strategyCount === 0) {
        return {
          name: 'strategies',
          status: 'warning',
          message: 'No active strategies in database',
          details: { count: strategyCount },
        };
      }
      return {
        name: 'seed',
        status: 'ok',
        message: `${assetCount} active assets, ${strategyCount} active strategies`,
        details: { assets: assetCount, strategies: strategyCount },
      };
    } catch (err: any) {
      return {
        name: 'seed',
        status: 'critical',
        message: `Cannot query assets/strategies: ${err.message}`,
      };
    }
  }

  private async checkRecentSignals(): Promise<HealthCheckResult> {
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recentCount = await this.prismaSystem.signal.count({
        where: { createdAt: { gte: sixHoursAgo } },
      });

      if (recentCount === 0) {
        return {
          name: 'signals',
          status: 'warning',
          message: 'No signals generated in the last 6 hours — check crons and engine',
          details: { since: sixHoursAgo.toISOString() },
        };
      }
      return {
        name: 'signals',
        status: 'ok',
        message: `${recentCount} signals in last 6h`,
      };
    } catch (err: any) {
      return {
        name: 'signals',
        status: 'warning',
        message: `Cannot query recent signals: ${err.message}`,
      };
    }
  }

  private async alertSuperAdmins(results: HealthCheckResult[]) {
    const checkKey = results.map((r) => r.name).join(',');
    const lastAlert = this.lastAlertTime.get(checkKey);
    if (lastAlert && Date.now() - lastAlert.getTime() < this.alertCooldownMs) {
      return;
    }
    this.lastAlertTime.set(checkKey, new Date());

    const superAdmins = await this.prismaSystem.user.findMany({
      where: { role: 'SUPER_ADMIN', isActive: true },
      select: { id: true, email: true, name: true },
    });

    if (superAdmins.length === 0) {
      this.logger.error('No SUPER_ADMIN found to alert — create one via seed');
      return;
    }

    const criticals = results.filter((r) => r.status === 'critical');
    const warnings = results.filter((r) => r.status === 'warning');
    const title = `System Health: ${criticals.length} critical, ${warnings.length} warning`;
    const message = [
      ...criticals.map((r) => `[CRITICAL] ${r.name}: ${r.message}`),
      ...warnings.map((r) => `[WARNING] ${r.name}: ${r.message}`),
    ].join('\n');

    for (const admin of superAdmins) {
      this.notifications.push({
        userId: admin.id,
        type: 'SYSTEM',
        title,
        message,
        data: { results, timestamp: new Date().toISOString() },
      });
    }

    this.logger.warn(`Alerted ${superAdmins.length} super admin(s): ${title}`);
  }

  async getHealthSummary(): Promise<{ status: string; checks: HealthCheckResult[]; timestamp: string }> {
    const checks: HealthCheckResult[] = [];
    checks.push(await this.checkEngine());
    checks.push(await this.checkDatabase());
    checks.push(await this.checkAssetsAndStrategies());
    checks.push(await this.checkRecentSignals());

    const hasCritical = checks.some((c) => c.status === 'critical');
    const hasWarning = checks.some((c) => c.status === 'warning');

    return {
      status: hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
