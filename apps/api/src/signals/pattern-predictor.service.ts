import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PatternFeaturesInput {
  patternName: string;
  patternConfluenceScore?: number;
  scoreTotal?: number;
  adx?: number;
  riskReward?: number;
  signalType?: 'BUY' | 'SELL';
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function normalize(v: number, min: number, max: number): number {
  if (max === min) return 0;
  return (v - min) / (max - min);
}

@Injectable()
export class PatternPredictorService {
  private readonly logger = new Logger(PatternPredictorService.name);
  private patterns: string[] = [];
  private weights: number[] | null = null;
  private bias = 0;
  private mins: number[] = [];
  private maxs: number[] = [];
  private accuracy: number | null = null;
  private lastTrainCount = 0;

  constructor(private prisma: PrismaService) {}

  async train(market?: string) {
    const where: any = {
      outcome: { in: ['WIN_TP1', 'WIN_TP2', 'LOSS_SL'] },
      patternName: { not: null },
    };
    if (market) where.market = market;

    const logs = await this.prisma.signalLog.findMany({ where, take: 5000 });
    if (logs.length < 10) {
      this.logger.warn('PatternPredictor: pas assez de données pour entraîner');
      return { trained: false, reason: 'too few samples', count: logs.length };
    }

    this.patterns = Array.from(new Set(logs.map(l => l.patternName ?? 'UNKNOWN'))).sort();
    const rows = logs.map(log => this._toFeatures(log as any, this.patterns));
    const labels = logs.map(log =>
      log.outcome === 'WIN_TP1' || log.outcome === 'WIN_TP2' ? 1 : 0,
    );

    this.mins = rows[0].map((_, i) => Math.min(...rows.map(r => r[i])));
    this.maxs = rows[0].map((_, i) => Math.max(...rows.map(r => r[i])));

    const X = rows.map(r => r.map((v, i) => normalize(v, this.mins[i], this.maxs[i])));

    const nFeatures = X[0].length;
    this.weights = new Array(nFeatures).fill(0);
    this.bias = 0;

    const lr = 0.1;
    const epochs = 500;
    const n = X.length;

    for (let e = 0; e < epochs; e++) {
      let dw = new Array(nFeatures).fill(0);
      let db = 0;
      for (let i = 0; i < n; i++) {
        const z = X[i].reduce((sum, xi, idx) => sum + xi * this.weights![idx], this.bias);
        const p = sigmoid(z);
        const err = p - labels[i];
        db += err;
        dw = dw.map((d, idx) => d + err * X[i][idx]);
      }
      this.bias -= (lr * db) / n;
      this.weights = this.weights.map((w, idx) => w - (lr * dw[idx]) / n);
    }

    let correct = 0;
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((sum, xi, idx) => sum + xi * this.weights![idx], this.bias);
      const pred = sigmoid(z) >= 0.5 ? 1 : 0;
      if (pred === labels[i]) correct += 1;
    }
    this.accuracy = correct / n;
    this.lastTrainCount = n;

    this.logger.log(
      `PatternPredictor entraîné sur ${n} samples — accuracy ${(this.accuracy * 100).toFixed(1)}%`,
    );

    return { trained: true, count: n, accuracy: this.accuracy, patterns: this.patterns };
  }

  predict(input: PatternFeaturesInput): { probability: number; featuresUsed: string[] } {
    if (!this.weights || this.mins.length === 0 || this.patterns.length === 0) {
      return { probability: NaN, featuresUsed: [] };
    }
    const row = this._toFeatures(input, this.patterns);
    const normalized = row.map((v, i) => normalize(v, this.mins[i], this.maxs[i]));
    const z = normalized.reduce((sum, xi, idx) => sum + xi * this.weights![idx], this.bias);
    return { probability: sigmoid(z), featuresUsed: this._featureNames(this.patterns) };
  }

  getStatus() {
    return {
      trained: !!this.weights,
      accuracy: this.accuracy,
      sampleCount: this.lastTrainCount,
      patternCount: this.patterns.length,
    };
  }

  private _featureNames(patterns: string[]): string[] {
    return [
      'patternConfluenceScore',
      'scoreTotal',
      'adx',
      'riskReward',
      'signalType',
      ...patterns.map(p => `pattern_${p}`),
    ];
  }

  private _toFeatures(input: any, patterns: string[]): number[] {
    const patternIdx = patterns.indexOf(input.patternName ?? 'UNKNOWN');
    const oneHot = patterns.map((_, i) => (i === patternIdx ? 1 : 0));
    const signalType = input.signalType === 'BUY' ? 1 : input.signalType === 'SELL' ? -1 : 0;
    return [
      input.patternConfluenceScore ?? 0,
      input.scoreTotal ?? 0,
      input.adx ?? 0,
      input.riskReward ?? 0,
      signalType,
      ...oneHot,
    ];
  }
}
