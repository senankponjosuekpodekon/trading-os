import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AlertService } from '../notifications/alert.service';
import { SignalTrackerService } from './signal-tracker.service';
import { SignalStatsService } from './signal-stats.service';
import { SignalPersistenceService } from './signal-persistence.service';
import { CronConfigService } from '../admin/cron-config.service';
import { FeatureStoreService } from './feature-store.service';
import { SignalPredictorService, SignalFeatures } from './signal-predictor.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { QuotaService } from '../billing/quota.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { SystemHealthService } from '../system-health/system-health.service';

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
    private tracker: SignalTrackerService,
    private predictor: SignalPredictorService,
    private featureStore: FeatureStoreService,
    private quota: QuotaService,
    private engineHttp: EngineHttpService,
    private health: SystemHealthService,
    private patternPredictor: PatternPredictorService,
    private config: ConfigService,
    private stats: SignalStatsService,
    private cronConfig: CronConfigService,
    private persistence: SignalPersistenceService,
  ) {}

  private async _run(name: string, fn: () => Promise<void>): Promise<void> {
    const enabled = await this.cronConfig.isEnabled(name);
    if (!enabled) return;
    if (!(await this.cronConfig.acquireLock(name))) return;

    try {
      await fn();
      await this.cronConfig.setLastRun(name);
    } catch (error) {
      await this.cronConfig.setLastError(name, (error as Error)?.message ?? 'Unknown error');
      throw error;
    } finally {
      await this.cronConfig.releaseLock(name);
    }
  }

  async trainPredictor(opts: { market?: string; timeframe?: string; limit?: number } = {}) {
    const { market, timeframe, limit } = opts;
    try {
      const result = await this.predictor.train(market, timeframe, limit ?? 2000);
      this.logger.log('signal_predictor_trained', {
        market: market ?? 'ALL',
        timeframe: timeframe ?? 'ALL',
        limit: limit ?? 2000,
        samples: result?.samples,
      });
      return result;
    } catch (error) {
      this.logger.error('signal_predictor_train_failed', { error: (error as any)?.message ?? error });
      throw error;
    }
  }

  async predictSignalScore(features: SignalFeatures) {
    return this.predictor.predict(features);
  }

  async getPredictorStatus() {
    try {
      return await this.predictor.getStatus();
    } catch (error) {
      this.logger.warn('signal_predictor_status_failed', { error: (error as any)?.message ?? error });
      throw error;
    }
  }

  async getPredictorFeatureWeights() {
    try {
      return await this.predictor.getFeatureWeights();
    } catch (error) {
      this.logger.warn('signal_predictor_weights_failed', { error: (error as any)?.message ?? error });
      throw error;
    }
  }

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async scheduledMorningScan() {
    await this._run('SIGNALS_MORNING_SCAN_ENABLED', async () => {
      this.logger.log('CRON: lancement du scan matinal (06:00 UTC)');
      await this._scanActiveAssetsByTimeframe();
      this.health.recordCronRun('morning-scan', 'ok');
    });
  }

  @Cron('0 */4 * * *', { timeZone: 'UTC' })
  async scheduledDayScan() {
    await this._run('SIGNALS_DAY_SCAN_ENABLED', async () => {
      this.logger.log('CRON: lancement du scan toutes les 4h');
      await this._scanActiveAssetsByTimeframe();
      this.health.recordCronRun('day-scan', 'ok');
    });
  }

  @Cron('15 */6 * * *', { timeZone: 'UTC' })
  async scheduledPredictorTraining() {
    await this._run('SIGNALS_PREDICTOR_TRAINING_ENABLED', async () => {
      await this.trainPredictor({ market: 'CRYPTO', timeframe: '1h' });
      this.health.recordCronRun('predictor-training', 'ok');
    });
  }

  @Cron('45 */6 * * *', { timeZone: 'UTC' })
  async scheduledPatternPredictorTraining() {
    await this._run('SIGNALS_PATTERN_PREDICTOR_ENABLED', async () => {
      const result = await this.patternPredictor.train();
      this.health.recordCronRun('pattern-predictor-training', result.trained ? 'ok' : 'error');
    });
  }

  // Le modèle de régime vit en cache fichier dans le conteneur engine —
  // perdu à chaque restart. Re-entraînement quotidien via Binance.
  @Cron('20 */12 * * *', { timeZone: 'UTC' })
  async scheduledRegimeTraining() {
    await this._run('ML_REGIME_TRAINING_ENABLED', async () => {
      await this.engineHttp.post('/ml/regime/auto-train', {}, { timeout: 60_000 });
      this.health.recordCronRun('regime-training', 'ok');
    });
  }

  /**
   * Scan all active assets grouped by strategy analysisTimeframe.
   * Each strategy defines its own analysisTimeframe (e.g. '4h', '1d', '15m').
   * Instead of forcing '1h' for all, we group strategies by their analysisTimeframe
   * and call triggerScan once per timeframe group so candles are fetched at the
   * correct resolution for each strategy.
   */
  private async _scanActiveAssetsByTimeframe() {
    const [assets, strategies] = await Promise.all([
      this.prisma.asset.findMany({
        where: { isActive: true },
        select: { symbol: true },
      }),
      this.prisma.strategy.findMany({
        where: { isActive: true },
        select: { id: true, name: true, rules: true, analysisTimeframe: true, entryTimeframe: true },
      }),
    ]);
    const symbols = assets.map(a => a.symbol);
    if (!symbols.length) {
      this.logger.warn('Aucun actif actif à scanner');
      return;
    }
    if (!strategies.length) {
      // No strategies — fallback to default timeframe
      return this.triggerScan(symbols, '1h', { strategies: [] });
    }

    // Group strategies by analysisTimeframe
    const byTf = new Map<string, any[]>();
    for (const s of strategies) {
      const tf = s.analysisTimeframe || (s.rules as any)?.analysis_timeframe || '1h';
      if (!byTf.has(tf)) byTf.set(tf, []);
      byTf.get(tf)!.push(s);
    }

    // Launch one scan per timeframe group
    const scans: Promise<any>[] = [];
    for (const [tf, tfStrategies] of byTf) {
      this.logger.log(`CRON: scan ${tfStrategies.length} stratégies sur TF=${tf}, ${symbols.length} symboles`);
      scans.push(this.triggerScan(symbols, tf, { strategies: tfStrategies }));
    }
    await Promise.allSettled(scans);
  }

  async findAll(opts: { page: number; limit: number; sort: string; profile?: string; market?: string; riskLevel?: string }) {
    const [field, dir] = opts.sort.split(':');
    const orderByField = ['createdAt', 'confidence', 'entryPrice'].includes(field) ? field : 'createdAt';
    const orderBy: any = { [orderByField]: dir === 'asc' ? 'asc' : 'desc' };
    const skip = (opts.page - 1) * opts.limit;

    const where: any = { isActive: true };
    if (opts.profile) {
      where.profileSuitability = { has: opts.profile };
    }
    if (opts.market) {
      where.asset = { market: { name: { equals: opts.market, mode: 'insensitive' } } };
    }
    if (opts.riskLevel) {
      where.metadata = { path: ['risk_level'], equals: opts.riskLevel };
    }

    const [data, total] = await Promise.all([
      this.prisma.signal.findMany({
        where,
        skip,
        take: opts.limit,
        orderBy,
        include: {
          asset: { select: { symbol: true, name: true, market: { select: { name: true } } } },
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

  async triggerScan(
    symbols: string[],
    timeframe = '1h',
    opts?: { userId?: string; strategies?: any[] },
  ) {
    let strategies = opts?.strategies;
    let signalAllowance: { limit: number | null; used: number } | null = null;

    if (!strategies && opts?.userId) {
      const userStrategies = await this.prisma.userStrategy.findMany({
        where: { userId: opts.userId, isEnabled: true },
        include: { strategy: true },
      });
      strategies = userStrategies.map(us => ({
        ...us.strategy,
        rules: {
          ...(us.strategy.rules as any ?? {}),
          ...(us.customRules as any ?? {}),
        },
      }));
    }

    if (opts?.userId) {
      signalAllowance = await this.quota.assertSignalQuota(opts.userId);
    }

    try {
      const payload: any = { symbols, timeframe };
      if (strategies && strategies.length) {
        payload.strategies = strategies.map(s => ({
          ...s,
          rules: {
            ...(s.rules as any ?? {}),
            analysis_timeframe: s.analysisTimeframe ?? (s.rules as any)?.analysis_timeframe ?? timeframe,
            entry_timeframe: s.entryTimeframe ?? (s.rules as any)?.entry_timeframe ?? timeframe,
          },
        }));
      }
      const data = await this.engineHttp.post('/scan/multi', payload, { timeout: 90_000, maxRetries: 0 });
      const dataGaps = Array.isArray((data as any)?.data_gaps) ? (data as any).data_gaps : [];
      if (dataGaps.length) {
        this.logger.warn('engine_scan_data_gaps', {
          count: dataGaps.length,
          preview: dataGaps.slice(0, 5),
        });
      }
      const alertUserId = opts?.userId ?? '*';
      const saved = await this.persistence.saveSignals(data.results, alertUserId, {
        signalAllowance,
        userId: opts?.userId,
      });
      // Pass 2 : enrichissement sentiment asynchrone (non bloquant)
      // Met à jour confidence + potentiellement invalide le signal
      setImmediate(() => Promise.resolve(this.persistence.enrichSentimentPass2(saved, data.results, alertUserId)).catch(() => {}));
      return { saved, portfolio_risk: data.portfolio_risk ?? null, data_gaps: dataGaps };
    } catch (e: any) {
      throw new Error(`Engine scan failed: ${e?.message}`);
    }
  }

  getAlertStats(userId: string) {
    return this.alertService.getStats(userId);
  }

  listFeatureSnapshots(opts: { market?: string; outcome?: string; timeframe?: string; limit?: number }) {
    return this.featureStore.listSnapshots(opts);
  }

  async exportFeatureDataset(opts: { market?: string; outcome?: string; timeframe?: string; limit?: number }) {
    const snapshots = await this.featureStore.listSnapshots({
      ...opts,
      limit: opts.limit ?? 1000,
    });

    return snapshots.map((snap: any) => {
      const signal = snap.signal ?? {};
      const asset = signal.asset ?? {};
      const market = asset.market ?? {};
      return {
        signalId: snap.signalId ?? signal.id ?? null,
        symbol: asset.symbol ?? null,
        market: market.name ?? null,
        timeframe: signal.timeframe ?? null,
        direction: signal.signal ?? null,
        confidence: signal.confidence ?? null,
        createdAt: signal.createdAt ?? snap.createdAt ?? null,
        outcome: snap.outcome ?? null,
        pnl: snap.pnl ?? null,
        features: snap.features ?? null,
        concept: snap.concept ?? null,
        embedding: snap.embedding ?? null,
      };
    });
  }

  async findScanHistory(opts: {
    page: number;
    limit: number;
    strategyId?: string;
    strategyName?: string;
    symbol?: string;
    signal?: string;
    timeframe?: string;
  }) {
    const where: any = {};
    if (opts.strategyId) where.strategyId = opts.strategyId;
    if (opts.strategyName) where.strategyName = opts.strategyName;
    if (opts.symbol) where.symbol = opts.symbol;
    if (opts.signal) where.signal = opts.signal;
    if (opts.timeframe) where.timeframe = opts.timeframe;

    const [items, total] = await Promise.all([
      this.prisma.scanHistory.findMany({
        where,
        orderBy: { scannedAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      this.prisma.scanHistory.count({ where }),
    ]);

    return {
      items,
      total,
      page: opts.page,
      limit: opts.limit,
      totalPages: Math.ceil(total / opts.limit),
    };
  }

  /**
   * Ingest a signal from the engine warmup loops.
   * Called by the engine when a warmup scan produces BUY/SELL with confidence >= 70.
   * This bridges the gap between warmup (scan_history only) and SignalCards (signals table).
   */
  async ingestSignal(result: any) {
    if (!result || !result.signal || result.signal === 'NEUTRAL') return null;
    if ((result.confidence ?? 0) < 70) return null;
    try {
      const saved = await this.persistence.saveSignals([result], '*');
      if (saved.length > 0) {
        this.logger.log(
          `ingestSignal: ${result.signal} ${result.symbol} conf=${result.confidence} → Signal ${saved[0].id}`,
        );
      }
      return saved[0] ?? null;
    } catch (e: any) {
      this.logger.warn(`ingestSignal failed: ${e?.message}`);
      return null;
    }
  }

  async backfillTracking() {
    return this.tracker.processActiveSignals();
  }

  async notifyCandleClosed(symbol: string, timeframe: string) {
    return this.tracker.processActiveSignals();
  }

  async getStats(filters?: { strategyId?: string; assetId?: string; timeframe?: string; minConfidence?: number }) {
    return this.stats.getStats(filters);
  }

  async getStatsByStrategy() {
    return this.stats.getStatsByStrategy();
  }

  async getStatsByTimeframe() {
    return this.stats.getStatsByTimeframe();
  }

  async getTrackingSignals(opts: { page: number; limit: number; status?: string }) {
    const where: any = {};
    if (opts.status) where.executionStatus = opts.status;

    const [data, total] = await Promise.all([
      this.prisma.signal.findMany({
        where,
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          asset: { select: { symbol: true, name: true } },
          strategy: { select: { name: true } },
          executionEvents: { orderBy: { candleTime: 'desc' }, take: 5 },
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

  /**
   * Courbe PnL mark-to-market d'un signal, calculée à la volée depuis les
   * bougies Binance. Rien n'est persisté entre les événements — la courbe
   * est reconstruite à l'affichage. PnL = 0 avant ENTRY_HIT.
   */
  async getPnlCurve(signalId: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: {
        asset: true,
        executionEvents: { orderBy: { candleTime: 'asc' } },
      },
    });
    if (!signal) return { points: [], reason: 'not_found' };

    const TF: Record<string, string> = {
      '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
    };

    const interval = TF[signal.timeframe] ?? '1h';
    const entry = signal.entryPrice ? Number(signal.entryPrice) : null;
    if (!entry) return { points: [], reason: 'no_entry_price' };

    const entryEvt = signal.executionEvents.find(e => e.type === 'ENTRY_HIT');
    const endEvt = signal.executionEvents.find(e =>
      ['SL_HIT', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'EXPIRED', 'MANUAL_CLOSE'].includes(e.type),
    );
    const start = new Date(signal.createdAt).getTime();
    const end = endEvt ? new Date(endEvt.candleTime).getTime() : Date.now();

    // Multi-marchés via l'engine : Binance (crypto) + TwelveData/yfinance
    // (forex/métaux) + Deriv (synthétiques) — pas seulement Binance.
    let raw: { t: number; c: number }[] = [];
    try {
      const res = await this.engineHttp.get<any>('/indicators/klines', {
        params: { symbol: signal.asset.symbol, interval, limit: 500 },
        timeout: 15_000,
      });
      raw = (res?.klines ?? []).map((k: any) => {
        // time : epoch secondes (number) ou ISO string selon le provider
        const t = typeof k.time === 'number' ? k.time * 1000 : new Date(k.time).getTime();
        return { t, c: Number(k.close) };
      });
    } catch {
      return { points: [], reason: 'klines_unavailable' };
    }

    const dir = signal.signal === 'SELL' ? -1 : 1;
    const entryTs = entryEvt ? new Date(entryEvt.candleTime).getTime() : null;
    const points = raw
      .filter(k => k.t >= start && k.t <= end)
      .map(k => {
        const active = entryTs !== null && k.t >= entryTs;
        return {
          t: new Date(k.t).toISOString(),
          price: k.c,
          pnl: active ? parseFloat(((dir * (k.c - entry)) / entry * 100).toFixed(3)) : 0,
          active,
        };
      });

    return {
      points,
      entry,
      direction: signal.signal,
      entry_at: entryEvt?.candleTime ?? null,
      final_pnl_pct: signal.finalPnlPct ? Number(signal.finalPnlPct) : null,
    };
  }
}
