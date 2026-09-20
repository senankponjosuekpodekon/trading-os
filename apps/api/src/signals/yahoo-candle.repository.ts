import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Candle, CandleRepository } from './candle.repository';

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  'EUR/USD': 'EURUSD=X',
  'GBP/USD': 'GBPUSD=X',
  'USD/JPY': 'USDJPY=X',
  'XAU/USD': 'GC=F',
  'XAG/USD': 'SI=F',
  'AAPL': 'AAPL',
  'MSFT': 'MSFT',
  'GOOGL': 'GOOGL',
  'AMZN': 'AMZN',
  'TSLA': 'TSLA',
  'US30': '^DJI',
  'NAS100': '^IXIC',
  'SPX500': '^GSPC',
};

const YAHOO_TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

@Injectable()
export class YahooCandleRepository extends CandleRepository {
  private readonly logger = new Logger(YahooCandleRepository.name);

  constructor(private http: HttpService) {
    super();
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const yahooSymbol = YAHOO_SYMBOL_MAP[symbol] ?? symbol.replace('/', '');
    const interval = YAHOO_TIMEFRAME_MAP[timeframe] ?? '1h';
    const sinceMs = since.getTime();
    const nowMs = Date.now();

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&period1=${sinceMs}&period2=${nowMs}`;
      const { data } = await firstValueFrom(this.http.get(url, { timeout: 10000 }));

      const result = data?.chart?.result?.[0];
      if (!result?.timestamp) return [];

      const timestamps = result.timestamp;
      const quotes = result.indicators?.quote?.[0];
      if (!quotes) return [];

      return timestamps.map((ts: number, i: number) => ({
        openTime: ts * 1000,
        open: quotes.open?.[i] ?? 0,
        high: quotes.high?.[i] ?? 0,
        low: quotes.low?.[i] ?? 0,
        close: quotes.close?.[i] ?? 0,
      }))
      .filter((c: Candle) => c.open > 0)
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
