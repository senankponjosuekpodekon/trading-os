export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export abstract class CandleRepository {
  abstract getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]>;
  abstract getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]>;
}
