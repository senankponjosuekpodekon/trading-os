import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { engineHeaders } from '../utils/engine-headers.util';
import { Candle, CandleRepository } from './candle.repository';
import { LocalCandleRepository } from './local-candle.repository';

@Injectable()
export class EngineCandleRepository extends CandleRepository {
  private readonly logger = new Logger(EngineCandleRepository.name);
  private engineUrl: string;

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private localRepo: LocalCandleRepository,
  ) {
    super();
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const sinceMs = since.getTime();
    const nowMs = Date.now();
    const url = `${this.engineUrl}/candles/${encodeURIComponent(symbol)}/history?timeframe=${timeframe}&start=${sinceMs}&end=${nowMs}`;
    try {
      const { data } = await firstValueFrom(this.http.get(url, { headers: engineHeaders(this.config) }));
      const candles = Array.isArray(data) ? data : (data?.candles ?? []);
      const mapped = candles
        .map((c: any) => ({
          openTime: typeof c.timestamp === 'number' ? c.timestamp * 1000 : new Date(c.timestamp ?? c.time ?? c.date).getTime(),
          open: parseFloat(c.open ?? c.o),
          high: parseFloat(c.high ?? c.h),
          low: parseFloat(c.low ?? c.l),
          close: parseFloat(c.close ?? c.c),
        }))
        .filter((c: Candle) => c.openTime >= sinceMs)
        .sort((a: Candle, b: Candle) => a.openTime - b.openTime);

      // Stocker les candles localement pour le futur
      await this.localRepo.store(symbol, timeframe, mapped);

      return mapped;
    } catch (error) {
      this.logger.warn(`getSince failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  async getDerivHistory(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const sinceMs = since.getTime();
    const url = `${this.engineUrl}/candles/${encodeURIComponent(symbol)}/deriv-history?timeframe=${timeframe}&start=${sinceMs}`;
    try {
      const { data } = await firstValueFrom(this.http.get(url, { headers: engineHeaders(this.config) }));
      const candles = Array.isArray(data) ? data : (data?.candles ?? []);
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
      this.logger.warn(`getDerivHistory failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  async getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]> {
    return this.getSince(symbol, '1m', new Date(candleOpenTime - 3_600_000));
  }
}
