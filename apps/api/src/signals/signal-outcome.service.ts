import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureStoreService } from './feature-store.service';
import { engineHeaders } from '../utils/engine-headers.util';
import { SystemHealthService } from '../system-health/system-health.service';

const TF_TO_BARS_LOOKBACK: Record<string, number> = {
  '1m': 60, '5m': 48, '15m': 32, '1h': 24, '4h': 12, '1d': 5,
};

const TF_TO_BINANCE_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
};

@Injectable()
export class SignalOutcomeService {
  private readonly logger = new Logger(SignalOutcomeService.name);
  private engineUrl: string;

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private config: ConfigService,
    private featureStore: FeatureStoreService,
    private health: SystemHealthService,
  ) {
    this.engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
  }

  async logSignal(r: any, market: string) {
    if (!r.signal || r.signal === 'NEUTRAL' || !r.entry_price) return;
    const indicators = r.indicators ?? {};
    const detected = r.detectedPatterns ?? [];
    const topPattern = detected[0] ?? {};
    try {
      // Expected PnL % based on predicted win rate for the confidence bucket
      const expectedPnlPct = await this._estimateExpectedPnlPct(r.confidence, r.risk_reward, market, r.signal);
      await this.prisma.signalLog.create({
        data: {
          symbol:        r.symbol,
          timeframe:     r.timeframe,
          signalType:    r.signal as any,
          confidence:    r.confidence,
          entryPrice:    r.entry_price,
          stopLoss:      r.stop_loss      ?? null,
          takeProfit1:   r.take_profit_1  ?? null,
          takeProfit2:   r.take_profit_2  ?? null,
          riskReward:    r.risk_reward    ?? null,
          signalId:      r.signalId       ?? null,
          scoreTrend:    indicators.score_trend    ?? null,
          scorePA:       indicators.score_pa       ?? null,
          scoreSR:       indicators.score_sr       ?? null,
          scorePatterns: indicators.score_patterns ?? null,
          scoreRegime:   indicators.score_regime   ?? null,
          scoreSMC:      indicators.score_smc      ?? null,
          scoreMTF:      indicators.score_mtf      ?? null,
          scoreSentiment:indicators.score_sentiment?? null,
          scoreBias:      indicators.score_bias      ?? null,
          scoreTotal:    indicators.score_total    ?? r.score ?? r.confidence,
          regime:        r.regime?.regime           ?? null,
          adx:           r.regime?.adx              ?? null,
          market,
          patternName: topPattern.name ?? null,
          patternConfluenceScore: topPattern.confluenceScore ?? null,
          patternConfluenceTags: topPattern.confluenceTags ?? [],
          featureVector: r.feature_vector ?? null,
          metadata: {
            marketContext: r.marketContext ?? r.context ?? null,
            detectedPatterns: detected,
            decisionTrace: r.decisionTrace ?? null,
            explanation: r.explanation ?? null,
          } as any,
          expectedPnlPct,
        },
      });
    } catch (e: any) {
      this.logger.warn(`logSignal failed: ${e?.message}`);
    }
  }

  private async _estimateExpectedPnlPct(
    confidence: number,
    riskReward: number | null | undefined,
    market?: string,
    signalType?: string,
  ): Promise<number | null> {
    if (!riskReward || riskReward <= 0) return null;
    const calibration = await this.getConfidenceCalibration(market, signalType).catch(() => null);
    const bucket = this._confidenceBucket(confidence);
    const b = calibration?.buckets?.[bucket];
    const winRate = b?.winRate ?? 50;
    const winPct = (riskReward - 1) * 100;
    const lossPct = -100;
    return (winRate / 100) * winPct + ((100 - winRate) / 100) * lossPct;
  }

  @Cron('0 * * * *')
  async resolveOutcomes() {
    try {
      this.logger.log('OUTCOME: vérification des signaux PENDING');

      const pending = await this.prisma.signalLog.findMany({
        where: { outcome: 'PENDING' },
        take: 500,
        orderBy: { createdAt: 'asc' },
      });

      let resolved = 0;
      let stillOpen = 0;
      let expired = 0;

      for (const log of pending) {
        try {
          const result = await this._resolveOne(log);
          if (result === 'RESOLVED') resolved++;
          else if (result === 'STILL_OPEN') stillOpen++;
          else if (result === 'EXPIRED') expired++;
        } catch (e: any) {
          this.logger.warn(`resolveOne failed ${log.symbol}: ${e?.message}`);
        }
      }

      this.logger.log(
        `OUTCOME: ${pending.length} vérifiés — ${resolved} résolus, ${stillOpen} encore ouverts, ${expired} expirés`,
      );
      this.health.recordCronRun('resolve-outcomes', 'ok');
    } catch (e: any) {
      this.health.recordCronRun('resolve-outcomes', 'error', e?.message);
    }
  }

  private async _resolveOne(log: any): Promise<'RESOLVED' | 'STILL_OPEN' | 'EXPIRED' | 'SKIP'> {
    const tf = log.timeframe;
    const bars = TF_TO_BARS_LOOKBACK[tf] ?? 24;
    const interval = TF_TO_BINANCE_INTERVAL[tf] ?? '1h';

    const SYMBOL_MAP: Record<string, string> = {
      'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
      'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'ADA/USDT': 'ADAUSDT',
      'XRP/USDT': 'XRPUSDT', 'LINK/USDT': 'LINKUSDT', 'DOT/USDT': 'DOTUSDT',
      'MATIC/USDT': 'MATICUSDT',
    };
    const binanceSym = SYMBOL_MAP[log.symbol];

    // For non-Binance symbols, try resolving via the engine (which has all providers)
    if (!binanceSym) {
      const resolved = await this._resolveViaEngine(log).catch(() => null);
      if (resolved) return 'RESOLVED';
      // Engine resolution failed — check age
      const age = (Date.now() - new Date(log.createdAt).getTime()) / 86_400_000;
      if (age > 5) {
        await this.prisma.signalLog.update({
          where: { id: log.id },
          data: { outcome: 'EXPIRED', outcomeAt: new Date() },
        });
        return 'EXPIRED';
      }
      // Still within window — mark as STILL_OPEN
      if (age > 0.5) {
        await this.prisma.signalLog.update({
          where: { id: log.id },
          data: { outcome: 'STILL_OPEN' },
        });
        return 'STILL_OPEN';
      }
      return 'SKIP';
    }

    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${bars}`;
    const { data } = await firstValueFrom(this.http.get(url));

    const sl      = log.stopLoss    ? parseFloat(log.stopLoss)    : null;
    const tp1     = log.takeProfit1 ? parseFloat(log.takeProfit1) : null;
    const tp2     = log.takeProfit2 ? parseFloat(log.takeProfit2) : null;
    const isBuy   = log.signalType === 'BUY';
    const created = new Date(log.createdAt).getTime();

    let outcome: string | null = null;
    let outcomePrice: number | null = null;
    let barsToOutcome: number | null = null;
    let outcomeAt: Date | null = null;

    for (let i = 0; i < data.length; i++) {
      const bar = data[i];
      const barTs = parseInt(bar[0]);
      if (barTs < created) continue;

      const high = parseFloat(bar[2]);
      const low  = parseFloat(bar[3]);

      if (isBuy) {
        if (tp2 && high >= tp2) { outcome = 'WIN_TP2'; outcomePrice = tp2; }
        else if (tp1 && high >= tp1) { outcome = 'WIN_TP1'; outcomePrice = tp1; }
        else if (sl && low <= sl)    { outcome = 'LOSS_SL'; outcomePrice = sl; }
      } else {
        if (tp2 && low <= tp2)       { outcome = 'WIN_TP2'; outcomePrice = tp2; }
        else if (tp1 && low <= tp1)  { outcome = 'WIN_TP1'; outcomePrice = tp1; }
        else if (sl && high >= sl)   { outcome = 'LOSS_SL'; outcomePrice = sl; }
      }

      if (outcome) {
        barsToOutcome = i;
        outcomeAt = new Date(barTs);
        break;
      }
    }

    // Pas d'outcome sur les bougies récentes — vérifier l'âge
    if (!outcome) {
      const age = (Date.now() - created) / 1000;
      const tfSecs: Record<string, number> = {
        '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
      };
      const maxAgeSec = (tfSecs[tf] ?? 3600) * bars;
      if (age > maxAgeSec) {
        outcome = 'EXPIRED';
        outcomeAt = new Date();
      } else if (age > tfSecs[tf] * 2) {
        // Signal a au moins 2 bougies d'âge mais pas encore expiré → STILL_OPEN
        await this.prisma.signalLog.update({
          where: { id: log.id },
          data: { outcome: 'STILL_OPEN' },
        });
        return 'STILL_OPEN';
      } else {
        // Trop récent — attendre plus de bougies
        return 'SKIP';
      }
    }

    if (outcome) {
      const realizedPnlPct = this._computeRealizedPnlPct(log, outcome, outcomePrice);
      const postTradeScore = realizedPnlPct !== null && log.expectedPnlPct && log.expectedPnlPct !== 0
        ? Math.max(-10, Math.min(10, realizedPnlPct / log.expectedPnlPct))
        : null;

      await this.prisma.signalLog.update({
        where: { id: log.id },
        data: {
          outcome:       outcome as any,
          outcomePrice:  outcomePrice ?? undefined,
          outcomeAt:     outcomeAt ?? undefined,
          barsToOutcome: barsToOutcome ?? undefined,
          realizedPnlPct: realizedPnlPct ?? undefined,
          postTradeScore: postTradeScore ?? undefined,
        },
      });

      if (log.signalId) {
        const pnlPct = realizedPnlPct ?? null;
        await this.featureStore.attachOutcome(log.signalId, outcome, pnlPct);
      }
      return outcome === 'EXPIRED' ? 'EXPIRED' : 'RESOLVED';
    }
    return 'SKIP';
  }

  /**
   * Resolve outcome for non-Binance symbols by fetching recent candles from the engine.
   * The engine has access to all providers (TwelveData, yfinance, Deriv, Binance)
   * so it can fetch OHLCV for Forex, Synthetic, BRVM, Commodities, etc.
   */
  private async _resolveViaEngine(log: any): Promise<boolean> {
    const tf = log.timeframe ?? '1h';
    const bars = TF_TO_BARS_LOOKBACK[tf] ?? 24;
    try {
      const url = `${this.engineUrl}/candles/${encodeURIComponent(log.symbol)}?timeframe=${tf}&limit=${bars}`;
      const { data } = await firstValueFrom(this.http.get(url, { headers: engineHeaders(this.config) }));

      const candles = Array.isArray(data) ? data : (data?.candles ?? []);
      if (!candles || candles.length === 0) return false;

      const sl = log.stopLoss ? parseFloat(log.stopLoss) : null;
      const tp1 = log.takeProfit1 ? parseFloat(log.takeProfit1) : null;
      const tp2 = log.takeProfit2 ? parseFloat(log.takeProfit2) : null;
      const isBuy = log.signalType === 'BUY';
      const created = new Date(log.createdAt).getTime();

      let outcome: string | null = null;
      let outcomePrice: number | null = null;
      let barsToOutcome: number | null = null;
      let outcomeAt: Date | null = null;

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const barTs = typeof c.timestamp === 'number' ? c.timestamp * 1000 : new Date(c.timestamp ?? c.time ?? c.date).getTime();
        if (barTs < created) continue;

        const high = parseFloat(c.high ?? c.h);
        const low = parseFloat(c.low ?? c.l);

        if (isBuy) {
          if (tp2 && high >= tp2) { outcome = 'WIN_TP2'; outcomePrice = tp2; }
          else if (tp1 && high >= tp1) { outcome = 'WIN_TP1'; outcomePrice = tp1; }
          else if (sl && low <= sl) { outcome = 'LOSS_SL'; outcomePrice = sl; }
        } else {
          if (tp2 && low <= tp2) { outcome = 'WIN_TP2'; outcomePrice = tp2; }
          else if (tp1 && low <= tp1) { outcome = 'WIN_TP1'; outcomePrice = tp1; }
          else if (sl && high >= sl) { outcome = 'LOSS_SL'; outcomePrice = sl; }
        }

        if (outcome) {
          barsToOutcome = i;
          outcomeAt = new Date(barTs);
          break;
        }
      }

      if (!outcome) {
        const age = (Date.now() - created) / 1000;
        const tfSecs: Record<string, number> = {
          '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
        };
        if (age > (tfSecs[tf] ?? 3600) * bars) {
          outcome = 'EXPIRED';
          outcomeAt = new Date();
        }
      }

      if (outcome) {
        const realizedPnlPct = this._computeRealizedPnlPct(log, outcome, outcomePrice);
        const postTradeScore = realizedPnlPct !== null && log.expectedPnlPct && log.expectedPnlPct !== 0
          ? Math.max(-10, Math.min(10, realizedPnlPct / log.expectedPnlPct))
          : null;

        await this.prisma.signalLog.update({
          where: { id: log.id },
          data: {
            outcome: outcome as any,
            outcomePrice: outcomePrice ?? undefined,
            outcomeAt: outcomeAt ?? undefined,
            barsToOutcome: barsToOutcome ?? undefined,
            realizedPnlPct: realizedPnlPct ?? undefined,
            postTradeScore: postTradeScore ?? undefined,
          },
        });

        if (log.signalId) {
          await this.featureStore.attachOutcome(log.signalId, outcome, realizedPnlPct ?? null);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private _computeRealizedPnlPct(log: any, outcome: string, outcomePrice: number | null): number | null {
    if (!outcomePrice) return null;
    const entry = parseFloat(log.entryPrice);
    if (!entry || Number.isNaN(entry) || entry === 0) return null;
    const isBuy = log.signalType === 'BUY';
    const pct = isBuy ? (outcomePrice - entry) / entry : (entry - outcomePrice) / entry;
    return Math.round(pct * 100 * 100) / 100;
  }

  async getStats(market?: string) {
    const where: any = { outcome: { not: 'PENDING' } };
    if (market) where.market = { equals: market, mode: 'insensitive' };

    const logs = await this.prisma.signalLog.findMany({ where, take: 2000 });

    const total  = logs.length;
    const winTp1 = logs.filter(l => l.outcome === 'WIN_TP1').length;
    const winTp2 = logs.filter(l => l.outcome === 'WIN_TP2').length;
    const lossSl = logs.filter(l => l.outcome === 'LOSS_SL').length;
    const expired= logs.filter(l => l.outcome === 'EXPIRED').length;

    return {
      total,
      win_tp1: winTp1,
      win_tp2: winTp2,
      loss_sl: lossSl,
      expired,
      win_rate_tp1: total > 0 ? Math.round((winTp1 + winTp2) / total * 100) : null,
      win_rate_tp2: total > 0 ? Math.round(winTp2 / total * 100) : null,
      by_market: market ? null : await this._statsByMarket(),
    };
  }

  private async _statsByMarket() {
    const markets = ['Crypto', 'Forex', 'Indices', 'Commodities', 'Synthetic', 'BRVM'];
    const result: Record<string, any> = {};
    for (const m of markets) {
      result[m] = await this.getStats(m);
      delete result[m].by_market;
    }
    return result;
  }

  async getPatternStats() {
    const where: any = { outcome: { not: 'PENDING' }, patternName: { not: null } };
    const logs = await this.prisma.signalLog.findMany({ where, take: 5000 });

    const stats: Record<string, { trades: number; wins: number; losses: number; pnl: number; winRate: number; avgDuration: number | null; avgConfluence: number | null; avgRealizedPnl: number | null; avgExpectedPnl: number | null }> = {};
    for (const log of logs) {
      const name = log.patternName!;
      if (!stats[name]) {
        stats[name] = { trades: 0, wins: 0, losses: 0, pnl: 0, winRate: 0, avgDuration: null, avgConfluence: null, avgRealizedPnl: null, avgExpectedPnl: null };
      }
      const s = stats[name];
      s.trades += 1;
      if (log.outcome === 'WIN_TP1' || log.outcome === 'WIN_TP2') s.wins += 1;
      else if (log.outcome === 'LOSS_SL') s.losses += 1;
      s.pnl += parseFloat(log.outcomePrice?.toString() ?? '0') - parseFloat(log.entryPrice?.toString() ?? '0');
    }

    for (const name of Object.keys(stats)) {
      const s = stats[name];
      const patternLogs = logs.filter(l => l.patternName === name);
      s.winRate = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      s.avgDuration = patternLogs.length ? patternLogs.reduce((sum, l) => sum + (l.barsToOutcome ?? 0), 0) / patternLogs.length : null;
      s.avgConfluence = patternLogs.filter(l => l.patternConfluenceScore != null).length
        ? patternLogs.reduce((sum, l) => sum + (l.patternConfluenceScore ?? 0), 0) / patternLogs.filter(l => l.patternConfluenceScore != null).length
        : null;
      s.avgRealizedPnl = patternLogs.filter(l => l.realizedPnlPct != null).length
        ? patternLogs.reduce((sum, l) => sum + (l.realizedPnlPct ?? 0), 0) / patternLogs.filter(l => l.realizedPnlPct != null).length
        : null;
      s.avgExpectedPnl = patternLogs.filter(l => l.expectedPnlPct != null).length
        ? patternLogs.reduce((sum, l) => sum + (l.expectedPnlPct ?? 0), 0) / patternLogs.filter(l => l.expectedPnlPct != null).length
        : null;
      s.pnl = Math.round(s.pnl * 100) / 100;
    }
    return { total: logs.length, patterns: stats };
  }

  async getPostTradeAnalysis(market?: string, patternName?: string) {
    const where: any = { outcome: { not: 'PENDING' }, realizedPnlPct: { not: null }, expectedPnlPct: { not: null } };
    if (market) where.market = market;
    if (patternName) where.patternName = patternName;
    const logs = await this.prisma.signalLog.findMany({ where, take: 5000 });

    const avgExpected = logs.length ? logs.reduce((sum, l) => sum + (l.expectedPnlPct ?? 0), 0) / logs.length : 0;
    const avgRealized = logs.length ? logs.reduce((sum, l) => sum + (l.realizedPnlPct ?? 0), 0) / logs.length : 0;
    const bias = avgExpected !== 0 ? (avgRealized - avgExpected) / Math.abs(avgExpected) : 0;

    return {
      sampleSize: logs.length,
      avgExpectedPnlPct: Math.round(avgExpected * 100) / 100,
      avgRealizedPnlPct: Math.round(avgRealized * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      overestimating: bias < -0.1,
      underestimating: bias > 0.1,
    };
  }

  // ─── Confidence feedback loop (Sprint 5) ───────────────────────────────

  private _confidenceBucket(confidence: number): string {
    const low = Math.floor(confidence / 10) * 10;
    const high = low + 10;
    return `${low}-${high}`;
  }

  private _isWinOutcome(outcome: string): boolean {
    return outcome === 'WIN_TP1' || outcome === 'WIN_TP2';
  }

  private _outcomeKey(outcome: string): string {
    if (outcome === 'WIN_TP1' || outcome === 'WIN_TP2') return 'win';
    if (outcome === 'LOSS_SL') return 'loss';
    return 'other';
  }

  async getConfidenceCalibration(market?: string, signalType?: string) {
    const where: any = { outcome: { not: 'PENDING' } };
    if (market) where.market = market;
    if (signalType) where.signalType = signalType;

    const logs = await this.prisma.signalLog.findMany({ where, take: 5000 });

    const buckets: Record<string, { total: number; win: number; loss: number; other: number; winRate: number | null }> = {};
    for (const log of logs) {
      const bucket = this._confidenceBucket(log.confidence);
      if (!buckets[bucket]) {
        buckets[bucket] = { total: 0, win: 0, loss: 0, other: 0, winRate: null };
      }
      const b = buckets[bucket];
      b.total += 1;
      const key = this._outcomeKey(log.outcome);
      if (key === 'win') b.win += 1;
      else if (key === 'loss') b.loss += 1;
      else b.other += 1;
    }

    for (const b of Object.values(buckets)) {
      b.winRate = b.total > 0 ? Math.round((b.win / b.total) * 100) : null;
    }

    return { total: logs.length, buckets };
  }

  async predictWinRate(
    confidence: number,
    market?: string,
    signalType?: string,
  ): Promise<{ confidence: number; bucket: string; predictedWinRate: number | null; sampleSize: number }> {
    const bucket = this._confidenceBucket(confidence);
    const { buckets } = await this.getConfidenceCalibration(market, signalType);
    const b = buckets[bucket];
    if (!b || b.total === 0) {
      return { confidence, bucket, predictedWinRate: null, sampleSize: 0 };
    }
    return {
      confidence,
      bucket,
      predictedWinRate: b.winRate,
      sampleSize: b.total,
    };
  }

  // ─── Market Memory ─ nearest neighbours over signal feature vectors ─────────

  async findSimilar(input: {
    symbol?: string;
    market?: string;
    timeframe?: string;
    confidence?: number;
    scoreTrend?: number;
    scorePA?: number;
    scoreSR?: number;
    scorePatterns?: number;
    scoreRegime?: number;
    scoreSMC?: number;
    scoreMTF?: number;
    scoreSentiment?: number;
    scoreBias?: number;
    scoreTotal?: number;
    riskReward?: number;
    adx?: number;
    top?: number;
  }) {
    const FEATURE_KEYS: (keyof typeof input)[] = [
      'confidence', 'scoreTrend', 'scorePA', 'scoreSR', 'scorePatterns',
      'scoreRegime', 'scoreSMC', 'scoreMTF', 'scoreSentiment', 'scoreBias', 'scoreTotal',
      'riskReward', 'adx',
    ];

    const inputVec = this._toVector(input, FEATURE_KEYS);

    const where: any = { outcome: { not: 'PENDING' } };
    if (input.symbol) where.symbol = input.symbol;
    else if (input.market) where.market = input.market;

    const logs = await this.prisma.signalLog.findMany({
      where,
      take: 2000,
      orderBy: { createdAt: 'desc' },
    });

    const scored = logs
      .map(log => {
        const logVec = this._toVector(log as any, FEATURE_KEYS);
        const dist = this._euclidean(inputVec, logVec);
        const similarity = Math.max(0, Math.min(100, Math.round((1 / (1 + dist)) * 100)));
        return { ...log, similarity, distance: dist };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, input.top ?? 10);

    return {
      input: inputVec,
      count: scored.length,
      neighbours: scored,
    };
  }

  private _toVector(obj: any, keys: string[]): number[] {
    const maxs: Record<string, number> = {
      confidence: 100, scoreTrend: 100, scorePA: 100, scoreSR: 100,
      scorePatterns: 100, scoreRegime: 100, scoreSMC: 100, scoreMTF: 100,
      scoreSentiment: 100, scoreBias: 100, scoreTotal: 100, riskReward: 10, adx: 100,
    };
    return keys.map(k => {
      const v = typeof obj[k] === 'number' && !Number.isNaN(obj[k]) ? (obj[k] as number) : 0;
      const scale = maxs[k] || 1;
      return v / scale;
    });
  }

  private _euclidean(a: number[], b: number[]): number {
    return Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
  }
}
