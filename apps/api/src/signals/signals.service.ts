import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertService } from '../notifications/alert.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { FeatureStoreService } from './feature-store.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { SignalPredictorService, SignalFeatures } from './signal-predictor.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { ExpectedMoveService } from '../expected-move/expected-move.service';
import { MarketDataService } from '../market-data/market-data.service';
import { QuotaService } from '../billing/quota.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { SystemHealthService } from '../system-health/system-health.service';

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private alertService: AlertService,
    private outcomeService: SignalOutcomeService,
    private predictor: SignalPredictorService,
    private featureStore: FeatureStoreService,
    private regimeClassifier: RegimeClassifierService,
    private marketData: MarketDataService,
    private quota: QuotaService,
    private engineHttp: EngineHttpService,
    private health: SystemHealthService,
    private patternPredictor: PatternPredictorService,
    private expectedMove: ExpectedMoveService,
  ) {}

  private async predictMlRegime(symbol?: string, timeframe?: string): Promise<string | null> {
    // Fetch real historical closes from the engine instead of fabricating prices
    const sym = symbol ?? 'BTC/USDT';
    const tf = timeframe ?? '1d';
    try {
      const data = await this.engineHttp.get(`/candles/${encodeURIComponent(sym)}`, { params: { timeframe: tf, limit: 200 } });
      const candles = Array.isArray(data) ? data : (data?.candles ?? []);
      const prices: number[] = candles
        .map((c: any) => parseFloat(c.close ?? c.c ?? c.price))
        .filter((p: number) => !isNaN(p) && p > 0);
      if (prices.length < 5) return null;
      const response = await this.regimeClassifier.predict(prices);
      return Array.isArray(response?.regimes) && response.regimes.length > 0
        ? response.regimes[response.regimes.length - 1]
        : null;
    } catch (error) {
      this.logger.warn('predict_ml_regime_failed', { error: (error as any)?.message ?? error });
      return null;
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

  private async predictMlConfidence(raw: any) {
    if (!raw) return null;
    try {
      const response = await this.predictor.predict({
        confidence: raw.confidence ?? 0,
        scoreTotal: raw.score ?? raw.score_total ?? raw.confidence ?? 0,
        scoreTrend: raw.score_trend,
        scorePA: raw.score_pa,
        scoreSR: raw.score_sr,
        scorePatterns: raw.score_patterns,
        scoreRegime: raw.score_regime,
        scoreSMC: raw.score_smc,
        scoreMTF: raw.score_mtf,
        scoreSentiment: raw.score_sentiment,
        adx: raw.regime?.adx ?? raw.adx,
        riskReward: raw.risk_reward,
        patternConfluenceScore: raw.pattern_confluence_score,
      });
      return response?.confidence_ml ?? (response?.probability ? Math.round(response.probability * 10000) / 100 : null);
    } catch (error) {
      this.logger.warn('predict_ml_confidence_failed', { error: (error as any)?.message ?? error });
      return null;
    }
  }

  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async scheduledMorningScan() {
    this.logger.log('CRON: lancement du scan matinal (06:00 UTC)');
    try {
      await this._scanActiveAssetsByTimeframe();
      this.health.recordCronRun('morning-scan', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('morning-scan', 'error', e?.message);
    }
  }

  @Cron('0 */4 * * *', { timeZone: 'UTC' })
  async scheduledDayScan() {
    this.logger.log('CRON: lancement du scan toutes les 4h');
    try {
      await this._scanActiveAssetsByTimeframe();
      this.health.recordCronRun('day-scan', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('day-scan', 'error', e?.message);
    }
  }

  @Cron('15 */6 * * *', { timeZone: 'UTC' })
  async scheduledPredictorTraining() {
    try {
      await this.trainPredictor({ market: 'CRYPTO', timeframe: '1h' });
      this.health.recordCronRun('predictor-training', 'ok');
    } catch (error) {
      this.logger.warn('scheduled_predictor_train_failed', { error: (error as any)?.message ?? error });
      this.health.recordCronRun('predictor-training', 'error', (error as any)?.message);
    }
  }

  @Cron('45 */6 * * *', { timeZone: 'UTC' })
  async scheduledPatternPredictorTraining() {
    try {
      const result = await this.patternPredictor.train();
      this.health.recordCronRun('pattern-predictor-training', result.trained ? 'ok' : 'error');
    } catch (error) {
      this.logger.warn('scheduled_pattern_predictor_train_failed', { error: (error as any)?.message ?? error });
      this.health.recordCronRun('pattern-predictor-training', 'error', (error as any)?.message);
    }
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

  async findAll(opts: { page: number; limit: number; sort: string; profile?: string; market?: string }) {
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
      const data = await this.engineHttp.post('/scan/multi', payload, { timeout: 30_000 });
      const dataGaps = Array.isArray((data as any)?.data_gaps) ? (data as any).data_gaps : [];
      if (dataGaps.length) {
        this.logger.warn('engine_scan_data_gaps', {
          count: dataGaps.length,
          preview: dataGaps.slice(0, 5),
        });
      }
      const alertUserId = opts?.userId ?? '*';
      const saved = await this.saveSignals(data.results, alertUserId, {
        signalAllowance,
        userId: opts?.userId,
      });
      // Pass 2 : enrichissement sentiment asynchrone (non bloquant)
      // Met à jour confidence + potentiellement invalide le signal
      setImmediate(() => Promise.resolve(this._enrichSentimentPass2(saved, data.results, alertUserId)).catch(() => {}));
      return { saved, portfolio_risk: data.portfolio_risk ?? null, data_gaps: dataGaps };
    } catch (e: any) {
      throw new Error(`Engine scan failed: ${e?.message}`);
    }
  }

  private async _buildMarketContext() {
    try {
      const [fearGreed, fundingRates, onChainBtc, onChainEth, economicCalendar, spotPerpBasis, cotBtc, cotEth] = await Promise.all([
        this.marketData.getFearGreed(1).catch(() => [] as any[]),
        this.marketData.getFundingRates().catch(() => [] as any[]),
        this.marketData.getOnChainBtc().catch(() => null),
        this.marketData.getOnChainEth().catch(() => null),
        this.marketData.getEconomicCalendar().catch(() => [] as any[]),
        this.marketData.getSpotPerpBasis().catch(() => [] as any[]),
        this.marketData.getCot('BTC').catch(() => null),
        this.marketData.getCot('ETH').catch(() => null),
      ]);
      return {
        fearGreed: fearGreed[0] ?? null,
        fundingRates,
        onChainBtc,
        onChainEth,
        economicCalendar,
        spotPerpBasis,
        cotBtc,
        cotEth,
      };
    } catch (e: any) {
      this.logger.warn(`Market context fetch failed: ${e?.message}`);
      return null;
    }
  }

  private _buildDecisionTrace(r: any, marketContext: any) {
    const why: { label: string; score: number }[] = [];
    const whyNot: { label: string; score: number }[] = [];

    const mtf = r.mtf_context ?? {};
    const regime = r.regime ?? {};
    const pa = r.price_action ?? {};
    const smc = r.smc ?? {};
    const pats = r.patterns ?? {};
    const news = r.news_sentiment;
    const macro = marketContext ?? {};

    if (pa.bos) why.push({ label: `Break of Structure (${pa.bos_dir})`, score: 8 });
    if (pa.choch) why.push({ label: 'Change of Character', score: 7 });
    if (mtf.confluence === 'FULL') why.push({ label: 'Confluence MTF complète', score: 9 });
    else if (mtf.confluence === 'PARTIAL') why.push({ label: 'Confluence MTF partielle', score: 5 });
    if (mtf.mtf_aligned) why.push({ label: `Alignement ${mtf.mtf}`, score: 6 });
    if (smc.ob?.near_bullish_ob || smc.ob?.near_bearish_ob) why.push({ label: 'Order Block proche', score: 7 });
    if (smc.fvg?.near_bullish_fvg || smc.fvg?.near_bearish_fvg) why.push({ label: 'Fair Value Gap exploitable', score: 6 });
    if (smc.liquidity?.near_eqh || smc.liquidity?.near_eql) why.push({ label: 'Liquidité majeure proche', score: 6 });
    if (pats.pin_bar) why.push({ label: 'Pin bar confirmante', score: 5 });
    if (pats.engulfing) why.push({ label: 'Engulfing confirmant', score: 6 });
    if (regime.regime?.includes('TRENDING')) why.push({ label: `Régime ${regime.regime}`, score: regime.adx && regime.adx >= 25 ? 8 : 5 });
    if (news && (news.bonus ?? 0) > 0) why.push({ label: `Sentiment news positif (+${news.bonus})`, score: Math.min(8, news.bonus) });
    if (macro.fearGreed && macro.fearGreed.classification) {
      const fg = macro.fearGreed.value ?? 50;
      const bullish = r.signal === 'BUY' && fg <= 45;
      const bearish = r.signal === 'SELL' && fg >= 55;
      if (bullish || bearish) why.push({ label: `Fear & Greed favorable (${fg})`, score: 4 });
      else whyNot.push({ label: `Fear & Greed défavorable (${fg})`, score: 4 });
    }

    if (mtf.htf_aligned === false) whyNot.push({ label: `Désalignement HTF (${mtf.htf_regime})`, score: 7 });
    if (regime.regime?.includes('VOLATILE')) whyNot.push({ label: 'Régime volatile', score: 8 });
    if (regime.adx !== undefined && regime.adx < 20) whyNot.push({ label: 'ADX faible / tendance incertaine', score: 6 });
    if (pa.structure?.includes('RANGE')) whyNot.push({ label: 'Prix en range', score: 5 });
    if (news && (news.bonus ?? 0) < 0) whyNot.push({ label: `Sentiment news négatif (${news.bonus})`, score: Math.min(7, Math.abs(news.bonus)) });
    if ((r.confidence ?? 0) < 55) whyNot.push({ label: 'Confiance globale < 55%', score: 6 });
    const highImpactEvent = (macro.economicCalendar ?? []).slice(0, 3).find((e: any) => e.impact === 'High');
    if (highImpactEvent) whyNot.push({ label: `Evénement macro haut impact : ${highImpactEvent.title}`, score: 5 });

    const whyScore = why.reduce((s, it) => s + it.score, 0);
    const whyNotScore = whyNot.reduce((s, it) => s + it.score, 0);
    const netScore = Math.max(0, Math.min(100, 50 + (whyScore - whyNotScore) * 2));

    return { why, whyNot, netScore };
  }

  private _opportunityScore(r: any): number {
    const base = (r.score ?? r.confidence ?? 0) / 100;
    const rr = r.risk_reward ?? 1;
    const rrBonus = rr >= 2 ? 0.15 : rr >= 1.5 ? 0.08 : 0;
    return Math.min(1, base + rrBonus);
  }

  private async saveSignals(
    results: any[],
    alertUserId = '*',
    opts?: { signalAllowance?: { limit: number | null; used: number } | null; userId?: string },
  ) {
    const defaultStrategy = await this.prisma.strategy.findFirst({ where: { name: 'EMA Trend + RSI' } });
    const marketContext = await this._buildMarketContext();

    const saved: any[] = [];
    let quotaRemaining = opts?.signalAllowance?.limit != null
      ? Math.max(0, opts.signalAllowance.limit - opts.signalAllowance.used)
      : null;
    let signalsCounted = 0;
    for (const r of results) {
      // Ne pas persister les signaux encore en attente de confirmation hystérésis
      if (!r.signal || r.signal === 'NEUTRAL' || r.confidence < 50) continue;
      // signal_pending from hysteresis (not yet confirmed by 2 scans) → skip
      // signal_pending from RETEST/LIMIT trigger → persist as PENDING status
      const isHysteresisPending = r.signal_pending === true && r.trigger !== 'RETEST' && r.trigger !== 'LIMIT';
      if (isHysteresisPending) continue;

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
        // BRVM signals have no strategy_id — don't mislabel them as 'EMA Trend + RSI'
        // Only use defaultStrategy for crypto/forex signals that should have one
        const isBrvm = !r.symbol.includes('/') || (r.symbol.length <= 5 && !r.symbol.includes('/'));
        if (!isBrvm) {
          strategy = defaultStrategy;
        }
      }
      if (!strategy) continue;

      // Détecter si le sentiment est déjà enrichi ou encore en attente
      const sentimentPresent = !!(r.news_sentiment || r.scraper_sentiment);
      const decisionTrace = this._buildDecisionTrace(r, marketContext);

      let expectedMoveDetails: any = null;
      let expectedMoveSummary: any = null;
      if (r.signal && r.signal !== 'NEUTRAL' && r.timeframe) {
        expectedMoveDetails = await this.fetchExpectedMove(r.symbol, r.timeframe).catch(() => null);
        expectedMoveSummary = this.buildExpectedMoveSummary(expectedMoveDetails) ?? this.buildExpectedMoveSummary(r.expected_move);
      } else if (r.expected_move) {
        expectedMoveSummary = this.buildExpectedMoveSummary(r.expected_move);
      }
      const expectedMoveSnapshot = expectedMoveSummary ?? r.expected_move ?? null;

      const mlConfidence = await this.predictMlConfidence(r);
      const mlRegime = await this.predictMlRegime(r.symbol, r.timeframe);

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
          status: r.signal_pending ? 'PENDING' : 'ACTIVE',
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
            analysisTimeframe: r.analysis_timeframe ?? r.analysisTimeframe ?? null,
            entryTimeframe:    r.entry_timeframe ?? r.entryTimeframe ?? null,
            persistence_score: r.persistence_score ?? null,
            signal_sticky:     r.signal_sticky ?? null,
            success_probability: r.success_probability ?? null,
            expected_move:     r.expected_move ?? expectedMoveSummary ?? null,
            expected_move_engine: expectedMoveDetails ?? null,
            expected_move_summary: expectedMoveSummary ?? null,
            feature_vector:    r.feature_vector ?? null,
            ml_confidence:     mlConfidence,
            ml_regime:         mlRegime,
            context:           r.context ?? null,
            marketContext:     marketContext as any,
            decisionTrace:     decisionTrace,
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

      if (r.feature_vector) {
        await this.featureStore.upsertSnapshot({
          signalId: signal.id,
          features: r.feature_vector,
          concept: r.market_concept_vector ?? r.marketConcept ?? null,
          embedding: r.market_embedding ?? null,
          symbol: r.symbol,
          market: asset.market?.name ?? null,
          timeframe: r.timeframe ?? null,
          direction: r.signal,
          confidence: r.confidence ?? null,
          mlConfidence: mlConfidence ?? null,
          mlRegime: mlRegime ?? null,
          expectedMove: expectedMoveSnapshot,
          source: r.feature_source ?? 'engine.scan',
        });
      }

      // Feedback loop : signal log pour calibration / ML
      Promise.resolve(
        this.outcomeService.logSignal(
          { ...r, signalId: signal.id, marketContext: marketContext ?? r.context ?? null },
          asset.market?.name ?? 'UNKNOWN',
        ),
      ).catch(() => {});

      // Notifier seulement si le sentiment est déjà appliqué,
      // sinon le pass 2 notifiera après validation
      if (sentimentPresent) {
        const unlimited = quotaRemaining == null;
        const canSend =
          alertUserId === '*' || unlimited || (quotaRemaining ?? 0) > 0;
        if (canSend) {
          if (alertUserId !== '*') {
            if (!unlimited && quotaRemaining != null) {
              quotaRemaining -= 1;
            }
            signalsCounted += 1;
          }
          this.alertService.sendSignal(alertUserId, {
            symbol: r.symbol,
            signal: r.signal,
            confidence: r.confidence,
            timeframe: r.timeframe,
            opportunityScore: this._opportunityScore(r),
            expectedMove: expectedMoveSummary ?? undefined,
            mlConfidence: mlConfidence ?? undefined,
            mlRegime: mlRegime ?? undefined,
          });
        }
      }
    }
    if (opts?.userId && signalsCounted > 0) {
      await this.quota.incrementSignalUsage(opts.userId, signalsCounted);
    }
    return saved;
  }

  private async _enrichSentimentPass2(saved: any[], rawResults: any[], alertUserId = '*') {
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
      this.alertService.sendSignal(alertUserId, {
        symbol: sym,
        signal: raw.signal,
        confidence: newConf,
        timeframe: raw.timeframe,
        opportunityScore: this._opportunityScore(raw),
        expectedMove: (signal.metadata as any)?.expected_move_summary ?? undefined,
        mlConfidence: (signal.metadata as any)?.ml_confidence ?? undefined,
        mlRegime: (signal.metadata as any)?.ml_regime ?? undefined,
      });
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

  private async fetchExpectedMove(symbol: string, timeframe: string) {
    // #45 fix: delegate to ExpectedMoveService (single cache, single engine call)
    try {
      return await this.expectedMove.getExpectedMove(symbol, timeframe, undefined, 400);
    } catch {
      return null;
    }
  }

  private buildExpectedMoveSummary(data: any) {
    if (!data) return null;
    if (data.ranges && data.ranges.length) {
      const preferred = data.ranges.find((r: any) => r.horizon === 5) ?? data.ranges[0];
      return {
        move: preferred.move,
        move_pct: preferred.move_pct,
        horizon: preferred.horizon,
        upper: preferred.upper,
        lower: preferred.lower,
        volatility_regime: data.volatility_regime,
        atr_pct: data.atr_pct,
      };
    }
    if (data.value != null || data.pct != null) {
      return {
        move: data.value ?? null,
        move_pct: data.pct ?? null,
        horizon: null,
      };
    }
    return null;
  }
}
