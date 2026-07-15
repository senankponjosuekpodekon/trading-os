import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SignalOutcomeService } from './signal-outcome.service';

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private outcomeService: SignalOutcomeService,
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
    const [assets, strategies] = await Promise.all([
      this.prisma.asset.findMany({
        where: { isActive: true },
        select: { symbol: true },
      }),
      this.prisma.strategy.findMany({
        where: { isActive: true },
        select: { id: true, name: true, rules: true },
      }),
    ]);
    const symbols = assets.map(a => a.symbol);
    if (!symbols.length) {
      this.logger.warn('Aucun actif actif à scanner');
      return;
    }
    return this.triggerScan(symbols, timeframe, strategies);
  }

  async findAll(opts: { page: number; limit: number; sort: string; profile?: string }) {
    const [field, dir] = opts.sort.split(':');
    const orderByField = ['createdAt', 'confidence', 'entryPrice'].includes(field) ? field : 'createdAt';
    const orderBy: any = { [orderByField]: dir === 'asc' ? 'asc' : 'desc' };
    const skip = (opts.page - 1) * opts.limit;

    const where: any = { isActive: true };
    if (opts.profile) {
      where.profileSuitability = { has: opts.profile };
    }

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

  async triggerScan(symbols: string[], timeframe = '1h', strategies?: any[]) {
    try {
      const payload: any = { symbols, timeframe };
      if (strategies && strategies.length) {
        payload.strategies = strategies;
      }
      const { data } = await firstValueFrom(
        this.http.post(`${this.engineUrl}/scan/multi`, payload),
      );
      const saved = await this.saveSignals(data.results);
      // Pass 2 : enrichissement sentiment asynchrone (non bloquant)
      // Met à jour confidence + potentiellement invalide le signal
      setImmediate(() => Promise.resolve(this._enrichSentimentPass2(saved, data.results)).catch(() => {}));
      return { saved, portfolio_risk: data.portfolio_risk ?? null };
    } catch (e: any) {
      throw new Error(`Engine scan failed: ${e?.message}`);
    }
  }

  private async saveSignals(results: any[]) {
    const defaultStrategy = await this.prisma.strategy.findFirst({ where: { name: 'EMA Trend + RSI' } });

    const saved: any[] = [];
    for (const r of results) {
      // Ne pas persister les signaux encore en attente de confirmation hystérésis
      if (!r.signal || r.signal === 'NEUTRAL' || r.confidence < 50) continue;
      if (r.signal_pending === true) continue;

      const asset = await this.prisma.asset.findUnique({
        where: { symbol: r.symbol },
        include: { market: { select: { name: true } } },
      });
      if (!asset) continue;

      let strategy: any = null;
      if (r.strategy_id) {
        strategy = await this.prisma.strategy.findUnique({ where: { id: r.strategy_id } });
      }
      if (!strategy) {
        strategy = defaultStrategy;
      }
      if (!strategy) continue;

      // Détecter si le sentiment est déjà enrichi ou encore en attente
      const sentimentPresent = !!(r.news_sentiment || r.scraper_sentiment);

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
          profileSuitability: r.profile_suitability || [],
          indicators: r.indicators,
          metadata: {
            price_action:      r.price_action,
            sr_zones:          r.sr_zones,
            patterns:          r.patterns,
            regime:            r.regime,
            smc:               r.smc,
            news_sentiment:    r.news_sentiment    ?? null,
            scraper_sentiment: r.scraper_sentiment ?? null,
            sentiment_pending: !sentimentPresent,
            score:             r.score ?? null,
            trigger:           r.trigger ?? null,
            signal_pending:    r.signal_pending ?? null,
            invalidation:      r.invalidation ?? null,
            mtf_context:       r.mtf_context ?? null,
            dps:               r.dps ?? null,
            tps:               r.tps ?? null,
            success_probability: r.success_probability ?? null,
            expected_move:     r.expected_move ?? null,
            context:           r.context ?? null,
          },
          explanation: r.explanation,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
        include: {
          asset: { select: { symbol: true, name: true } },
          strategy: { select: { name: true } },
        },
      });
      // Attacher la confidence technique (avant sentiment) pour le pass 2
      (signal as any)._technical_confidence = r._confidence_before_sentiment ?? r.confidence;
      (signal as any)._raw = r;
      saved.push(signal);

      // Feedback loop : signal log pour calibration / ML
      Promise.resolve(this.outcomeService.logSignal({ ...r, signalId: signal.id }, asset.market?.name ?? 'UNKNOWN')).catch(() => {});

      // Notifier seulement si le sentiment est déjà appliqué,
      // sinon le pass 2 notifiera après validation
      if (sentimentPresent && r.confidence >= 70) {
        this.notifications.pushGlobal(
          'SIGNAL',
          `Signal ${r.signal} — ${r.symbol}`,
          `Confiance ${Math.round(r.confidence)}% | ${r.timeframe}`,
        );
      }
    }
    return saved;
  }

  private async _enrichSentimentPass2(saved: any[], rawResults: any[]) {
    // Regrouper les résultats bruts par symbole pour retrouver le sentiment final
    const rawMap = new Map<string, any>(rawResults.map(r => [r.symbol, r]));

    for (const signal of saved) {
      const sym = signal.asset?.symbol;
      if (!sym) continue;
      const raw = (signal as any)._raw ?? rawMap.get(sym);
      if (!raw) continue;

      const meta = signal.metadata as any ?? {};
      if (!meta.sentiment_pending) continue;  // déjà enrichi au pass 1

      const hasSentiment = !!(raw.news_sentiment || raw.scraper_sentiment);
      if (!hasSentiment) continue;  // pas de sentiment disponible, on laisse

      // Confidence finale après sentiment
      const newConf = raw.confidence;
      const prevConf = signal.confidence;
      const delta = Math.abs(newConf - prevConf);

      // Si le sentiment invalide le signal (confidence tombe sous 50)
      if (newConf < 50) {
        await this.prisma.signal.update({
          where: { id: signal.id },
          data: {
            isActive: false,
            metadata: {
              ...meta,
              sentiment_pending:   false,
              sentiment_invalidated: true,
              news_sentiment:      raw.news_sentiment    ?? null,
              scraper_sentiment:   raw.scraper_sentiment ?? null,
            },
          },
        });
        this.logger.warn(`Signal ${sym} invalidé par sentiment (${prevConf}→${newConf})`);
        continue;
      }

      // Mise à jour confidence + metadata sentiment
      await this.prisma.signal.update({
        where: { id: signal.id },
        data: {
          confidence: newConf,
          metadata: {
            ...meta,
            sentiment_pending:  false,
            news_sentiment:     raw.news_sentiment    ?? null,
            scraper_sentiment:  raw.scraper_sentiment ?? null,
          },
        },
      });

      // Notifier maintenant (confiance validée par sentiment)
      if (newConf >= 70) {
        this.notifications.pushGlobal(
          'SIGNAL',
          `Signal ${raw.signal} — ${sym}`,
          `Confiance ${Math.round(newConf)}% | ${raw.timeframe}${delta >= 5 ? ` (±${Math.round(delta)}% sentiment)` : ''}`,
        );
      }
    }
  }
}
