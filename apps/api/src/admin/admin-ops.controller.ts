import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('admin/ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminOpsController {
  constructor(
    private prisma: PrismaService,
    private healthService: SystemHealthService,
    private config: ConfigService,
  ) {}

  @Get('health')
  async health() {
    return this.healthService.getCronStatus();
  }

  @Get('db-stats')
  async dbStats() {
    const [
      users, assets, strategies, signals, positions,
      signalLogs, features, portfolios,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.asset.count(),
      this.prisma.strategy.count(),
      this.prisma.signal.count(),
      this.prisma.position.count(),
      this.prisma.signalLog.count(),
      this.prisma.signalFeature.count(),
      this.prisma.portfolio.count(),
    ]);

    return {
      users,
      assets,
      strategies,
      signals,
      positions,
      signalLogs,
      features,
      portfolios,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('signals-24h')
  async signals24h() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [total, byDirection, byStatus] = await Promise.all([
      this.prisma.signal.count({
        where: { createdAt: { gte: yesterday } },
      }),
      this.prisma.signal.groupBy({
        by: ['signal'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
      this.prisma.signal.groupBy({
        by: ['status'],
        where: { createdAt: { gte: yesterday } },
        _count: true,
      }),
    ]);

    return {
      total,
      byDirection: byDirection.reduce((acc, r) => {
        acc[r.signal] = r._count;
        return acc;
      }, {} as Record<string, number>),
      byStatus: byStatus.reduce((acc, r) => {
        acc[r.status] = r._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  @Get('containers')
  async containers() {
    const mem = process.memoryUsage();
    const apiInfo = {
      name: 'api',
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      oomRisk: mem.rss > 400 * 1024 * 1024 ? 'high' : mem.rss > 250 * 1024 * 1024 ? 'medium' : 'low',
    };

    let engineInfo: any = null;
    try {
      const engineUrl = this.config.get<string>('ENGINE_URL', 'http://engine:8000');
      const engineKey = this.config.get<string>('ENGINE_API_KEY', '');
      const { default: axios } = await import('axios');
      const resp = await axios.get(`${engineUrl}/health`, {
        headers: { 'X-Engine-Key': engineKey },
        timeout: 3000,
      });
      engineInfo = resp.data;
    } catch {
      engineInfo = { error: 'unreachable' };
    }

    let dockerStats: any[] = [];
    try {
      const { stdout } = await execAsync(
        'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep trading-os',
        { timeout: 3000 },
      );
      dockerStats = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, status, ports] = line.split('\t');
        return { name, status, ports };
      });
    } catch {
      // docker command not available or no containers
    }

    return { api: apiInfo, engine: engineInfo, containers: dockerStats };
  }
}
