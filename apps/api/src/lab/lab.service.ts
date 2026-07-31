import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLabSessionDto } from './dto/create-lab-session.dto';

export interface RunLabBacktestDto {
  lookback_bars?: number;
  initial_capital?: number;
  risk_pct?: number;
  min_confidence?: number;
}

@Injectable()
export class LabService {
  private readonly logger = new Logger(LabService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async createSession(userId: string, dto: CreateLabSessionDto) {
    return this.prisma.labSession.create({
      data: {
        userId,
        name: dto.name,
        symbol: dto.symbol,
        timeframe: dto.timeframe,
        strategy: dto.strategy ?? {},
        status: (dto.status as any) ?? 'DRAFT',
      },
    });
  }

  async findByUser(userId: string, status?: string) {
    const where: any = { userId };
    if (status) where.status = status;
    return this.prisma.labSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const session = await this.prisma.labSession.findFirst({ where: { id, userId } });
    if (!session) throw new NotFoundException('Lab session not found');
    return session;
  }

  async updateSession(userId: string, id: string, dto: Partial<CreateLabSessionDto>) {
    await this.findOne(userId, id);
    const data: any = { ...dto };
    if (dto.status) data.status = dto.status as any;
    return this.prisma.labSession.update({
      where: { id },
      data,
    });
  }

  async removeSession(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.labSession.delete({ where: { id } });
  }

  async runBacktest(userId: string, id: string, runDto: RunLabBacktestDto) {
    const session = await this.findOne(userId, id);
    await this.prisma.labSession.update({
      where: { id },
      data: { status: 'RUNNING' },
    });

    const payload = {
      symbol: session.symbol,
      timeframe: session.timeframe,
      lookback_bars: runDto.lookback_bars ?? 500,
      initial_capital: runDto.initial_capital ?? 10000,
      risk_pct: runDto.risk_pct ?? 1.0,
      min_confidence: runDto.min_confidence ?? 55.0,
      strategy: session.strategy as Record<string, any>,
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.engineUrl}/backtest/run`, payload),
      );

      const metrics = {
        win_rate: data.win_rate,
        total_pnl: data.total_pnl,
        total_pnl_pct: data.total_pnl_pct,
        max_drawdown: data.max_drawdown,
        max_drawdown_pct: data.max_drawdown_pct,
        sharpe_ratio: data.sharpe_ratio,
        profit_factor: data.profit_factor,
        expectancy: data.expectancy,
        trades: data.trades,
        final_capital: data.final_capital,
        benchmark_pnl_pct: data.benchmark_pnl_pct,
        outperformance_pct: data.outperformance_pct,
      };

      const updated = await this.prisma.labSession.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          backtestMetrics: metrics as any,
          tradeList: data.trade_list as any,
        },
      });

      return { session: updated, metrics, tradeCount: data.trade_list?.length ?? 0 };
    } catch (e: any) {
      await this.prisma.labSession.update({
        where: { id },
        data: { status: 'DRAFT' },
      });
      this.logger.warn(`Lab backtest failed for session ${id}: ${e?.message}`);
      throw e;
    }
  }

  async evaluate(userId: string, id: string) {
    const session = await this.findOne(userId, id);
    const metrics = session.backtestMetrics as any;
    if (!metrics) return { score: null, verdict: 'NO_DATA', metrics: null };

    let score = 0;
    if (metrics.profit_factor > 1.5) score += 2;
    else if (metrics.profit_factor > 1.2) score += 1;

    if (metrics.win_rate > 55) score += 2;
    else if (metrics.win_rate > 45) score += 1;

    if (metrics.expectancy > 0.5) score += 2;
    else if (metrics.expectancy > 0) score += 1;

    if (metrics.max_drawdown_pct < 10) score += 2;
    else if (metrics.max_drawdown_pct < 20) score += 1;

    if (metrics.sharpe_ratio > 1.0) score += 1;

    let verdict = 'REJECT';
    if (score >= 7) verdict = 'STRONG';
    else if (score >= 5) verdict = 'PROMISING';
    else if (score >= 3) verdict = 'MARGINAL';

    return { score, verdict, metrics };
  }

  getStrategyTemplates() {
    return [
      {
        id: 'trend_following',
        name: 'Trend Following',
        description: 'Entrée sur pull-back EMA20 dans le trend, sortie SL1.5xATR / TP2.5xATR.',
        strategy: {
          rules: {
            ema_fast: 20,
            ema_slow: 50,
            ema_trend: 200,
            use_price_action: true,
            use_sr_zones: true,
            use_patterns: true,
            min_confidence: 55,
            trigger: 'pullback_ema20',
            exit_rules: { sl_atr: 1.5, tp1_atr: 2.5, tp2_atr: 4.0 },
            filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR'] },
          },
        },
      },
      {
        id: 'breakout_smc',
        name: 'Breakout SMC',
        description: 'Breakout d\'un swing high/low validé par un order block et volume croissant.',
        strategy: {
          rules: {
            ema_fast: 9,
            ema_slow: 21,
            ema_trend: 50,
            use_price_action: true,
            use_sr_zones: false,
            use_patterns: true,
            min_confidence: 60,
            volume_spike_min: 1.5,
            trigger: 'breakout',
            exit_rules: { sl_atr: 1.0, tp1_atr: 2.0, tp2_atr: 3.0 },
            filters: { regime: ['TRENDING_BULL', 'TRENDING_BEAR', 'VOLATILE'] },
          },
        },
      },
      {
        id: 'range_mean_reversion',
        name: 'Range Mean Reversion',
        description: 'Achat sur support / vente sur résistance dans un range identifié.',
        strategy: {
          rules: {
            ema_fast: 20,
            ema_slow: 50,
            ema_trend: 100,
            rsi_oversold: 35,
            rsi_overbought: 65,
            use_price_action: true,
            use_sr_zones: true,
            use_patterns: false,
            min_confidence: 50,
            trigger: 'mean_reversion',
            exit_rules: { sl_atr: 1.0, tp1_atr: 1.8, tp2_atr: 2.5 },
            filters: { regime: ['RANGING'] },
          },
        },
      },
    ];
  }

  async generateReport(userId: string, id: string): Promise<any> {
    const session = await this.findOne(userId, id);
    const metrics = session.backtestMetrics as any;
    const trades = (session.tradeList as any[]) ?? [];

    if (!metrics || trades.length === 0) {
      return { error: 'NO_DATA', message: 'Aucun backtest completé pour cette session.' };
    }

    const wins = trades.filter(t => t.win);
    const losses = trades.filter(t => !t.win);

    const avgHoldBars = Math.round(
      trades.reduce((sum, t) => sum + (t.exit_bar - t.entry_bar), 0) / trades.length,
    );
    const bestTrade = trades.reduce((best, t) => (t.pnl_pct > best.pnl_pct ? t : best), trades[0]);
    const worstTrade = trades.reduce((worst, t) => (t.pnl_pct < worst.pnl_pct ? t : worst), trades[0]);

    const reasonCounts: Record<string, number> = {};
    for (const t of trades) {
      for (const r of t.signal_reasons ?? []) {
        reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
      }
    }

    let maxStreak = 0;
    let currentStreak = 0;
    for (const t of trades) {
      if (t.win) {
        currentStreak += 1;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    const report = {
      sessionName: session.name,
      symbol: session.symbol,
      timeframe: session.timeframe,
      strategy: session.strategy,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTrades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: metrics.win_rate,
        profitFactor: metrics.profit_factor,
        expectancy: metrics.expectancy,
        maxDrawdownPct: metrics.max_drawdown_pct,
        sharpeRatio: metrics.sharpe_ratio,
        outperformancePct: metrics.outperformance_pct,
      },
      marketConditions: {
        strategyType: (session.strategy as any)?.type ?? 'unknown',
        filters: (session.strategy as any)?.filters ?? [],
        exitRules: (session.strategy as any)?.exit ?? {},
      },
      tradeDetails: trades.map((t, i) => ({
        index: i + 1,
        direction: t.direction,
        entryBar: t.entry_bar,
        exitBar: t.exit_bar,
        holdBars: t.exit_bar - t.entry_bar,
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        pnlPct: t.pnl_pct,
        pnl: t.pnl,
        confidence: t.confidence,
        rrAchieved: t.rr_achieved,
        exitReason: t.exit_reason,
        signalReasons: t.signal_reasons ?? [],
      })),
      statistics: {
        avgHoldBars,
        bestTradePct: bestTrade.pnl_pct,
        worstTradePct: worstTrade.pnl_pct,
        maxWinStreak: maxStreak,
        reasonDistribution: reasonCounts,
      },
      recommendations: this._buildRecommendations(metrics, wins.length, losses.length, avgHoldBars),
    };

    return report;
  }

  walkForwardAnalysis(userId: string, id: string) {
    const session = this.findOne(userId, id);
    // returned promise; we then work with session data below
    return session.then(s => {
      const trades = (s.tradeList as any[]) ?? [];
      const metrics = s.backtestMetrics as any;
      if (!metrics || trades.length < 4) {
        return { error: 'INSUFFICIENT_DATA', message: 'Au moins 4 trades sont nécessaires pour une analyse walk-forward.' };
      }

      const mid = Math.floor(trades.length / 2);
      const inSample = trades.slice(0, mid);
      const outOfSample = trades.slice(mid);

      const compute = (list: any[]) => {
        const wins = list.filter(t => t.win);
        const losses = list.filter(t => !t.win);
        const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
        const totalPnlPct = list.reduce((sum, t) => sum + t.pnl_pct, 0);
        return {
          trades: list.length,
          wins: wins.length,
          losses: losses.length,
          winRate: list.length ? (wins.length / list.length) * 100 : 0,
          profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 99,
          expectancy: list.length ? totalPnlPct / list.length : 0,
          totalPnlPct,
        };
      };

      const is = compute(inSample);
      const oos = compute(outOfSample);

      const winRateDecay = is.winRate - oos.winRate;
      const profitFactorDecay = is.profitFactor - oos.profitFactor;
      const expectancyDecay = is.expectancy - oos.expectancy;

      let overfitScore = 0;
      if (winRateDecay > 10) overfitScore += 1;
      if (profitFactorDecay > 0.3) overfitScore += 1;
      if (expectancyDecay > 0.3) overfitScore += 1;
      if (oos.winRate < 40 && is.winRate > 50) overfitScore += 1;

      const verdict =
        overfitScore === 0 ? 'ROBUST' :
        overfitScore <= 1 ? 'MILD_OVERFIT' :
        overfitScore <= 2 ? 'MODERATE_OVERFIT' :
        'SEVERE_OVERFIT';

      return {
        inSample: is,
        outOfSample: oos,
        decay: { winRateDecay, profitFactorDecay, expectancyDecay },
        overfitScore,
        verdict,
      };
    });
  }

  async promoteToProduction(userId: string, id: string) {
    const session = await this.findOne(userId, id);
    if (session.status !== 'COMPLETED') {
      return { error: 'NOT_COMPLETED', message: 'Le backtest doit être terminé pour promouvoir la stratégie.' };
    }
    const metrics = session.backtestMetrics as any;
    if (!metrics || metrics.profit_factor < 1.2 || metrics.win_rate < 45) {
      return { error: 'WEAK_PERFORMANCE', message: 'La stratégie doit avoir profit_factor >= 1.2 et win_rate >= 45%.' };
    }

    const baseName = session.name.replace(/\s*\(Lab\)$/i, '');
    let name = `${baseName} (Lab)`;
    let suffix = 1;
    while (await this.prisma.strategy.findUnique({ where: { name } })) {
      suffix += 1;
      name = `${baseName} (Lab ${suffix})`;
    }

    const strategy = await this.prisma.strategy.create({
      data: {
        name,
        description: `Stratégie promue depuis la session Lab "${session.name}" pour ${session.symbol} (${session.timeframe}).`,
        rules: session.strategy as any,
        analysisTimeframe: session.timeframe,
        entryTimeframe: session.timeframe,
        isActive: false,
      },
    });

    await this.prisma.labSession.update({
      where: { id },
      data: { status: 'ARCHIVED' as any },
    });

    return { promoted: true, strategyId: strategy.id, name: strategy.name };
  }

  private _buildRecommendations(metrics: any, wins: number, losses: number, avgHoldBars: number) {
    const recs: string[] = [];
    if (metrics.profit_factor < 1.2) {
      recs.push('Profit factor faible : envisager un filtre de tendance ou un R/R minimum plus strict.');
    }
    if (metrics.win_rate < 45) {
      recs.push('Win rate sous 45% : privilégier les signaux avec confidence > 70 ou ajouter un filtre de confirmation.');
    }
    if (metrics.max_drawdown_pct > 20) {
      recs.push('Drawdown élevé : réduire le sizing ou ajouter un stop-loss de portefeuille.');
    }
    if (metrics.sharpe_ratio < 1) {
      recs.push('Sharpe < 1 : la stratégie est trop volatile par rapport au rendement.');
    }
    if (avgHoldBars < 3) {
      recs.push('Durée moyenne des trades très courte : vérifier les faux signaux en scalping.');
    }
    if (wins > 0 && losses > 0 && wins / (wins + losses) > 0.6 && metrics.profit_factor < 1.3) {
      recs.push('Bonne précision mais profit factor faible : les pertes sont trop grandes vs les gains.');
    }
    if (recs.length === 0) recs.push('La stratégie semble robuste sur la période testée.');
    return recs;
  }

  profileSuitability(
    metrics: any,
    profile: { riskLevel: 'conservative' | 'moderate' | 'aggressive'; maxDrawdownPct?: number; minWinRate?: number; minSharpe?: number },
  ) {
    if (!metrics) return { suitable: false, reasons: ['NO_DATA'] };

    const { riskLevel, maxDrawdownPct, minWinRate, minSharpe } = profile;
    const reasons: string[] = [];

    const drawdownOk =
      maxDrawdownPct === undefined || (metrics.max_drawdown_pct ?? 100) <= maxDrawdownPct;
    if (!drawdownOk) reasons.push(`max_drawdown_pct ${metrics.max_drawdown_pct}% exceeds ${maxDrawdownPct}%`);

    const winRateOk =
      minWinRate === undefined || (metrics.win_rate ?? 0) >= minWinRate;
    if (!winRateOk) reasons.push(`win_rate ${metrics.win_rate}% below ${minWinRate}%`);

    const sharpeOk =
      minSharpe === undefined || (metrics.sharpe_ratio ?? 0) >= minSharpe;
    if (!sharpeOk) reasons.push(`sharpe_ratio ${metrics.sharpe_ratio} below ${minSharpe}`);

    let riskOk = false;
    if (riskLevel === 'conservative') {
      riskOk =
        (metrics.max_drawdown_pct ?? 100) <= 10 &&
        (metrics.profit_factor ?? 0) >= 1.5 &&
        (metrics.win_rate ?? 0) >= 50;
      if (!riskOk) reasons.push('conservative profile requires dd<=10%, pf>=1.5, wr>=50%');
    } else if (riskLevel === 'moderate') {
      riskOk =
        (metrics.max_drawdown_pct ?? 100) <= 20 &&
        (metrics.profit_factor ?? 0) >= 1.3 &&
        (metrics.win_rate ?? 0) >= 45;
      if (!riskOk) reasons.push('moderate profile requires dd<=20%, pf>=1.3, wr>=45%');
    } else {
      riskOk =
        (metrics.max_drawdown_pct ?? 100) <= 35 &&
        (metrics.profit_factor ?? 0) >= 1.1;
      if (!riskOk) reasons.push('aggressive profile requires dd<=35%, pf>=1.1');
    }

    const suitable = drawdownOk && winRateOk && sharpeOk && riskOk;
    return { suitable, riskLevel, reasons: reasons.length ? reasons : undefined };
  }

  async compareSessions(userId: string, ids: string[]) {
    const sessions = await this.prisma.labSession.findMany({
      where: { id: { in: ids }, userId },
      orderBy: { createdAt: 'asc' },
    });

    const scored = sessions.map((session) => {
      const m = (session.backtestMetrics as any) ?? {};
      const winRate = m.win_rate ?? 0;
      const pf = m.profit_factor ?? 0;
      const sharpe = m.sharpe_ratio ?? 0;
      const dd = m.max_drawdown_pct ?? 0;
      const score =
        winRate * 0.5 +
        Math.min(pf, 3) / 3 * 30 +
        Math.min(sharpe, 2) / 2 * 20 -
        dd * 0.5;
      return {
        id: session.id,
        name: session.name,
        status: session.status,
        score: Math.round(score * 100) / 100,
        metrics: m,
      };
    });

    const ranked = scored.sort((a, b) => b.score - a.score);
    const winner = ranked[0] ?? null;

    return {
      count: sessions.length,
      winnerId: winner?.id ?? null,
      sessions: ranked,
    };
  }
}
