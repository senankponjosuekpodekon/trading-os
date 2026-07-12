import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async scheduledMorningScan() {
    this.logger.log('CRON: lancement du scan matinal (06:00 UTC)');
    await this._scanActiveAssets('1h');
  }

  @Cron('0 */4 * * *', { timeZone: 'UTC' })
  async scheduledDayScan() {
    this.logger.log('CRON: lancement du scan toutes les 4h');
    await this._scanActiveAssets('1h');
  }

  private async _scanActiveAssets(timeframe: string) {
    const assets = await this.prisma.asset.findMany({
      where: { isActive: true },
      select: { symbol: true },
    });
    const symbols = assets.map(a => a.symbol);
    if (!symbols.length) {
      this.logger.warn('Aucun actif actif à scanner');
      return;
    }
    return this.triggerScan(symbols, timeframe);
  }

  async findAll(opts: { page: number; limit: number; sort: string }) {
    const [field, dir] = opts.sort.split(':');
    const orderByField = ['createdAt', 'confidence', 'entryPrice'].includes(field) ? field : 'createdAt';
    const orderBy: any = { [orderByField]: dir === 'asc' ? 'asc' : 'desc' };
    const skip = (opts.page - 1) * opts.limit;

    const where = { isActive: true };

    const [data, total] = await Promise.all([
      this.prisma.signal.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy,
        include: {
          asset: { select: { symbol: true, name: true } },
          strategy: { select: { name: true } },
        },
      }),
      this.prisma.signal.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: opts.page,
        limit: opts.limit,
        total,
        totalPages: Math.ceil(total / opts.limit),
      },
    };
  }

  async findByAsset(assetId: string) {
    return this.prisma.signal.findMany({
      where: { assetId, isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        asset: { select: { symbol: true, name: true } },
        strategy: { select: { name: true } },
      },
    });
  }

  async triggerScan(symbols: string[], timeframe = '1h') {
    try {
      const { data } = await firstValueFrom(
        this.http.post(`${this.engineUrl}/scan/multi`, { symbols, timeframe }),
      );
      return this.saveSignals(data.results);
    } catch (e: any) {
      throw new Error(`Engine scan failed: ${e?.message}`);
    }
  }

  private async saveSignals(results: any[]) {
    const strategy = await this.prisma.strategy.findFirst({ where: { name: 'EMA Trend + RSI' } });
    if (!strategy) return [];

    const saved: any[] = [];
    for (const r of results) {
      if (!r.signal || r.signal === 'NEUTRAL' || r.confidence < 50) continue;

      const asset = await this.prisma.asset.findUnique({ where: { symbol: r.symbol } });
      if (!asset) continue;

      const signal = await this.prisma.signal.create({
        data: {
          assetId: asset.id,
          strategyId: strategy.id,
          signal: r.signal,
          confidence: r.confidence,
          timeframe: r.timeframe,
          entryPrice: r.entry_price,
          stopLoss: r.stop_loss,
          takeProfit1: r.take_profit_1,
          takeProfit2: r.take_profit_2,
          riskReward: r.risk_reward,
          indicators: r.indicators,
          metadata: {
            price_action: r.price_action,
            sr_zones:     r.sr_zones,
            patterns:     r.patterns,
            regime:       r.regime,
            smc:          r.smc,
          },
          explanation: r.explanation,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
        include: {
          asset: { select: { symbol: true, name: true } },
          strategy: { select: { name: true } },
        },
      });
      saved.push(signal);
      if (r.confidence >= 70) {
        this.notifications.pushGlobal(
          'SIGNAL',
          `Signal ${r.signal} — ${r.symbol}`,
          `Confiance ${Math.round(r.confidence)}% | ${r.timeframe}`,
        );
      }
    }
    return saved;
  }
}
