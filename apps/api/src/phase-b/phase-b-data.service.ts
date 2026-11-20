import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { engineHeaders } from '../utils/engine-headers.util';
import {
  TokenomicsMetric,
  SocialSentiment,
  BrvmStock,
  SyntheticAsset,
} from './phase-b-data.controller';

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'SOL'];

const MOCK_TOKENOMICS: TokenomicsMetric[] = [
  { assetSymbol: 'ETH', nextUnlockPct: 0, nextUnlockDate: null, top10HoldersPct: 42, source: 'mock' },
  { assetSymbol: 'SOL', nextUnlockPct: 0.4, nextUnlockDate: null, top10HoldersPct: 35, source: 'mock' },
];

const MOCK_SENTIMENT: SocialSentiment[] = [
  { assetSymbol: 'BTC', galaxyScore: 62, altRank: 12, socialDominance: 18.5, interactionsPerPost: 245, sentiment: null, source: 'mock' },
  { assetSymbol: 'ETH', galaxyScore: 58, altRank: 18, socialDominance: 12.3, interactionsPerPost: 198, sentiment: null, source: 'mock' },
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
      const res = await firstValueFrom(this.http.get<T>(`${this.engineUrl}${path}`, { timeout: 4000, headers: engineHeaders(this.config) }));
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
      nextUnlockPct: num(r['next_unlock_pct']),
      nextUnlockDate: (r['next_unlock_date'] as string) ?? null,
      top10HoldersPct: num(r['top10_holders_pct']),
      source: (r['source'] as string) ?? 'mock',
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

    if (live.length === 0) this.logger.warn('Engine social sentiment unavailable, falling back to mock data');
    return live.length > 0 ? live : MOCK_SENTIMENT;
  }

  private mapSocial(symbol: string, r: Record<string, unknown>): SocialSentiment | null {
    if (!r || typeof r !== 'object') return null;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      assetSymbol: (r['symbol'] as string) ?? symbol,
      galaxyScore: num(r['galaxy_score']),
      altRank: num(r['alt_rank']),
      socialDominance: num(r['social_dominance']),
      interactionsPerPost: num(r['interactions_per_post']),
      sentiment: typeof r['sentiment'] === 'number' ? (r['sentiment'] as number) : null,
      source: (r['source'] as string) ?? 'mock',
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
