import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Candle, CandleRepository } from './candle.repository';

@Injectable()
export class LocalCandleRepository extends CandleRepository {
  private readonly logger = new Logger(LocalCandleRepository.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    try {
      const rows = await this.prisma.candle.findMany({
        where: {
          symbol,
          timeframe,
          openTime: { gte: since },
        },
        orderBy: { openTime: 'asc' },
      });
      return rows.map(r => ({
        openTime: r.openTime.getTime(),
        open: parseFloat(r.open.toString()),
        high: parseFloat(r.high.toString()),
        low: parseFloat(r.low.toString()),
        close: parseFloat(r.close.toString()),
      }));
    } catch (error) {
      this.logger.warn(`getSince failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  async store(symbol: string, timeframe: string, candles: Candle[]): Promise<void> {
    try {
      await this.prisma.candle.createMany({
        data: candles.map(c => ({
          symbol,
          timeframe,
          openTime: new Date(c.openTime),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn(`store failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
    }
  }

  async getLowerTimeframeWindow(
    symbol: string,
    timeframe: string,
    candleOpenTime: number,
  ): Promise<Candle[]> {
    // Calculer le timeframe inférieur
    const lowerTimeframe = this._getLowerTimeframe(timeframe);
    if (!lowerTimeframe) return [];

    // Fenêtre de la bougie supérieure
    const tfDuration = this._getTimeframeDuration(timeframe);
    const start = candleOpenTime;
    const end = candleOpenTime + tfDuration;

    try {
      const rows = await this.prisma.candle.findMany({
        where: {
          symbol,
          timeframe: lowerTimeframe,
          openTime: { gte: new Date(start), lt: new Date(end) },
        },
        orderBy: { openTime: 'asc' },
      });
      return rows.map(r => ({
        openTime: r.openTime.getTime(),
        open: parseFloat(r.open.toString()),
        high: parseFloat(r.high.toString()),
        low: parseFloat(r.low.toString()),
        close: parseFloat(r.close.toString()),
      }));
    } catch (error) {
      this.logger.warn(`getLowerTimeframeWindow failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  private _getLowerTimeframe(timeframe: string): string | null {
    const map: Record<string, string> = {
      '1h': '5m',
      '4h': '15m',
      '1d': '1h',
      '1w': '4h',
    };
    return map[timeframe] ?? null;
  }

  private _getTimeframeDuration(timeframe: string): number {
    const map: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[timeframe] ?? 60 * 60 * 1000;
  }
}
