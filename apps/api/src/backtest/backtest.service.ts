import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RunBacktestDto } from './dto/run-backtest.dto';
import { MarketBacktestDto } from './dto/market-backtest.dto';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private prisma: PrismaService,
    private engine: EngineHttpService,
    private notifications: NotificationsService,
  ) {}

  async run(userId: string, dto: RunBacktestDto) {
    const strategy = await this.resolveStrategy(dto, userId);
    const payload: any = { ...dto };
    if (strategy) {
      payload.strategy = strategy;
    }
    delete payload.strategyId;

    const result: any = await this.engine.post('/backtest/run', payload, { timeout: 120_000 });
    this.notifications.push({
      userId,
      type: 'SYSTEM',
      title: `Backtest terminé — ${dto.symbol}`,
      message: `${result.trades ?? 0} trades · Win ${result.win_rate ?? 0}% · PnL ${(result.total_pnl_pct ?? 0).toFixed(2)}%`,
      data: { symbol: dto.symbol, timeframe: dto.timeframe, ...result },
    });
    return result;
  }

  async runMulti(userId: string, dtos: RunBacktestDto[]) {
    const requests = await Promise.all(
      dtos.map(async (dto) => {
        const strategy = await this.resolveStrategy(dto, userId);
        const payload: any = { ...dto };
        if (strategy) payload.strategy = strategy;
        delete payload.strategyId;
        return payload;
      }),
    );

    return this.engine.post('/backtest/multi', requests, { timeout: 120_000 });
  }

  async advancedMetrics(body: any) {
    return this.engine.get('/backtest/advanced-metrics', { timeout: 30_000 });
  }

  async patternStats(body: any) {
    return this.engine.post('/backtest/pattern-stats', body, { timeout: 120_000 });
  }

  async markers(userId: string, dto: RunBacktestDto) {
    const result: any = await this.run(userId, dto);
    return {
      klines: result.klines || [],
      signals: result.signals || [],
      bar_times: result.bar_times || [],
      summary: {
        total: result.trades,
        win_rate: result.win_rate,
        trade_list: result.trade_list || [],
      },
    };
  }

  async market(userId: string, name: string, dto: MarketBacktestDto) {
    const symbols = MARKET_SYMBOLS[name.toLowerCase()];
    if (!symbols || symbols.length === 0) {
      throw new NotFoundException(`Market ${name} not found`);
    }
    const strategy = await this.resolveStrategy(dto, userId);
    const base: any = { ...dto };
    if (strategy) base.strategy = strategy;
    delete base.strategyId;

    const requests = symbols.map((symbol) => ({ ...base, symbol }));
    const results: any[] = await this.engine.post('/backtest/multi', requests, { timeout: 300_000 });
    const profitable = results.filter((r: any) => (r.total_pnl_pct ?? 0) > 0).length;
    const best = results.reduce((best: any, r: any) => ((r.total_pnl_pct ?? -Infinity) > (best.total_pnl_pct ?? -Infinity) ? r : best), results[0] ?? {});
    this.notifications.push({
      userId,
      type: 'SYSTEM',
      title: `Batch ${name} terminé`,
      message: `${results.length} symboles · ${profitable} profitables · meilleur: ${best.symbol ?? '-'} ${(best.total_pnl_pct ?? 0).toFixed(2)}%`,
      data: { market: name, results },
    });
    return results;
  }

  private async resolveStrategy(dto: MarketBacktestDto, _userId: string) {
    if (dto.strategy) {
      return dto.strategy;
    }
    if (dto.strategyId) {
      const strategy = await this.prisma.strategy.findFirst({
        where: { id: dto.strategyId, isActive: true },
      });
      if (!strategy) {
        throw new NotFoundException(`Strategy ${dto.strategyId} not found or inactive`);
      }
      return {
        id: strategy.id,
        name: strategy.name,
        rules: strategy.rules ?? {},
      };
    }
    return null;
  }
}

const MARKET_SYMBOLS: Record<string, string[]> = {
  crypto: [
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AVAX/USDT',
    'ADA/USDT', 'DOT/USDT', 'LINK/USDT', 'MATIC/USDT', 'ATOM/USDT',
    'LTC/USDT', 'XRP/USDT', 'DOGE/USDT', 'TRX/USDT', 'TON/USDT',
  ],
  forex: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'USD/CAD', 'NZD/USD'],
  stocks: ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'INTC', 'JPM', 'BAC'],
  commodities: ['XAU/USD', 'XAG/USD', 'WTI/USD', 'BRENT/USD'],
  synthetic: ['V75', 'V100', 'BOOM500', 'CRASH500'],
};
