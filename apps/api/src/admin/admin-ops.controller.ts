import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { UserRole } from '@prisma/client';

@Controller('admin/ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminOpsController {
  constructor(
    private prisma: PrismaService,
    private healthService: SystemHealthService,
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
}
