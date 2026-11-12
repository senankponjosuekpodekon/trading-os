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
  'WTI/USD': 'CL=F',
  'BRENT/USD': 'BZ=F',
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
  // Yahoo ne supporte pas 4h → on récupère en 1h et on agrège en aval
  '4h': '1h',
  '1d': '1d',
};

@Injectable()
export class YahooCandleRepository extends CandleRepository {
  private readonly logger = new Logger(YahooCandleRepository.name);
  private lastCall = 0;
  private readonly minDelay = 5000; // 5s entre les requêtes — évite le rate limit

  constructor(private http: HttpService) {
    super();
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    const yahooSymbol = YAHOO_SYMBOL_MAP[symbol] ?? symbol.replace('/', '');
    const interval = YAHOO_TIMEFRAME_MAP[timeframe] ?? '1h';
    // Yahoo attend period1/period2 en secondes epoch, pas en millisecondes
    const sinceSec = Math.floor(since.getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);

    // Rate limit: attendre si nécessaire
    const elapsed = Date.now() - this.lastCall;
    if (elapsed < this.minDelay) {
      await new Promise(resolve => setTimeout(resolve, this.minDelay - elapsed));
    }
    this.lastCall = Date.now();

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&period1=${sinceSec}&period2=${nowSec}`;
      const { data } = await firstValueFrom(this.http.get(url, { timeout: 10000 }));

      const result = data?.chart?.result?.[0];
      if (!result?.timestamp) return [];

      const timestamps = result.timestamp;
      const quotes = result.indicators?.quote?.[0];
      if (!quotes) return [];

      const candles = timestamps.map((ts: number, i: number) => ({
        openTime: ts * 1000,
        open: quotes.open?.[i] ?? 0,
        high: quotes.high?.[i] ?? 0,
        low: quotes.low?.[i] ?? 0,
        close: quotes.close?.[i] ?? 0,
      }))
      .filter((c: Candle) => c.open > 0)
      .sort((a: Candle, b: Candle) => a.openTime - b.openTime);

      // Yahoo n'a pas de 4h natif : on a fetché en 1h, on regroupe par fenêtre de 4h
      if (timeframe === '4h') {
        const buckets = new Map<number, Candle>();
        for (const c of candles) {
          const bucket = Math.floor(c.openTime / 14_400_000) * 14_400_000;
          const prev = buckets.get(bucket);
          if (prev) {
            prev.high = Math.max(prev.high, c.high);
            prev.low = Math.min(prev.low, c.low);
            prev.close = c.close;
          } else {
            buckets.set(bucket, { ...c, openTime: bucket });
          }
        }
        return [...buckets.values()].sort((a, b) => a.openTime - b.openTime);
      }

      return candles;
    } catch (error) {
      this.logger.warn(`getSince failed for ${symbol} ${timeframe}: ${(error as Error)?.message}`);
      return [];
    }
  }

  async getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]> {
    return this.getSince(symbol, '1m', new Date(candleOpenTime - 3_600_000));
  }
}
