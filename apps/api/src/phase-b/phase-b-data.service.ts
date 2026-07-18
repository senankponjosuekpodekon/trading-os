import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  TokenomicsMetric,
  SocialSentiment,
  BrvmStock,
  SyntheticAsset,
} from './phase-b-data.controller';

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'SOL'];

const MOCK_TOKENOMICS: TokenomicsMetric[] = [
  { assetSymbol: 'ETH', maxSupply: 0, circulatingSupply: 120_500_000, marketCap: 320_000_000_000, fullyDilutedValuation: 320_000_000_000, inflationRate: 0.5, stakingRatio: 28, unlockRisk: 'Low' },
  { assetSymbol: 'SOL', maxSupply: 0, circulatingSupply: 475_000_000, marketCap: 65_000_000_000, fullyDilutedValuation: 85_000_000_000, inflationRate: 4.8, stakingRatio: 65, unlockRisk: 'Medium' },
];

const MOCK_SENTIMENT: SocialSentiment[] = [
  { assetSymbol: 'BTC', mentionCount24h: 142_000, sentimentScore: 34, trending: true, topInfluencers: ['@cryptoQuant', '@whale_alert'] },
  { assetSymbol: 'ETH', mentionCount24h: 89_000, sentimentScore: 18, trending: false, topInfluencers: ['@ethBull', '@defiPulse'] },
];

const MOCK_BRVM: BrvmStock[] = [
  { symbol: 'SNTS', name: 'Société Nationale de Transports en commun', sector: 'Transport', priceXof: 2500, changePercent: 0.8, volume: 1200 },
  { symbol: 'BICC', name: 'Banque Internationale pour le Commerce et la Cote', sector: 'Banque', priceXof: 4300, changePercent: -0.4, volume: 850 },
  { symbol: 'CABC', name: 'Ciment d’Afrique', sector: 'Industrie', priceXof: 3100, changePercent: 1.2, volume: 2100 },
];

const MOCK_SYNTHETIC: SyntheticAsset[] = [
  { symbol: 'sBTC', underlying: 'BTC', collateralRatio: 180, price: 64_200, fundingRate: 0.02, liquidityDepth: 12_000_000 },
  { symbol: 'sETH', underlying: 'ETH', collateralRatio: 175, price: 3_450, fundingRate: -0.01, liquidityDepth: 8_500_000 },
];

@Injectable()
export class PhaseBDataService {
  private readonly logger = new Logger(PhaseBDataService.name);
  private readonly engineUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  private async engineGet<T>(path: string): Promise<T | null> {
    try {
      const res = await firstValueFrom(this.http.get<T>(`${this.engineUrl}${path}`, { timeout: 4000 }));
      return res.data ?? null;
    } catch {
      return null;
    }
  }

  async tokenomics(asset?: string): Promise<TokenomicsMetric[]> {
    const symbols = asset ? [asset.toUpperCase()] : DEFAULT_SYMBOLS;
    const results = await Promise.all(
      symbols.map(sym => this.engineGet<Record<string, unknown>>(`/tokenomics/${sym}`)),
    );
    const live = results
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r, i) => this.mapTokenomics(symbols[i], r))
      .filter((r): r is TokenomicsMetric => r !== null);

    if (live.length > 0) return live;

    this.logger.warn('Engine tokenomics unavailable, falling back to mock data');
    let data = MOCK_TOKENOMICS;
    if (asset) data = data.filter(t => t.assetSymbol.toLowerCase() === asset.toLowerCase());
    return data;
  }

  private mapTokenomics(symbol: string, r: Record<string, unknown>): TokenomicsMetric | null {
    if (!r || typeof r !== 'object') return null;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      assetSymbol: (r['symbol'] as string) ?? symbol,
      maxSupply: num(r['max_supply']),
      circulatingSupply: num(r['circulating_supply']),
      marketCap: num(r['market_cap']),
      fullyDilutedValuation: num(r['fully_diluted_valuation'] ?? r['fdv']),
      inflationRate: num(r['inflation_rate']),
      stakingRatio: num(r['staking_ratio']),
      unlockRisk: (r['unlock_risk'] as TokenomicsMetric['unlockRisk']) ?? 'Low',
    };
  }

  async social(trending?: string): Promise<SocialSentiment[]> {
    const results = await Promise.all(
      DEFAULT_SYMBOLS.map(sym => this.engineGet<Record<string, unknown>>(`/social/${sym}`)),
    );
    const live = results
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r, i) => this.mapSocial(DEFAULT_SYMBOLS[i], r))
      .filter((r): r is SocialSentiment => r !== null);

    let data = live.length > 0 ? live : MOCK_SENTIMENT;
    if (live.length === 0) this.logger.warn('Engine social sentiment unavailable, falling back to mock data');
    if (trending === 'true') data = data.filter(s => s.trending);
    return data;
  }

  private mapSocial(symbol: string, r: Record<string, unknown>): SocialSentiment | null {
    if (!r || typeof r !== 'object') return null;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      assetSymbol: (r['symbol'] as string) ?? symbol,
      mentionCount24h: num(r['mention_count_24h'] ?? r['mentions']),
      sentimentScore: num(r['sentiment_score'] ?? r['score']),
      trending: Boolean(r['trending']),
      topInfluencers: Array.isArray(r['top_influencers']) ? (r['top_influencers'] as string[]) : [],
    };
  }

  async brvm(sector?: string): Promise<BrvmStock[]> {
    const quotes = await this.engineGet<{ quotes?: Record<string, unknown>[] } | Record<string, unknown>[]>(`/brvm/quotes`);
    const rows = Array.isArray(quotes) ? quotes : quotes?.quotes;
    let data: BrvmStock[];
    if (Array.isArray(rows) && rows.length > 0) {
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      data = rows.map(r => ({
        symbol: (r['symbol'] as string) ?? '',
        name: (r['name'] as string) ?? '',
        sector: (r['sector'] as string) ?? 'Autre',
        priceXof: num(r['price'] ?? r['price_xof']),
        changePercent: num(r['change_percent'] ?? r['change_pct']),
        volume: num(r['volume']),
      }));
    } else {
      this.logger.warn('Engine BRVM quotes unavailable, falling back to mock data');
      data = MOCK_BRVM;
    }
    if (sector) data = data.filter(b => b.sector.toLowerCase() === sector.toLowerCase());
    return data;
  }

  async synthetic(underlying?: string): Promise<SyntheticAsset[]> {
    const symbols = underlying ? [underlying.toUpperCase()] : DEFAULT_SYMBOLS.slice(0, 2);
    const results = await Promise.all(
      symbols.map(sym => this.engineGet<Record<string, unknown>>(`/synthetic/analyze/${sym}`)),
    );
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const live = results
      .map((r, i) => {
        if (!r || typeof r !== 'object') return null;
        return {
          symbol: (r['symbol'] as string) ?? `s${symbols[i]}`,
          underlying: symbols[i],
          collateralRatio: num(r['collateral_ratio']),
          price: num(r['price']),
          fundingRate: num(r['funding_rate']),
          liquidityDepth: num(r['liquidity_depth']),
        } as SyntheticAsset;
      })
      .filter((r): r is SyntheticAsset => r !== null);

    if (live.length > 0) return live;

    this.logger.warn('Engine synthetic data unavailable, falling back to mock data');
    let data = MOCK_SYNTHETIC;
    if (underlying) data = data.filter(s => s.underlying.toLowerCase() === underlying.toLowerCase());
    return data;
  }
}
