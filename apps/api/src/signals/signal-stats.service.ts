import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SignalStats {
  total: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  winRate: number;
  profitFactor: number;
  avgPnl: number;
  avgMae: number;
  avgMfe: number;
}

@Injectable()
export class SignalStatsService {
  constructor(private prisma: PrismaService) {}

  async getStats(filters?: {
    strategyId?: string;
    assetId?: string;
    timeframe?: string;
    minConfidence?: number;
  }): Promise<SignalStats> {
    const where: any = {};
    if (filters?.strategyId) where.strategyId = filters.strategyId;
    if (filters?.assetId) where.assetId = filters.assetId;
    if (filters?.timeframe) where.timeframe = filters.timeframe;
    if (filters?.minConfidence) where.confidence = { gte: filters.minConfidence };

    const signals = await this.prisma.signal.findMany({
      where: {
        ...where,
        executionStatus: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BREAKEVEN', 'EXPIRED'] },
      },
      select: {
        executionStatus: true,
        finalPnlPct: true,
        maxAdverseExcursionPct: true,
        maxFavorableExcursionPct: true,
      },
    });

    const wins = signals.filter(s => s.executionStatus === 'CLOSED_WIN');
    const losses = signals.filter(s => s.executionStatus === 'CLOSED_LOSS');
    const breakeven = signals.filter(s => s.executionStatus === 'CLOSED_BREAKEVEN');
    const expired = signals.filter(s => s.executionStatus === 'EXPIRED');

    const totalPnl = signals.reduce((sum, s) => sum + (parseFloat(s.finalPnlPct?.toString() ?? '0') || 0), 0);
    const totalWinPnl = wins.reduce((sum, s) => sum + (parseFloat(s.finalPnlPct?.toString() ?? '0') || 0), 0);
    const totalLossPnl = losses.reduce((sum, s) => sum + Math.abs(parseFloat(s.finalPnlPct?.toString() ?? '0') || 0), 0);

    return {
      total: signals.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      expired: expired.length,
      winRate: signals.length > 0 ? wins.length / signals.length : 0,
      profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 0,
      avgPnl: signals.length > 0 ? totalPnl / signals.length : 0,
      avgMae: signals.length > 0 ? signals.reduce((sum, s) => sum + (parseFloat(s.maxAdverseExcursionPct?.toString() ?? '0') || 0), 0) / signals.length : 0,
      avgMfe: signals.length > 0 ? signals.reduce((sum, s) => sum + (parseFloat(s.maxFavorableExcursionPct?.toString() ?? '0') || 0), 0) / signals.length : 0,
    };
  }

  async getStatsByStrategy(): Promise<Record<string, SignalStats>> {
    const strategies = await this.prisma.strategy.findMany({
      select: { id: true, name: true },
    });

    const stats: Record<string, SignalStats> = {};
    for (const strategy of strategies) {
      stats[strategy.name] = await this.getStats({ strategyId: strategy.id });
    }
    return stats;
  }

  async getStatsByTimeframe(): Promise<Record<string, SignalStats>> {
    const timeframes = ['5m', '15m', '1h', '4h', '1d'];
    const stats: Record<string, SignalStats> = {};
    for (const tf of timeframes) {
      stats[tf] = await this.getStats({ timeframe: tf });
    }
    return stats;
  }
}
