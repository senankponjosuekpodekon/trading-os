import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { engineHeaders } from '../utils/engine-headers.util';
import { Candle, CandleRepository } from './candle.repository';

@Injectable()
export class EngineCandleRepository extends CandleRepository {
  private readonly logger = new Logger(EngineCandleRepository.name);
  private engineUrl: string;

  constructor(private http: HttpService, private config: ConfigService) {
    super();
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const url = `${this.engineUrl}/candles/${encodeURIComponent(symbol)}?timeframe=${timeframe}&limit=200`;
    try {
      const { data } = await firstValueFrom(this.http.get(url, { headers: engineHeaders(this.config) }));
      const candles = Array.isArray(data) ? data : (data?.candles ?? []);
      const sinceMs = since.getTime();
      return candles
        .map((c: any) => ({
          openTime: typeof c.timestamp === 'number' ? c.timestamp * 1000 : new Date(c.timestamp ?? c.time ?? c.date).getTime(),
          open: parseFloat(c.open ?? c.o),
          high: parseFloat(c.high ?? c.h),
          low: parseFloat(c.low ?? c.l),
          close: parseFloat(c.close ?? c.c),
        }))
        .filter((c: Candle) => c.openTime >= sinceMs)
        .sort((a: Candle, b: Candle) => a.openTime - b.openTime);
    } catch (error) {
      this.logger.warn(`getSince failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  async getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]> {
    return this.getSince(symbol, '1m', new Date(candleOpenTime - 3_600_000));
  }
}
