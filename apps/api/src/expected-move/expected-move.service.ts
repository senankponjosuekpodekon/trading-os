import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { engineHeaders } from '../utils/engine-headers.util';

@Injectable()
export class ExpectedMoveService {
  private readonly logger = new Logger(ExpectedMoveService.name);
  private readonly engineUrl: string;
  private readonly cache = new Map<string, { expires: number; data: any }>();
  private readonly inflight = new Map<string, Promise<any>>();
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  private cacheKey(symbol: string, timeframe: string, horizons?: number[], limit?: number) {
    const horizonKey = horizons?.length ? horizons.join('-') : 'default';
    return `${symbol.toUpperCase()}|${timeframe}|${horizonKey}|${limit ?? 400}`;
  }

  async getExpectedMove(
    symbol: string,
    timeframe = '1h',
    horizons?: number[],
    limit = 400,
  ) {
    const key = this.cacheKey(symbol, timeframe, horizons, limit);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expires > now) {
      return cached.data;
    }

    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const request = this.fetchExpectedMove(symbol, timeframe, horizons, limit)
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    const data = await request;
    this.cache.set(key, { data, expires: Date.now() + this.cacheTtlMs });
    return data;
  }

  private async fetchExpectedMove(
    symbol: string,
    timeframe: string,
    horizons?: number[],
    limit?: number,
  ) {
    const params: Record<string, any> = { timeframe, limit };
    if (horizons && horizons.length) {
      params.horizons = horizons.join(',');
    }
    const encodedSymbol = encodeURIComponent(symbol);
    try {
      const { data } = await firstValueFrom(
        this.http.get(`${this.engineUrl}/expected-move/${encodedSymbol}`, { params, headers: engineHeaders(this.config) }),
      );
      return data;
    } catch (error: any) {
      this.logger.error('Expected move fetch failed', error?.message || error);
      throw new ServiceUnavailableException('Expected move engine unavailable');
    }
  }
}
