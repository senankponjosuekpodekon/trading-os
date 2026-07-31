import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface FeatureSnapshotInput {
  signalId: string;
  features: unknown;
  concept?: unknown;
  embedding?: unknown;
  symbol?: string | null;
  market?: string | null;
  timeframe?: string | null;
  direction?: 'BUY' | 'SELL' | 'NEUTRAL' | string | null;
  confidence?: number | null;
  mlConfidence?: number | null;
  mlRegime?: string | null;
  expectedMove?: unknown;
  source?: string | null;
}

@Injectable()
export class FeatureStoreService {
  private readonly logger = new Logger(FeatureStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return (this.prisma as any).signalFeature;
  }

  async upsertSnapshot(input: FeatureSnapshotInput) {
    const client = this.client;
    if (!client) {
      this.logger.warn('signalFeature client unavailable');
      return null;
    }

    const {
      signalId,
      features,
      concept,
      embedding,
      symbol,
      market,
      timeframe,
      direction,
      confidence,
      mlConfidence,
      mlRegime,
      expectedMove,
      source,
    } = input;
    return client.upsert({
      where: { signalId },
      create: {
        signalId,
        features,
        concept: concept ?? null,
        embedding: embedding ?? null,
        symbol: symbol ?? null,
        market: market ?? null,
        timeframe: timeframe ?? null,
        direction: direction ?? null,
        confidence: confidence ?? null,
        mlConfidence: mlConfidence ?? null,
        mlRegime: mlRegime ?? null,
        expectedMove: expectedMove ?? null,
        snapshotVersion: 'v2',
        source: source ?? null,
      },
      update: {
        features,
        concept: concept ?? null,
        embedding: embedding ?? null,
        symbol: symbol ?? null,
        market: market ?? null,
        timeframe: timeframe ?? null,
        direction: direction ?? null,
        confidence: confidence ?? null,
        mlConfidence: mlConfidence ?? null,
        mlRegime: mlRegime ?? null,
        expectedMove: expectedMove ?? null,
        snapshotVersion: 'v2',
        source: source ?? null,
      },
    });
  }

  async attachOutcome(signalId: string, outcome?: string | null, pnl?: number | null) {
    const client = this.client;
    if (!client) {
      this.logger.warn('signalFeature client unavailable');
      return null;
    }
    try {
      return await client.update({
        where: { signalId },
        data: { outcome: outcome ?? null, pnl: pnl ?? null },
      });
    } catch (error: any) {
      this.logger.warn(`attachOutcome failed for ${signalId}: ${error?.message}`);
      return null;
    }
  }

  async getBySignal(signalId: string) {
    const client = this.client;
    if (!client) {
      this.logger.warn('signalFeature client unavailable');
      return null;
    }
    return client.findUnique({ where: { signalId } });
  }

  async listSnapshots(opts: { market?: string; outcome?: string; timeframe?: string; limit?: number } = {}) {
    const client = this.client;
    if (!client) {
      this.logger.warn('signalFeature client unavailable');
      return [];
    }
    const { market, outcome, timeframe } = opts;
    const where: any = {};
    if (outcome) where.outcome = outcome;
    if (market || timeframe) {
      where.signal = {};
      if (market) where.signal.asset = { market: { name: { equals: market, mode: 'insensitive' } } };
      if (timeframe) where.signal.timeframe = timeframe;
    }
    const take = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    return client.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        signal: {
          select: {
            id: true,
            signal: true,
            confidence: true,
            timeframe: true,
            createdAt: true,
            asset: {
              select: {
                symbol: true,
                market: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }
}
