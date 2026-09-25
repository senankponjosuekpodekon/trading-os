import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaSystemService } from '../prisma/prisma.service';

export interface RecordCallInput {
  symbol: string;
  source: string;                    // "engine:moonshot" | "manual:ifeanyi" | ...
  entryPrice?: number | null;        // résolu automatiquement si absent
  chain?: string | null;
  tokenAddress?: string | null;
  coingeckoId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

@Injectable()
export class TrackRecordService {
  private readonly logger = new Logger(TrackRecordService.name);
  private readonly engineUrl: string;

  constructor(
    private systemPrisma: PrismaSystemService,
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  private get db() {
    return (this.systemPrisma as any).trackedCall;
  }

  /**
   * Enregistre un call. Dédupliqué : un même (source, symbol, tokenAddress)
   * déjà ouvert n'est pas recréé — le suivi continue sur la ligne existante.
   */
  async record(input: RecordCallInput) {
    const existing = await this.db.findFirst({
      where: {
        source: input.source,
        symbol: input.symbol,
        tokenAddress: input.tokenAddress ?? null,
        closedAt: null,
      },
    });
    if (existing) return { dedup: true, call: existing };

    let entryPrice = input.entryPrice ?? null;
    if (!entryPrice || entryPrice <= 0) {
      entryPrice = await this._resolvePrice({
        coingeckoId: input.coingeckoId ?? null,
        tokenAddress: input.tokenAddress ?? null,
        symbol: input.symbol,
      });
    }
    if (!entryPrice) {
      return { dedup: false, call: null, error: 'price_unavailable' };
    }

    const call = await this.db.create({
      data: {
        symbol: input.symbol,
        source: input.source,
        chain: input.chain ?? null,
        tokenAddress: input.tokenAddress ?? null,
        coingeckoId: input.coingeckoId ?? null,
        entryPrice,
        lastPrice: entryPrice,
        peakPrice: entryPrice,
        troughPrice: entryPrice,
        lastCheckAt: new Date(),
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    this.logger.log(`Call tracked: ${input.source} — ${input.symbol} @ ${entryPrice}`);
    return { dedup: false, call };
  }

  async list() {
    const calls = await this.db.findMany({ orderBy: { entryAt: 'desc' } });
    const enriched = calls.map((c: any) => this._withPerf(c));
    return { calls: enriched, kpis: this._kpis(enriched) };
  }

  async close(id: string) {
    const call = await this.db.findUnique({ where: { id } });
    if (!call) return null;
    return this.db.update({ where: { id }, data: { closedAt: new Date() } });
  }

  async remove(id: string) {
    await this.db.delete({ where: { id } });
    return { deleted: true };
  }

  /** Rafraîchit last/peak/trough de tous les calls ouverts — toutes les 15 min. */
  @Cron('0 */15 * * * *')
  async refreshPrices() {
    const open = await this.db.findMany({ where: { closedAt: null } });
    if (open.length === 0) return;
    await Promise.allSettled(
      open.map(async (call: any) => {
        const price = await this._resolvePrice(call);
        if (!price) return;
        const peak = Math.max(call.peakPrice ?? price, price);
        const trough = Math.min(call.troughPrice ?? price, price);
        await this.db.update({
          where: { id: call.id },
          data: {
            lastPrice: price,
            peakPrice: peak,
            peakAt: peak > (call.peakPrice ?? 0) ? new Date() : call.peakAt,
            troughPrice: trough,
            lastCheckAt: new Date(),
          },
        });
      }),
    );
  }

  private _withPerf(call: any) {
    const last = call.lastPrice ?? call.entryPrice;
    const perfPct = call.entryPrice ? ((last - call.entryPrice) / call.entryPrice) * 100 : null;
    const peakPct = call.peakPrice && call.entryPrice
      ? ((call.peakPrice - call.entryPrice) / call.entryPrice) * 100 : null;
    return {
      ...call,
      perfPct: perfPct != null ? +perfPct.toFixed(2) : null,
      peakPct: peakPct != null ? +peakPct.toFixed(2) : null,
      multiple: last && call.entryPrice ? +(last / call.entryPrice).toFixed(2) : null,
      daysHeld: Math.floor((Date.now() - new Date(call.entryAt).getTime()) / 86_400_000),
    };
  }

  /** KPIs par source — hit rate, perf moyenne, meilleur call. Notre valeur. */
  private _kpis(calls: any[]) {
    const bySource: Record<string, any> = {};
    for (const c of calls) {
      const s = (bySource[c.source] ??= { source: c.source, count: 0, open: 0, wins: 0, sumPerf: 0, best: null });
      s.count += 1;
      if (!c.closedAt) s.open += 1;
      if (c.perfPct != null) {
        s.sumPerf += c.perfPct;
        if (c.perfPct > 0) s.wins += 1;
        if (!s.best || c.perfPct > s.best.perfPct) s.best = { symbol: c.symbol, perfPct: c.perfPct };
      }
    }
    return Object.values(bySource).map((s: any) => ({
      ...s,
      hitRate: s.count ? +(100 * s.wins / s.count).toFixed(1) : null,
      avgPerfPct: s.count ? +(s.sumPerf / s.count).toFixed(2) : null,
      sumPerf: undefined,
    }));
  }

  /** Prix live : CoinGecko > DexScreener > Binance > engine candles. */
  private async _resolvePrice(call: { coingeckoId?: string | null; tokenAddress?: string | null; symbol: string }): Promise<number | null> {
    try {
      if (call.coingeckoId) {
        const { data } = await firstValueFrom(
          this.http.get('https://api.coingecko.com/api/v3/simple/price',
            { params: { ids: call.coingeckoId, vs_currencies: 'usd' }, timeout: 8000 }),
        );
        const p = data?.[call.coingeckoId]?.usd;
        if (p) return parseFloat(p);
      }
      if (call.tokenAddress) {
        const { data } = await firstValueFrom(
          this.http.get(`https://api.dexscreener.com/latest/dex/tokens/${call.tokenAddress}`, { timeout: 8000 }),
        );
        const pairs = data?.pairs ?? [];
        const best = pairs.sort((a: any, b: any) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0))[0];
        const p = parseFloat(best?.priceUsd ?? '');
        if (p) return p;
      }
      const binanceSym = call.symbol.replace('/', '').replace(/USD$/, 'USDT').toUpperCase();
      const { data } = await firstValueFrom(
        this.http.get('https://api.binance.com/api/v3/ticker/price',
          { params: { symbol: binanceSym }, timeout: 5000 }),
      );
      const p = parseFloat(data?.price ?? '');
      return p || null;
    } catch {
      return null;
    }
  }
}
