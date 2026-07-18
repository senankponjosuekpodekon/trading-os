import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface FearGreedPoint {
  value: number;
  classification: string;
  timestamp: string;
}

export interface FundingRate {
  symbol: string;
  fundingRate: number;
  fundingTime: string;
}

export interface EconomicEvent {
  date: string;
  time: string;
  currency: string;
  impact: string;
  title: string;
  forecast: string;
  previous: string;
  category?: 'FOMC' | 'NFP' | 'CPI' | 'BRVM' | 'Other';
}

export interface OnChainBtcSnapshot {
  price: number;
  marketCap: number;
  blocks24h: number;
  transactions24h: number;
  difficulty: number;
  hashrate24h: number;
  avgFee24h: number;
  mempoolSize: number;
  suggestedFee: number;
}

export interface SpotPerpBasis {
  symbol: string;
  spotPrice: number;
  perpPrice: number;
  basis: number;
}

export interface OnChainEthSnapshot {
  price: number;
  marketCap: number;
  transactions24h: number;
  blocks24h: number;
  avgFee24h: number;
  gasPriceMedian: number;
}

export interface CotSnapshot {
  reportDate: string;
  asset: string;
  marketName: string;
  nonCommercialLong: number;
  nonCommercialShort: number;
  nonCommercialNet: number;
  commercialLong: number;
  commercialShort: number;
  openInterest: number;
}

const FUT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const COT_API_URL = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';
const COT_ASSET_MAP: Record<string, string> = {
  BTC: 'BITCOIN - CHICAGO MERCANTILE EXCHANGE',
  ETH: 'ETHER - CHICAGO MERCANTILE EXCHANGE',
};
const BINANCE_FUT_API = 'https://fapi.binance.com/fapi/v1/fundingRate';
const BINANCE_SPOT_API = 'https://api.binance.com/api/v3/ticker/price';
const BINANCE_FUT_PRICE_API = 'https://fapi.binance.com/fapi/v1/ticker/price';
const ECONOMIC_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const BLOCKCHAIR_BTC_STATS = 'https://api.blockchair.com/bitcoin/stats';
const BLOCKCHAIR_ETH_STATS = 'https://api.blockchair.com/ethereum/stats';
const MEMPOOL_FEES = 'https://mempool.space/api/v1/fees/recommended';

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(private http: HttpService) {}

  async getFearGreed(limit = 1): Promise<FearGreedPoint[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get(`https://api.alternative.me/fng/?limit=${limit}`),
      );
      return (data?.data ?? []).map((item: any) => ({
        value: Number(item.value),
        classification: String(item.value_classification),
        timestamp: item.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : new Date().toISOString(),
      }));
    } catch (e: any) {
      this.logger.warn(`Fear & Greed fetch failed: ${e?.message}`);
      return [];
    }
  }

  async getFundingRates(symbols = FUT_SYMBOLS): Promise<FundingRate[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<any[]>(BINANCE_FUT_API),
      );
      const wanted = new Set(symbols);
      return (data ?? [])
        .filter((item: any) => wanted.has(String(item.symbol)))
        .map((item: any) => ({
          symbol: String(item.symbol).replace('USDT', '/USDT'),
          fundingRate: Number(item.fundingRate),
          fundingTime: new Date(item.fundingTime).toISOString(),
        }));
    } catch (e: any) {
      this.logger.warn(`Funding rate fetch failed: ${e?.message}`);
      return [];
    }
  }

  private categorizeEvent(title: string): EconomicEvent['category'] {
    const t = title.toLowerCase();
    if (t.includes('fomc') || t.includes('fed interest') || t.includes('federal funds')) return 'FOMC';
    if (t.includes('nonfarm') || t.includes('nfp') || t.includes('non-farm payroll')) return 'NFP';
    if (t.includes('cpi') || t.includes('consumer price')) return 'CPI';
    if (t.includes('brvm') || t.includes('pme') || t.includes('bourse')) return 'BRVM';
    return 'Other';
  }

  private getFallbackMacroEvents(): EconomicEvent[] {
    return [
      { date: '2026-07-29', time: '14:00', currency: 'USD', impact: 'High', title: 'FOMC Interest Rate Decision', forecast: '5.25%', previous: '5.50%', category: 'FOMC' },
      { date: '2026-08-01', time: '08:30', currency: 'USD', impact: 'High', title: 'Non-Farm Payrolls (NFP)', forecast: '180k', previous: '175k', category: 'NFP' },
      { date: '2026-08-12', time: '08:30', currency: 'USD', impact: 'High', title: 'CPI m/m', forecast: '0.2%', previous: '0.3%', category: 'CPI' },
      { date: '2026-07-30', time: '11:00', currency: 'XOF', impact: 'Medium', title: 'BRVM Composite PMI', forecast: '52.0', previous: '51.5', category: 'BRVM' },
    ];
  }

  async getEconomicCalendar(): Promise<EconomicEvent[]> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<any[]>(ECONOMIC_CALENDAR_URL),
      );
      const external = (data ?? [])
        .filter((item: any) => ['High', 'Medium'].includes(item.impact))
        .map((item: any) => ({
          date: String(item.date),
          time: String(item.time),
          currency: String(item.country),
          impact: String(item.impact),
          title: String(item.title),
          forecast: item.forecast ? String(item.forecast) : '—',
          previous: item.previous ? String(item.previous) : '—',
          category: this.categorizeEvent(String(item.title)),
        }));
      return [...this.getFallbackMacroEvents(), ...external].slice(0, 25);
    } catch (e: any) {
      this.logger.warn(`Economic calendar fetch failed: ${e?.message}`);
      return this.getFallbackMacroEvents();
    }
  }

  async getOnChainBtc(): Promise<OnChainBtcSnapshot | null> {
    try {
      const [{ data: stats }, { data: fees }] = await Promise.all([
        firstValueFrom(this.http.get<any>(BLOCKCHAIR_BTC_STATS)),
        firstValueFrom(this.http.get<any>(MEMPOOL_FEES)),
      ]);

      const d = stats?.data ?? {};
      const market = d.market_data ?? {};

      return {
        price: Number(market.price_usd ?? 0),
        marketCap: Number(market.market_cap_usd ?? 0),
        blocks24h: Number(d.blocks_24h ?? 0),
        transactions24h: Number(d.transactions_24h ?? 0),
        difficulty: Number(d.difficulty ?? 0),
        hashrate24h: Number(d.hashrate_24h ?? 0),
        avgFee24h: Number(d.average_transaction_fee_24h ?? 0),
        mempoolSize: Number(d.mempool_size ?? 0),
        suggestedFee: Number(fees?.fastestFee ?? 0),
      };
    } catch (e: any) {
      this.logger.warn(`BTC on-chain fetch failed: ${e?.message}`);
      return null;
    }
  }

  async getOnChainEth(): Promise<OnChainEthSnapshot | null> {
    try {
      const { data: stats } = await firstValueFrom(
        this.http.get<any>(BLOCKCHAIR_ETH_STATS),
      );
      const d = stats?.data ?? {};
      const market = d.market_data ?? {};
      return {
        price: Number(market.price_usd ?? 0),
        marketCap: Number(market.market_cap_usd ?? 0),
        transactions24h: Number(d.transactions_24h ?? 0),
        blocks24h: Number(d.blocks_24h ?? 0),
        avgFee24h: Number(d.average_transaction_fee_24h ?? 0),
        gasPriceMedian: Number(d.suggested_transaction_fee_median ?? 0),
      };
    } catch (e: any) {
      this.logger.warn(`ETH on-chain fetch failed: ${e?.message}`);
      return null;
    }
  }

  async getCot(asset: string): Promise<CotSnapshot | null> {
    try {
      const marketName = COT_ASSET_MAP[asset.toUpperCase()];
      if (!marketName) {
        this.logger.warn(`COT not mapped for asset ${asset}`);
        return null;
      }
      const { data } = await firstValueFrom(
        this.http.get<any[]>(
          `${COT_API_URL}?market_and_exchange_names=${encodeURIComponent(marketName)}&$order=report_date_as_yyyy_mm_dd DESC&$limit=1`,
        ),
      );
      const row = (data ?? [])[0];
      if (!row) return null;
      const ncl = Number(row.non_comm_positions_long_all ?? 0);
      const ncs = Number(row.non_comm_positions_short_all ?? 0);
      return {
        reportDate: String(row.report_date_as_yyyy_mm_dd ?? ''),
        asset: asset.toUpperCase(),
        marketName,
        nonCommercialLong: ncl,
        nonCommercialShort: ncs,
        nonCommercialNet: ncl - ncs,
        commercialLong: Number(row.comm_positions_long_all ?? 0),
        commercialShort: Number(row.comm_positions_short_all ?? 0),
        openInterest: Number(row.open_interest_all ?? 0),
      };
    } catch (e: any) {
      this.logger.warn(`COT fetch failed for ${asset}: ${e?.message}`);
      return null;
    }
  }

  async getSpotPerpBasis(symbols = FUT_SYMBOLS): Promise<SpotPerpBasis[]> {
    try {
      const pairs = await Promise.all(
        symbols.map(async (sym) => {
          const [spot, perp] = await Promise.all([
            firstValueFrom(this.http.get<any>(`${BINANCE_SPOT_API}?symbol=${sym}`)).catch(() => ({ data: null })),
            firstValueFrom(this.http.get<any>(`${BINANCE_FUT_PRICE_API}?symbol=${sym}`)).catch(() => ({ data: null })),
          ]);
          const spotPrice = Number(spot.data?.price ?? 0);
          const perpPrice = Number(perp.data?.price ?? 0);
          if (!spotPrice || !perpPrice) return null;
          return {
            symbol: sym.replace('USDT', '/USDT'),
            spotPrice,
            perpPrice,
            basis: parseFloat(((perpPrice - spotPrice) / spotPrice * 100).toFixed(4)),
          };
        }),
      );
      return pairs.filter((p): p is SpotPerpBasis => p !== null);
    } catch (e: any) {
      this.logger.warn(`Spot-perp basis fetch failed: ${e?.message}`);
      return [];
    }
  }
}
