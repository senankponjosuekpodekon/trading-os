import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleRepository } from './candle.repository';

const ALPHAVANTAGE_SYMBOL_MAP: Record<string, string> = {
  'XAG/USD': 'XAGUSD',
  'XAU/USD': 'XAUUSD',
  'EUR/USD': 'EURUSD',
  'GBP/USD': 'GBPUSD',
  'USD/JPY': 'USDJPY',
  'WTI/USD': 'WTI',
  'BRENT/USD': 'BRENT',
};

const ALPHAVANTAGE_TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '60min',
  '4h': '60min',
  '1d': 'daily',
};

@Injectable()
export class AlphaVantageCandleRepository extends CandleRepository {
  private readonly logger = new Logger(AlphaVantageCandleRepository.name);
  private apiKey: string;

  constructor(private http: HttpService, private config: ConfigService) {
    super();
    this.apiKey = this.config.get<string>('ALPHA_VANTAGE_API_KEY', '');
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    if (!this.apiKey) {
      this.logger.warn('ALPHA_VANTAGE_API_KEY not set');
      return [];
    }

    const avSymbol = ALPHAVANTAGE_SYMBOL_MAP[symbol] ?? symbol.replace('/', '');
    const interval = ALPHAVANTAGE_TIMEFRAME_MAP[timeframe] ?? '60min';
    const sinceMs = since.getTime();

    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${avSymbol}&interval=${interval}&outputsize=full&apikey=${this.apiKey}`;
      const { data } = await firstValueFrom(this.http.get(url, { timeout: 10000 }));

      const key = `Time Series (${interval})`;
      const candles = data?.[key];
      if (!candles) return [];

      return Object.entries(candles)
        .map(([datetime, values]: [string, any]) => ({
          openTime: new Date(datetime).getTime(),
          open: parseFloat(values['1. open']),
          high: parseFloat(values['2. high']),
          low: parseFloat(values['3. low']),
          close: parseFloat(values['4. close']),
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
