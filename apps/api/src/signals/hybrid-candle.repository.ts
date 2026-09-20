import { Injectable, Logger } from '@nestjs/common';
import { Candle, CandleRepository } from './candle.repository';
import { LocalCandleRepository } from './local-candle.repository';
import { EngineCandleRepository } from './engine-candle.repository';
import { BinanceCandleRepository } from './binance-candle.repository';
import { YahooCandleRepository } from './yahoo-candle.repository';
import { TwelveDataCandleRepository } from './twelvedata-candle.repository';
import { AlphaVantageCandleRepository } from './alphavantage-candle.repository';

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC', 'NEAR'];

function isCrypto(symbol: string): boolean {
  const base = symbol.split('/')[0];
  return CRYPTO_SYMBOLS.includes(base);
}

@Injectable()
export class HybridCandleRepository extends CandleRepository {
  private readonly logger = new Logger(HybridCandleRepository.name);

  constructor(
    private localRepo: LocalCandleRepository,
    private engineRepo: EngineCandleRepository,
    private binanceRepo: BinanceCandleRepository,
    private yahooRepo: YahooCandleRepository,
    private twelveDataRepo: TwelveDataCandleRepository,
    private alphaVantageRepo: AlphaVantageCandleRepository,
  ) {
    super();
  }

  async getSince(symbol: string, timeframe: string, since: Date): Promise<Candle[]> {
    // 1. Essayer le cache local
    const local = await this.localRepo.getSince(symbol, timeframe, since);
    if (local.length > 0) {
      this.logger.log(`Cache hit: ${local.length} candles for ${symbol} ${timeframe}`);
      return local;
    }

    // 2. Essayer l'engine (live)
    const engine = await this.engineRepo.getSince(symbol, timeframe, since);
    if (engine.length > 0) {
      this.logger.log(`Engine hit: ${engine.length} candles for ${symbol} ${timeframe}`);
      return engine;
    }

    // 3. Fallback sur le bon provider selon le marché
    if (isCrypto(symbol)) {
      this.logger.log(`Binance fallback for ${symbol} ${timeframe}`);
      const candles = await this.binanceRepo.getSince(symbol, timeframe, since);
      if (candles.length > 0) {
        await this.localRepo.store(symbol, timeframe, candles);
      }
      return candles;
    }

    // Non-crypto: essayer Twelve Data, puis Alpha Vantage, puis Yahoo
    this.logger.log(`TwelveData fallback for ${symbol} ${timeframe}`);
    const twelveData = await this.twelveDataRepo.getSince(symbol, timeframe, since);
    if (twelveData.length > 0) {
      await this.localRepo.store(symbol, timeframe, twelveData);
      return twelveData;
    }

    // Pour XAG/USD, utiliser Alpha Vantage (Twelve Data n'a pas de données)
    if (symbol === 'XAG/USD') {
      this.logger.log(`AlphaVantage fallback for ${symbol} ${timeframe}`);
      const alphaVantage = await this.alphaVantageRepo.getSince(symbol, timeframe, since);
      if (alphaVantage.length > 0) {
        await this.localRepo.store(symbol, timeframe, alphaVantage);
        return alphaVantage;
      }
    }

    this.logger.log(`Yahoo fallback for ${symbol} ${timeframe}`);
    const yahoo = await this.yahooRepo.getSince(symbol, timeframe, since);
    if (yahoo.length > 0) {
      await this.localRepo.store(symbol, timeframe, yahoo);
    }
    return yahoo;
  }

  async getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]> {
    return this.localRepo.getLowerTimeframeWindow(symbol, timeframe, candleOpenTime);
  }
}
