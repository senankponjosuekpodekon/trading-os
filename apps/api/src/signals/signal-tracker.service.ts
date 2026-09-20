import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SignalExecutionService } from './signal-execution.service';
import { CandleRepository, Candle as RepoCandle } from './candle.repository';
import { resolveIntrabarOrder, Candle, Direction, PriceLevels, TouchType } from './intrabar-resolution';
import { deriveSignalOutcome, computeMaxAdverseExcursion, SignalExecutionStatus } from './signal-status';
import { SignalExecutionStatus as PrismaSignalExecutionStatus } from '@prisma/client';

const DEFAULT_PARTIAL_EXIT_PCT = 33.3;

@Injectable()
export class SignalTrackerService {
  private readonly logger = new Logger(SignalTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('CandleRepository') private readonly candles: CandleRepository,
    private readonly executionService: SignalExecutionService,
  ) {}

  async processActiveSignals(limit = 200): Promise<void> {
    const active = await this.prisma.signal.findMany({
      where: { executionStatus: { in: ['PENDING', 'ACTIVE'] } },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    this.logger.log(`Backfill ${active.length} signaux à traiter`);

    for (let i = 0; i < active.length; i++) {
      try {
        await this.processSignal(active[i].id);
      } catch (err) {
        this.logger.error(`Échec du tracking pour le signal ${active[i].id}`, err as Error);
      }
      if ((i + 1) % 10 === 0 || i === active.length - 1) {
        this.logger.log(`Backfill ${i + 1}/${active.length} terminé`);
      }
    }
  }

  async processSignal(signalId: string): Promise<void> {
    const signal = await this.prisma.signal.findUniqueOrThrow({
      where: { id: signalId },
      include: { executionEvents: true, asset: true },
    });

    if (['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_BREAKEVEN', 'EXPIRED'].includes(signal.executionStatus)) {
      return;
    }

    const since = signal.lastProcessedCandle ?? signal.createdAt;
    const newCandles = (await this.candles.getSince(signal.asset.symbol, signal.timeframe, since)) as RepoCandle[];
    if (newCandles.length === 0) return;

    const direction: Direction = signal.signal === 'BUY' ? 'LONG' : 'SHORT';
    let entryAlreadyHit = signal.executionEvents.some((e) => e.type === 'ENTRY_HIT');
    const currentSL = Number(signal.currentStopLoss ?? signal.stopLoss);
    const takeProfits = [signal.takeProfit1, signal.takeProfit2, signal.takeProfit3]
      .filter((v) => v != null)
      .map(Number);
    let worstPrice = signal.worstExcursionPrice != null ? Number(signal.worstExcursionPrice) : null;

    const entryLow = signal.entryPrice ? Number(signal.entryPrice) : 0;
    const entryHigh = signal.entryPrice ? Number(signal.entryPrice) : 0;

    for (const raw of newCandles) {
      const candle: Candle = { openTime: raw.openTime, open: raw.open, high: raw.high, low: raw.low, close: raw.close };

      await this.prisma.$transaction(async (tx) => {
        if (!entryAlreadyHit && signal.expiresAt && candle.openTime >= signal.expiresAt.getTime()) {
          await tx.signalExecutionEvent.create({
            data: { signalId, type: 'EXPIRED', price: candle.close, candleTime: new Date(candle.openTime), candleTimeframe: signal.timeframe },
          });
          await tx.signal.update({ where: { id: signalId }, data: { executionStatus: 'EXPIRED', lastProcessedCandle: new Date(candle.openTime) } });
          return;
        }

        if (!entryAlreadyHit) {
          const entryTouched = candle.low <= entryHigh && candle.high >= entryLow;
          if (entryTouched) {
            await tx.signalExecutionEvent.create({
              data: { signalId, type: 'ENTRY_HIT', price: candle.close, candleTime: new Date(candle.openTime), candleTimeframe: signal.timeframe },
            });
            entryAlreadyHit = true;
            worstPrice = candle.close;
            await tx.signal.update({ where: { id: signalId }, data: { executionStatus: 'ACTIVE', worstExcursionPrice: candle.close } });
          }
          await tx.signal.update({ where: { id: signalId }, data: { lastProcessedCandle: new Date(candle.openTime) } });
          return;
        }

        const adverseCandidate = direction === 'LONG' ? candle.low : candle.high;
        if (worstPrice === null || (direction === 'LONG' ? adverseCandidate < worstPrice : adverseCandidate > worstPrice)) {
          worstPrice = adverseCandidate;
          await tx.signal.update({ where: { id: signalId }, data: { worstExcursionPrice: worstPrice } });
        }

        const levels: PriceLevels = { entryLow, entryHigh, stopLoss: currentSL, takeProfits };
        const lowerTf = await this.candles.getLowerTimeframeWindow?.(signal.asset.symbol, signal.timeframe, candle.openTime);
        const result = resolveIntrabarOrder(direction, levels, candle, lowerTf as Candle[] | undefined);

        for (const touch of result.order) {
          const type = (touch === 'SL' ? 'SL_HIT' : `${touch}_HIT`) as 'SL_HIT' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT';
          const price = touch === 'SL' ? currentSL : takeProfits[Number(touch.replace('TP', '')) - 1];
          await tx.signalExecutionEvent.create({
            data: {
              signalId,
              type,
              price,
              sizePct: touch === 'SL' ? 100 : DEFAULT_PARTIAL_EXIT_PCT,
              candleTime: new Date(candle.openTime),
              candleTimeframe: signal.timeframe,
              resolvedBy: result.method,
            },
          });
          if (touch === 'SL') break;
        }

        await tx.signal.update({ where: { id: signalId }, data: { lastProcessedCandle: new Date(candle.openTime) } });
      });
    }

    await this.recalculateOutcome(signalId, direction, worstPrice, newCandles);
  }

  private async recalculateOutcome(signalId: string, direction: Direction, worstPrice: number | null, candles: RepoCandle[]): Promise<void> {
    const updated = await this.prisma.signal.findUniqueOrThrow({ where: { id: signalId }, include: { executionEvents: true } });
    const entryEvent = updated.executionEvents.find((e) => e.type === 'ENTRY_HIT');
    if (!entryEvent) return;

    const outcome = deriveSignalOutcome(Number(entryEvent.price), direction, updated.executionEvents as any);
    const mae = worstPrice !== null ? computeMaxAdverseExcursion(Number(entryEvent.price), direction, worstPrice) : null;

    // Calculer MFE (Maximum Favorable Excursion) — prix le plus favorable atteint
    const favorablePrice = direction === 'LONG'
      ? Math.max(...candles.map(c => c.high))
      : Math.min(...candles.map(c => c.low));
    const mfe = direction === 'LONG'
      ? ((favorablePrice - Number(entryEvent.price)) / Number(entryEvent.price)) * 100
      : ((Number(entryEvent.price) - favorablePrice) / Number(entryEvent.price)) * 100;

    await this.prisma.signal.update({
      where: { id: signalId },
      data: {
        executionStatus: outcome.status as PrismaSignalExecutionStatus,
        ...(outcome.pnlPct !== null ? { finalPnlPct: outcome.pnlPct } : {}),
        ...(mae !== null ? { maxAdverseExcursionPct: mae } : {}),
        maxFavorableExcursionPct: mfe,
      },
    });
  }
}
