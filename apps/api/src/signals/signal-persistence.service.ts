import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertService } from '../notifications/alert.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { FeatureStoreService } from './feature-store.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { SignalPredictorService } from './signal-predictor.service';
import { ExpectedMoveService } from '../expected-move/expected-move.service';
import { MarketDataService } from '../market-data/market-data.service';
import { QuotaService } from '../billing/quota.service';
import { EngineHttpService } from '../engine/engine-http.service';

/**
 * Persistance des signaux produits par le scan engine : dédup, création
 * d'assets à la volée, enrichissement (ML, expected move, market context),
 * feature store, SignalLog et notifications — plus le pass 2 sentiment
 * asynchrone qui valide/invalide les signaux persistés.
 *
 * Extrait de SignalsService (god-service) — ce service ne connaît ni les
 * crons ni l'orchestration du scan, uniquement le chemin "résultats engine
 * → base de données".
 */
@Injectable()
export class SignalPersistenceService {
  private readonly logger = new Logger(SignalPersistenceService.name);

  // engine asset_type → marché BDD (name + MarketType pour upsert)
  private static readonly ASSET_TYPE_TO_MARKET: Record<string, { name: string; type: string }> = {
    CRYPTO: { name: 'Crypto', type: 'CRYPTO' },
    FOREX: { name: 'Forex', type: 'FOREX' },
    SYNTHETIC: { name: 'Synthetic', type: 'SYNTHETIC' },
    COMMODITY: { name: 'Commodities', type: 'COMMODITIES' },
    US_STOCK: { name: 'Indices', type: 'INDICES' },
    BRVM: { name: 'BRVM', type: 'STOCKS' },
  };

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
    private outcomeService: SignalOutcomeService,
    private featureStore: FeatureStoreService,
    private predictor: SignalPredictorService,
    private regimeClassifier: RegimeClassifierService,
    private marketData: MarketDataService,
    private quota: QuotaService,
    private engineHttp: EngineHttpService,
    private expectedMove: ExpectedMoveService,
  ) {}

  private _ttlForTimeframe(tf: string | undefined | null): number {
    const TTL_MAP: Record<string, number> = {
      '5m':  10,
      '15m': 25,
      '1h':  90,
      '4h':  360,
      '1d':  720,
    };
    return TTL_MAP[tf ?? ''] ?? 240;
  }

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

  // Fallback heuristique quand asset_type est absent — miroir de get_asset_type() côté engine
  private _inferMarket(symbol: string, assetType?: string | null) {
    const t = assetType?.toUpperCase();
    if (t && SignalPersistenceService.ASSET_TYPE_TO_MARKET[t]) return SignalPersistenceService.ASSET_TYPE_TO_MARKET[t];
    if (symbol.endsWith('/USDT')) return SignalPersistenceService.ASSET_TYPE_TO_MARKET.CRYPTO;
    if (/^(VIX|JUMP|BOOM|CRASH|V\d+|STPRNG|STEP|RB\d+)/i.test(symbol)) return SignalPersistenceService.ASSET_TYPE_TO_MARKET.SYNTHETIC;
    if (['XAU/USD', 'XAG/USD', 'WTI/USD', 'BRENT/USD'].includes(symbol)) return SignalPersistenceService.ASSET_TYPE_TO_MARKET.COMMODITY;
    if (symbol.includes('/')) return SignalPersistenceService.ASSET_TYPE_TO_MARKET.FOREX;
    return SignalPersistenceService.ASSET_TYPE_TO_MARKET.BRVM;
  }

  private _assetDisplayName(symbol: string): string {
    const m = symbol.match(/^(V|VIX|JUMP|BOOM|CRASH)(\d+)$/i);
    if (m) {
      const label = { V: 'Volatility', VIX: 'Volatility', JUMP: 'Jump', BOOM: 'Boom', CRASH: 'Crash' }[m[1].toUpperCase()];
      return `${label} ${m[2]} Index`;
    }
    return symbol;
  }

  // Crée l'Asset (et le Market si absent) pour les symboles scannés non seedés —
  // sinon les signaux ≥70% de ces symboles n'étaient jamais persistés.
  private async _ensureAsset(r: any) {
    const mkt = this._inferMarket(r.symbol, r.asset_type);
    if (!mkt) return null;
    try {
      const market = await this.prisma.market.upsert({
        where: { name: mkt.name },
        create: { name: mkt.name, type: mkt.type as any },
        update: {},
      });
      return await this.prisma.asset.create({
        data: {
          symbol: r.symbol,
          name: this._assetDisplayName(r.symbol),
          marketId: market.id,
          baseCurrency: r.symbol.includes('/') ? r.symbol.split('/')[1] : 'USD',
          metadata: { auto_created: true, asset_type: r.asset_type ?? null },
        },
        include: { market: { select: { name: true } } },
      });
    } catch {
      // Course concurrente entre ingests — l'asset existe déjà
      return this.prisma.asset.findUnique({
        where: { symbol: r.symbol },
        include: { market: { select: { name: true } } },
      });
    }
  }

  async saveSignals(
    results: any[],
    alertUserId = '*',
    opts?: { signalAllowance?: { limit: number | null; used: number } | null; userId?: string },
  ) {
    const defaultStrategy = await this.prisma.strategy.findFirst({ where: { name: 'EMA Trend + RSI' } });
    const marketContext = await this._buildMarketContext();

    // ── Lookups bulk : 1 requête assets + 1 requête strategies pour tout
    //    le batch, au lieu de 2 requêtes par signal ─────────────────────
    const actionable = results.filter(r => r.signal && r.signal !== 'NEUTRAL');
    const persistable = actionable.filter(r => r.confidence >= 50);
    const symbols = [...new Set(actionable.map(r => r.symbol))];
    const assetMap = new Map<string, any>(
      (symbols.length
        ? await this.prisma.asset.findMany({
            where: { symbol: { in: symbols } },
            include: { market: { select: { name: true } } },
          })
        : []
      ).map(a => [a.symbol, a]),
    );
    // Crée les assets manquants (rare) — seuls les signaux persistés en ont
    // besoin ; le pre-pass SignalLog retombe sur 'UNKNOWN' sinon.
    for (const r of persistable) {
      if (!assetMap.has(r.symbol)) {
        const created = await this._ensureAsset(r);
        if (created) {
          assetMap.set(r.symbol, created);
          this.logger.log(`auto-created asset ${r.symbol} (market=${created.market?.name})`);
        }
      }
    }
    const stratIds = [...new Set(persistable.map(r => r.strategy_id).filter(Boolean))] as string[];
    const strategyMap = new Map<string, any>(
      (stratIds.length
        ? await this.prisma.strategy.findMany({ where: { id: { in: stratIds } } })
        : []
      ).map(s => [s.id, s]),
    );

    // ── Dédup : un signal (assetId, signal, timeframe) déjà ACTIVE/PENDING
    //    est suivi par le tracker — ne pas le recréer à chaque scan ────────
    const assetIds = [...assetMap.values()].map((a: any) => a.id);
    const liveSignals = assetIds.length
      ? await this.prisma.signal.findMany({
          where: { assetId: { in: assetIds }, status: { in: ['ACTIVE', 'PENDING'] }, isActive: true },
          select: { assetId: true, signal: true, timeframe: true },
        })
      : [];
    const liveSignalKeys = new Set(liveSignals.map(s => `${s.assetId}:${s.signal}:${s.timeframe}`));

    const saved: any[] = [];
    let quotaRemaining = opts?.signalAllowance?.limit != null
      ? Math.max(0, opts?.signalAllowance?.limit - opts?.signalAllowance?.used)
      : null;
    let signalsCounted = 0;

    // ── Pre-pass: log ALL BUY/SELL signals into SignalLog for calibration ──
    // This eliminates the survivorship bias: we record every signal generated
    // by the engine (even confidence < 50) so the Outcome Tracker can measure
    // the real win rate per confidence bucket and optimize the threshold.
    // signalId=null means the signal was not persisted as a Signal entity.
    for (const r of actionable) {
      if (!r.entry_price) continue;
      const _asset = assetMap.get(r.symbol);
      Promise.resolve(
        this.outcomeService.logSignal(
          { ...r, signalId: null, marketContext: marketContext ?? r.context ?? null },
          _asset?.market?.name ?? 'UNKNOWN',
        ),
      ).catch(() => {});
    }

    for (const r of persistable) {
      // signal_pending from hysteresis is now persisted with PENDING status
      // so it appears as a SignalCard and can be tracked through confirmation

      const asset = assetMap.get(r.symbol);
      if (!asset) continue;

      // Dédup batch + cross-scan : un signal identique déjà live n'est pas recréé
      const liveKey = `${asset.id}:${r.signal}:${r.timeframe}`;
      if (liveSignalKeys.has(liveKey)) continue;
      liveSignalKeys.add(liveKey);

      let strategy: any = r.strategy_id ? strategyMap.get(r.strategy_id) : null;
      if (!strategy) {
        // BRVM signals have no strategy_id — don't mislabel them as 'EMA Trend + RSI'
        // Only use defaultStrategy for crypto/forex signals that should have one
        const isBrvm = asset.market?.name === 'BRVM';
        if (!isBrvm) {
          strategy = defaultStrategy;
        }
      }
      if (!strategy) continue;

      // Détecter si le sentiment est déjà enrichi ou encore en attente
      const sentimentPresent = !!(r.news_sentiment || r.scraper_sentiment);
      const decisionTrace = this._buildDecisionTrace(r, marketContext);

      // Enrichissements indépendants en parallèle (3 round-trips → 1)
      const [expectedMoveDetails, mlConfidence, mlRegime] = await Promise.all([
        r.timeframe ? this.fetchExpectedMove(r.symbol, r.timeframe).catch(() => null) : Promise.resolve(null),
        this.predictMlConfidence(r),
        this.predictMlRegime(r.symbol, r.timeframe),
      ]);
      const expectedMoveSummary =
        this.buildExpectedMoveSummary(expectedMoveDetails) ?? this.buildExpectedMoveSummary(r.expected_move);
      const expectedMoveSnapshot = expectedMoveSummary ?? r.expected_move ?? null;

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
            risk_level:        r.risk_level ?? null,
            market_cap_tier:   r.market_cap_tier ?? null,
            liquidity_score:   r.liquidity_score ?? null,
            max_position_pct:  r.max_position_pct ?? null,
            risk_level_reasons: r.risk_level_reasons ?? null,
            red_flags:         r.red_flags ?? null,
            moonshot_tp:       r.moonshot_tp ?? null,
            dca_tranches:      r.dca_tranches ?? null,
            scale_out:         r.scale_out ?? null,
            scale_out_tp:      r.scale_out_tp ?? null,
            quality_score:     r.quality_score ?? null,
            quality_flags:     r.quality_flags ?? null,
            quality_size_multiplier: r.quality_size_multiplier ?? null,
            fundamentals:      r.fundamentals ?? null,
          },
          explanation: r.explanation,
          expiresAt: new Date(Date.now() + this._ttlForTimeframe(r.timeframe) * 60 * 1000),
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

      // Market Memory : stocker le pattern pour le rappel de setups similaires
      // (fire-and-forget — un échec ne doit jamais bloquer la persistance)
      void this.engineHttp.post('/memory/store', {
        symbol: r.symbol,
        timeframe: r.timeframe,
        signal_type: r.signal,
        signal_id: signal.id,
        metadata: {
          price_action: r.price_action, smc: r.smc, patterns: r.patterns,
          regime: r.regime, mtf_context: r.mtf_context,
          risk_reward: r.risk_reward, confidence: r.confidence,
          news_sentiment: r.news_sentiment ?? r.scraper_sentiment ?? null,
        },
      }, { timeout: 3000 }).catch((err) => {
        this.logger.debug(`market_memory store failed for ${signal.id}: ${(err as Error)?.message}`);
      });

      // Always store features in FeatureStore for every BUY/SELL signal
      const indicators = r.indicators ?? {};
      const autoFeatureVector = r.feature_vector ?? {
        score_trend:     indicators.score_trend     ?? null,
        score_pa:        indicators.score_pa        ?? null,
        score_sr:        indicators.score_sr        ?? null,
        score_patterns:  indicators.score_patterns  ?? null,
        score_regime:    indicators.score_regime    ?? null,
        score_smc:       indicators.score_smc       ?? null,
        score_mtf:       indicators.score_mtf       ?? null,
        score_sentiment: indicators.score_sentiment ?? null,
        score_bias:      indicators.score_bias      ?? null,
        score_total:     indicators.score_total     ?? r.score ?? r.confidence ?? null,
        rsi:             indicators.rsi             ?? null,
        ema20:           indicators.ema20           ?? null,
        ema50:           indicators.ema50           ?? null,
        ema200:          indicators.ema200          ?? null,
        macd:            indicators.macd            ?? null,
        macd_signal:     indicators.macd_signal     ?? null,
        macd_hist:       indicators.macd_hist       ?? null,
        bb_bw:           indicators.bb_bw           ?? null,
        atr:             indicators.atr             ?? null,
        adx:             r.regime?.adx              ?? indicators.adx ?? null,
        volume_ratio:    indicators.volume_ratio    ?? null,
        confidence:      r.confidence               ?? null,
        risk_reward:     r.risk_reward              ?? null,
      };
      await this.featureStore.upsertSnapshot({
        signalId: signal.id,
        features: autoFeatureVector,
        concept: r.market_concept_vector ?? r.marketContext ?? null,
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
      }).catch(() => {});

      // Link the SignalLog entry (created in pre-pass) to the persisted Signal
      // so the Outcome Tracker can attach the outcome to the Feature Store.
      if (r.signal && r.signal !== 'NEUTRAL' && r.entry_price) {
        Promise.resolve(
          this.prisma.signalLog.updateMany({
            where: {
              symbol: r.symbol,
              timeframe: r.timeframe,
              signalId: null,
              signalType: r.signal as any,
              strategyId: strategy.id,
              createdAt: { gte: new Date(Date.now() - 60_000) },
            },
            data: { signalId: signal.id },
          }),
        ).catch(() => {});
      }

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

  async enrichSentimentPass2(saved: any[], rawResults: any[], alertUserId = '*') {
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
            news_sentiment:     raw.news_sentiment     ?? null,
            scraper_sentiment:  raw.scraper_sentiment  ?? null,
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
