import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async generateDailyReport() {
    this.logger.log('Starting daily report generation...');
    try {
      const report = await this.collectReportData();
      const summary = this.buildSummary(report);
      const interpretation = this.buildInterpretation(report);

      const saved = await this.prisma.dailyReport.create({
        data: {
          date: new Date(),
          data: report as any,
          summary,
          interpretation,
        },
      });

      this.logger.log(`Daily report saved: ${saved.id}`);
      return saved;
    } catch (err) {
      this.logger.error('Failed to generate daily report', err);
    }
  }

  async listReports(limit = 30) {
    return this.prisma.dailyReport.findMany({
      orderBy: { date: 'desc' },
      take: limit,
      select: {
        id: true,
        date: true,
        summary: true,
        interpretation: true,
        createdAt: true,
      },
    });
  }

  async getReport(id: string) {
    return this.prisma.dailyReport.findUnique({ where: { id } });
  }

  async getLatestReport() {
    return this.prisma.dailyReport.findFirst({
      orderBy: { date: 'desc' },
    });
  }

  private async collectReportData(): Promise<any> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      signals24h,
      signalsByDirection,
      signalsByStatus,
      topSignals,
      scanHistory24h,
      portfolioStats,
      userCount,
      activeStrategies,
      positions,
      closedSignals7d,
      cronHealth,
      containerStats,
    ] = await Promise.all([
      this.prisma.signal.count({ where: { createdAt: { gte: yesterday } } }),
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
      this.prisma.signal.findMany({
        where: { createdAt: { gte: yesterday }, signal: { in: ['BUY', 'SELL'] } },
        orderBy: { confidence: 'desc' },
        take: 10,
        include: { asset: { select: { symbol: true } } },
      }),
      this.prisma.scanHistory.findMany({
        where: { scannedAt: { gte: yesterday } },
        orderBy: { scannedAt: 'desc' },
        take: 20,
        select: {
          symbol: true, signal: true, confidence: true,
          timeframe: true, strategyName: true, scannedAt: true,
        },
      }),
      this.prisma.portfolio.aggregate({ _sum: { currentCapital: true } }),
      this.prisma.user.count(),
      this.prisma.strategy.count({ where: { isActive: true } }),
      this.prisma.position.findMany({
        where: { status: 'OPEN' },
        select: {
          direction: true, entryPrice: true,
          pnl: true, pnlPercent: true, quantity: true,
          asset: { select: { symbol: true } },
        },
      }),
      this.prisma.signal.findMany({
        where: { createdAt: { gte: weekAgo }, status: 'INVALIDATED' },
        select: { signal: true, status: true, confidence: true },
      }),
      this.getSystemHealth(),
      this.getContainerStats(),
    ]);

    const losses = closedSignals7d.length;
    const active7d = await this.prisma.signal.count({
      where: { createdAt: { gte: weekAgo }, status: 'ACTIVE' },
    });
    const outcomesTotal = losses + active7d;
    const winRate = outcomesTotal > 0 ? Math.round((active7d / outcomesTotal) * 100) : null;

    return {
      date: now.toISOString(),
      period: { from: yesterday.toISOString(), to: now.toISOString() },
      signals: {
        total: signals24h,
        byDirection: signalsByDirection.reduce((acc, r) => {
          acc[r.signal] = r._count;
          return acc;
        }, {} as Record<string, number>),
        byStatus: signalsByStatus.reduce((acc, r) => {
          acc[r.status] = r._count;
          return acc;
        }, {} as Record<string, number>),
        top: topSignals,
      },
      scans: {
        total: scanHistory24h.length,
        recent: scanHistory24h,
      },
      portfolio: {
        totalValue: portfolioStats._sum.currentCapital ?? 0,
        openPositions: positions.length,
        positions,
      },
      performance: {
        winRate,
        totalOutcomes: outcomesTotal,
        wins: active7d,
        losses,
      },
      system: {
        users: userCount,
        activeStrategies,
        cronHealth,
        containers: containerStats,
      },
    };
  }

  private buildSummary(data: any): string {
    const dir = data.signals.byDirection;
    const buy = dir['BUY'] ?? 0;
    const sell = dir['SELL'] ?? 0;
    const neutral = dir['NEUTRAL'] ?? 0;
    const winRate = data.performance.winRate;
    const portfolioValue = data.portfolio.totalValue;

    return `Rapport du ${new Date(data.date).toLocaleDateString('fr-FR')} — ` +
      `${data.signals.total} signaux (${buy} BUY, ${sell} SELL, ${neutral} NEUTRAL), ` +
      `${data.scans.total} scans, ` +
      `${data.portfolio.openPositions} positions ouvertes` +
      (portfolioValue ? `, portefeuille: $${portfolioValue.toFixed(2)}` : '') +
      (winRate !== null ? `, win rate 7j: ${winRate}%` : '') +
      `, ${data.system.users} utilisateurs, ${data.system.activeStrategies} stratégies actives.`;
  }

  private buildInterpretation(data: any): string {
    const parts: string[] = [];
    const dir = data.signals.byDirection;
    const buy = dir['BUY'] ?? 0;
    const sell = dir['SELL'] ?? 0;
    const total = data.signals.total;

    if (total === 0) {
      parts.push('Aucun signal généré dans les dernières 24h — vérifier que les scans tournent.');
    } else {
      const buyRatio = buy / total;
      const sellRatio = sell / total;

      if (buyRatio > 0.6) {
        parts.push(`Sentiment global haussier (${Math.round(buyRatio * 100)}% BUY) — marché potentiellement en tendance bullish.`);
      } else if (sellRatio > 0.6) {
        parts.push(`Sentiment global baissier (${Math.round(sellRatio * 100)}% SELL) — marché potentiellement en tendance bearish.`);
      } else {
        parts.push(`Sentiment mixte (${buy} BUY vs ${sell} SELL) — marché en range ou indécis.`);
      }

      if (data.signals.top.length > 0) {
        const top = data.signals.top[0];
        const sym = top.asset?.symbol ?? top.symbol ?? 'N/A';
        parts.push(`Meilleur signal: ${sym} ${top.signal} (${top.confidence}% confiance, ${top.timeframe}).`);
      }
    }

    if (data.performance.winRate !== null) {
      if (data.performance.winRate >= 60) {
        parts.push(`Performance 7j positive (${data.performance.winRate}% win rate) — stratégies efficaces.`);
      } else if (data.performance.winRate < 40) {
        parts.push(`Performance 7j faible (${data.performance.winRate}% win rate) — considérer recalibrer les stratégies.`);
      } else {
        parts.push(`Performance 7j neutre (${data.performance.winRate}% win rate).`);
      }
    }

    if (data.portfolio.openPositions > 0) {
      const profitable = data.portfolio.positions.filter((p: any) => (p.pnl ?? 0) > 0).length;
      parts.push(`${data.portfolio.openPositions} positions ouvertes dont ${profitable} en profit.`);
    }

    if (data.system.cronHealth) {
      const failedCrons = Object.entries(data.system.cronHealth).filter(
        ([, v]: any) => v.lastStatus === 'failed',
      );
      if (failedCrons.length > 0) {
        parts.push(`Attention: ${failedCrons.length} cron(s) en échec — ${failedCrons.map(([k]) => k).join(', ')}.`);
      }
    }

    return parts.join(' ');
  }

  private async getSystemHealth(): Promise<any> {
    try {
      const { stdout } = await execAsync(
        'docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep trading-os',
        { timeout: 3000 },
      );
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, status] = line.split('\t');
        return { name, status };
      });
    } catch {
      return [];
    }
  }

  private async getContainerStats(): Promise<any> {
    const mem = process.memoryUsage();
    return {
      api: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        uptime: Math.floor(process.uptime()),
      },
    };
  }
}
