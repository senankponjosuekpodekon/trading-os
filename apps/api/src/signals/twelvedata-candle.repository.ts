import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleRepository } from './candle.repository';

const TWELVEDATA_SYMBOL_MAP: Record<string, string> = {
  'EUR/USD': 'EUR/USD',
  'GBP/USD': 'GBP/USD',
  'USD/JPY': 'USD/JPY',
  'XAU/USD': 'XAU/USD',
  'XAG/USD': 'XAG/USD',
  'WTI/USD': 'WTI/USD',
  'BRENT/USD': 'BRENT/USD',
  'AAPL': 'AAPL',
  'MSFT': 'MSFT',
  'GOOGL': 'GOOGL',
  'AMZN': 'AMZN',
  'TSLA': 'TSLA',
  'US30': 'DJI',
  'NAS100': 'IXIC',
  'SPX500': 'GSPC',
};

const TWELVEDATA_TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
};

@Injectable()
export class TwelveDataCandleRepository extends CandleRepository {
  private readonly logger = new Logger(TwelveDataCandleRepository.name);
  private apiKey: string;

  constructor(private http: HttpService, private config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('TWELVE_DATA_API_KEY', '');
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    if (!this.apiKey) {
      this.logger.warn('TWELVE_DATA_API_KEY not set');
      return [];
    }

    const tdSymbol = TWELVEDATA_SYMBOL_MAP[symbol] ?? symbol.replace('/', '/');
    const interval = TWELVEDATA_TIMEFRAME_MAP[timeframe] ?? '1h';
    const sinceMs = since.getTime();

    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=5000&apikey=${this.apiKey}&format=JSON&order=ASC`;
      const { data } = await firstValueFrom(this.http.get(url, { timeout: 10000 }));

      if (!data?.values) return [];

      return data.values
        .map((c: any) => ({
          openTime: new Date(c.datetime).getTime(),
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
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
