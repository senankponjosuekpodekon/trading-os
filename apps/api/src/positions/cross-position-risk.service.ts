import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const ASSET_CLUSTERS: Record<string, string> = {
  'BTC/USDT': 'CRYPTO_MAJOR',
  'ETH/USDT': 'CRYPTO_MAJOR',
  'SOL/USDT': 'CRYPTO_MAJOR',
  'BNB/USDT': 'CRYPTO_MAJOR',
  'AVAX/USDT': 'CRYPTO_MAJOR',
  'ADA/USDT': 'CRYPTO_MAJOR',
  'XRP/USDT': 'CRYPTO_MAJOR',
  'LINK/USDT': 'CRYPTO_MAJOR',
  'DOT/USDT': 'CRYPTO_MAJOR',
  'MATIC/USDT': 'CRYPTO_MAJOR',
  'ATOM/USDT': 'CRYPTO_MAJOR',
  'LTC/USDT': 'CRYPTO_MAJOR',
  'EUR/USD': 'FOREX',
  'EUR/USDT': 'FOREX',
  'GBP/USD': 'FOREX',
  'GBP/USDT': 'FOREX',
  'USD/JPY': 'FOREX',
  'AUD/USD': 'FOREX',
  'NZD/USD': 'FOREX',
  'XAU/USD': 'METALS',
  'XAG/USD': 'METALS',
  'PAXG/USDT': 'METALS',
  'WTI/USD': 'COMMODITIES',
  'BRENT/USD': 'COMMODITIES',
  'AAPL/USD': 'US_STOCKS',
  'TSLA/USD': 'US_STOCKS',
  'MSFT/USD': 'US_STOCKS',
  'NVDA/USD': 'US_STOCKS',
  'AMZN/USD': 'US_STOCKS',
  'META/USD': 'US_STOCKS',
  'GOOGL/USD': 'US_STOCKS',
  'NFLX/USD': 'US_STOCKS',
  'AMD/USD': 'US_STOCKS',
  'INTC/USD': 'US_STOCKS',
  'JPM/USD': 'US_STOCKS',
  'BAC/USD': 'US_STOCKS',
  'SP500/USD': 'US_INDICES',
  'NASDAQ/USD': 'US_INDICES',
  'DOW/USD': 'US_INDICES',
  'VIX/USD': 'US_INDICES',
};

const MAX_SAME_CLUSTER_SAME_DIRECTION = 3;
const MAX_SAME_CLUSTER_TOTAL = 5;

function getCluster(symbol: string): string {
  if (ASSET_CLUSTERS[symbol]) return ASSET_CLUSTERS[symbol];
  if (symbol.endsWith('/USDT') || symbol.endsWith('/USD')) {
    if (symbol.startsWith('V') && /^\d/.test(symbol.slice(1))) return 'SYNTHETIC';
    return 'CRYPTO_MAJOR';
  }
  if (symbol.includes('BOOM') || symbol.includes('CRASH') || symbol.includes('JUMP')) return 'SYNTHETIC';
  return 'UNKNOWN';
}

@Injectable()
export class CrossPositionRiskService {
  constructor(private prisma: PrismaService) {}

  async checkCorrelationRisk(
    portfolioId: string,
    newSymbol: string,
    newDirection: 'BUY' | 'SELL',
  ): Promise<void> {
    const openPositions = await this.prisma.position.findMany({
      where: {
        portfolioId,
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
      },
      include: { asset: { select: { symbol: true } } },
    });

    if (openPositions.length === 0) return;

    const newCluster = getCluster(newSymbol);

    // Count positions in the same cluster
    const sameCluster = openPositions.filter(
      p => getCluster(p.asset.symbol) === newCluster,
    );

    const sameDirection = sameCluster.filter(p => p.direction === newDirection);
    const oppositeDirection = sameCluster.filter(p => p.direction !== newDirection);

    // Rule 1: Too many positions in the same cluster + same direction
    if (sameDirection.length >= MAX_SAME_CLUSTER_SAME_DIRECTION) {
      throw new BadRequestException(
        `CORRELATION_RISK: ${sameDirection.length} positions ${newDirection} already open in cluster ${newCluster} ` +
        `(${sameDirection.map(p => p.asset.symbol).join(', ')}). ` +
        `Maximum ${MAX_SAME_CLUSTER_SAME_DIRECTION} correlated positions allowed in the same direction.`,
      );
    }

    // Rule 2: Too many positions total in the same cluster
    if (sameCluster.length >= MAX_SAME_CLUSTER_TOTAL) {
      throw new BadRequestException(
        `CORRELATION_RISK: ${sameCluster.length} positions already open in cluster ${newCluster}. ` +
        `Maximum ${MAX_SAME_CLUSTER_TOTAL} positions per correlation cluster.`,
      );
    }

    // Rule 3: Contradiction warning — opening BUY when there are SELL positions in same cluster
    if (oppositeDirection.length >= 2) {
      // Don't block, but could log a warning
      // The user might be hedging intentionally
    }
  }

  async getCorrelationReport(portfolioId: string) {
    const openPositions = await this.prisma.position.findMany({
      where: {
        portfolioId,
        status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] },
      },
      include: { asset: { select: { symbol: true, name: true } } },
    });

    const clusters: Record<string, {
      label: string;
      buy: string[];
      sell: string[];
      total: number;
      riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    }> = {};

    for (const p of openPositions) {
      const cluster = getCluster(p.asset.symbol);
      if (!clusters[cluster]) {
        clusters[cluster] = {
          label: cluster,
          buy: [],
          sell: [],
          total: 0,
          riskLevel: 'LOW',
        };
      }
      if (p.direction === 'BUY') clusters[cluster].buy.push(p.asset.symbol);
      else clusters[cluster].sell.push(p.asset.symbol);
      clusters[cluster].total++;
    }

    // Determine risk level per cluster
    for (const c of Object.values(clusters)) {
      const maxDir = Math.max(c.buy.length, c.sell.length);
      if (maxDir >= MAX_SAME_CLUSTER_SAME_DIRECTION || c.total >= MAX_SAME_CLUSTER_TOTAL) {
        c.riskLevel = 'HIGH';
      } else if (c.total >= 2) {
        c.riskLevel = 'MEDIUM';
      }
    }

    const hasHigh = Object.values(clusters).some(c => c.riskLevel === 'HIGH');
    const hasMedium = Object.values(clusters).some(c => c.riskLevel === 'MEDIUM');

    return {
      clusters,
      totalPositions: openPositions.length,
      overallRisk: hasHigh ? 'HIGH' : hasMedium ? 'MEDIUM' : 'LOW',
    };
  }
}
