import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleRepository } from './candle.repository';

const SYMBOL_MAP: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT',
  'ETH/USDT': 'ETHUSDT',
  'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT',
};

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

@Injectable()
export class BinanceCandleRepository extends CandleRepository {
  private readonly logger = new Logger(BinanceCandleRepository.name);

  constructor(private http: HttpService) {
    super();
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const binanceSymbol = SYMBOL_MAP[symbol] ?? symbol.replace('/', '');
    const interval = TIMEFRAME_MAP[timeframe] ?? '1h';
    const sinceMs = since.getTime();

    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=1000&startTime=${sinceMs}`;
      const { data } = await firstValueFrom(this.http.get(url, { timeout: 10000 }));

      if (!Array.isArray(data)) return [];

      return data
        .map((c: any) => ({
          openTime: c[0],
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
        }))
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
