import { Injectable, Logger } from '@nestjs/common';
import { Candle, CandleRepository } from './candle.repository';
import { LocalCandleRepository } from './local-candle.repository';
import { EngineCandleRepository } from './engine-candle.repository';
import { BinanceCandleRepository } from './binance-candle.repository';
import { YahooCandleRepository } from './yahoo-candle.repository';
import { TwelveDataCandleRepository } from './twelvedata-candle.repository';
import { AlphaVantageCandleRepository } from './alphavantage-candle.repository';

const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC', 'NEAR'];

const HYBRID_TF_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '1d': 86_400_000,
};

function isCrypto(symbol: string): boolean {
  const base = symbol.split('/')[0];
  return CRYPTO_SYMBOLS.includes(base);
}

@Injectable()
export class HybridCandleRepository extends CandleRepository {
  private readonly logger = new Logger(HybridCandleRepository.name);

  // Cooldown anti-rate-limit : un provider qui échoue en boucle est mis en
  // pause 15 min au lieu d'être retesté pour chaque signal du backfill.
  private static readonly COOLDOWN_MS = 15 * 60_000;
  private static readonly SYMBOL_FAIL_MAX = 2;   // ex: 404 symbole non supporté
  private static readonly PROVIDER_FAIL_MAX = 6; // ex: 429 quota compte épuisé
  private readonly cooldown = new Map<string, number>();
  private readonly failStreak = new Map<string, number>();

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

  private cooledDown(key: string): boolean {
    return (this.cooldown.get(key) ?? 0) > Date.now();
  }

  private fail(provider: string, symbol: string): void {
    for (const [key, max] of [
      [`${provider}:${symbol}`, HybridCandleRepository.SYMBOL_FAIL_MAX],
      [provider, HybridCandleRepository.PROVIDER_FAIL_MAX],
    ] as const) {
      const n = (this.failStreak.get(key) ?? 0) + 1;
      this.failStreak.set(key, n);
      if (n >= max && !this.cooledDown(key)) {
        this.cooldown.set(key, Date.now() + HybridCandleRepository.COOLDOWN_MS);
        this.logger.warn(`Provider en cooldown 15min : ${key} (${n} échecs)`);
      }
    }
  }

  private succeed(provider: string, symbol: string): void {
    this.failStreak.delete(`${provider}:${symbol}`);
    this.failStreak.delete(provider);
  }

  private async tryRepo(provider: string, repo: CandleRepository, symbol: string, timeframe: string, since: Date, until?: Date): Promise<Candle[] | null> {
    if (this.cooledDown(provider) || this.cooledDown(`${provider}:${symbol}`)) return null;
    this.logger.log(`${provider} fallback for ${symbol} ${timeframe}`);
    const candles = await repo.getSince(symbol, timeframe, since, until);
    if (candles.length === 0) {
      this.fail(provider, symbol);
      return null;
    }
    this.succeed(provider, symbol);
    await this.localRepo.store(symbol, timeframe, candles);
    return candles;
  }

  async getSince(symbol: string, timeframe: string, since: Date, until?: Date): Promise<Candle[]> {
    // 1. Essayer le cache local — mais seulement s'il COUVRE la fenêtre
    // demandée. Une seule bougie stockée ne doit pas court-circuiter les
    // providers : sinon les signaux ne peuvent jamais évaluer TP/SL et
    // restent STILL_OPEN indéfiniment.
    const local = await this.localRepo.getSince(symbol, timeframe, since, until);
    if (local.length > 0 && this._localCovers(local, timeframe, until)) {
      this.logger.log(`Cache hit: ${local.length} candles for ${symbol} ${timeframe}`);
      return local;
    }
    if (local.length > 0) {
      this.logger.log(`Cache partial (${local.length} candles, stale) for ${symbol} ${timeframe} — provider fallback`);
    }

    // 2. Essayer l'engine (live)
    const engine = await this.engineRepo.getSince(symbol, timeframe, since, until);
    if (engine && engine.length > 0) {
      this.logger.log(`Engine hit: ${engine.length} candles for ${symbol} ${timeframe}`);
      return engine;
    }

    // 3. Fallback sur le bon provider selon le marché
    if (isCrypto(symbol)) {
      return (await this.tryRepo('Binance', this.binanceRepo, symbol, timeframe, since, until)) ?? [];
    }

    // Non-crypto: Twelve Data, puis Alpha Vantage (XAG/USD), puis Yahoo
    const twelveData = await this.tryRepo('TwelveData', this.twelveDataRepo, symbol, timeframe, since, until);
    if (twelveData) return twelveData;

    if (symbol === 'XAG/USD') {
      const alphaVantage = await this.tryRepo('AlphaVantage', this.alphaVantageRepo, symbol, timeframe, since, until);
      if (alphaVantage) return alphaVantage;
    }

    return (await this.tryRepo('Yahoo', this.yahooRepo, symbol, timeframe, since, until)) ?? [];
  }

  async getLowerTimeframeWindow(symbol: string, timeframe: string, candleOpenTime: number): Promise<Candle[]> {
    return this.localRepo.getLowerTimeframeWindow(symbol, timeframe, candleOpenTime);
  }

  /** Le cache local couvre la fenêtre si sa dernière bougie atteint `until`
   * (ou le présent quand pas de borne) à ±1 timeframe près. */
  private _localCovers(local: Candle[], timeframe: string, until?: Date): boolean {
    const last = local[local.length - 1];
    if (!last) return false;
    const tfMs = HYBRID_TF_MS[timeframe] ?? 3_600_000;
    const horizon = until ? until.getTime() : Date.now();
    return last.openTime >= horizon - tfMs;
  }
}
