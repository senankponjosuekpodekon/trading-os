import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private prisma: PrismaService,
    private engine: EngineHttpService,
  ) {}

  async run(userId: string, dto: RunBacktestDto) {
    const strategy = await this.resolveStrategy(dto, userId);
    const payload: any = { ...dto };
    if (strategy) {
      payload.strategy = strategy;
    }
    delete payload.strategyId;

    return this.engine.post('/backtest/run', payload, { timeout: 120_000 });
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
    const trades: any[] = result.trade_list || [];
    const markers = trades.flatMap((trade) => {
      const common = { direction: trade.direction };
      return [
        {
          ...common,
          type: 'entry',
          bar: trade.entry_bar,
          price: trade.entry_price,
        },
        {
          ...common,
          type: 'sl',
          bar: trade.entry_bar,
          price: trade.stop_loss,
        },
        {
          ...common,
          type: 'tp',
          bar: trade.entry_bar,
          price: trade.take_profit,
        },
        {
          ...common,
          type: 'exit',
          bar: trade.exit_bar,
          price: trade.exit_price,
          exit_reason: trade.exit_reason,
          intrabar_ambiguous: trade.intrabar_ambiguous,
        },
      ];
    });

    return { markers, summary: { total: result.trades, win_rate: result.win_rate, trades: trades.map((t) => ({ ...t, stop_loss: t.stop_loss, take_profit: t.take_profit })) } };
  }

  private async resolveStrategy(dto: RunBacktestDto, _userId: string) {
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
