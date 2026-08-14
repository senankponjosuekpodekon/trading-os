import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssetConfig } from '@prisma/client';

const MARKET_TYPES = ['CRYPTO', 'FOREX', 'SYNTHETIC', 'BRVM', 'US_STOCK', 'COMMODITY'];

@Injectable()
export class AssetConfigService {
  constructor(private prisma: PrismaService) {}

  async listMarkets() {
    const configs = await this.prisma.assetConfig.findMany({
      where: { scope: 'market' },
    });
    const map = new Map(configs.map((c) => [c.marketType, c]));

    return MARKET_TYPES.map((type) => {
      const cfg = map.get(type);
      return {
        marketType: type,
        isActive: cfg?.isActive ?? true,
        warmupEnabled: cfg?.warmupEnabled ?? true,
        scanInterval: cfg?.scanInterval ?? null,
        maxStrategies: cfg?.maxStrategies ?? null,
        timeframes: cfg?.timeframes ?? null,
      };
    });
  }

  async getMarket(marketType: string) {
    const cfg = await this.prisma.assetConfig.findUnique({
      where: { marketType_symbol: { marketType, symbol: null as any } },
    });
    if (!cfg) {
      return {
        marketType,
        isActive: true,
        warmupEnabled: true,
        scanInterval: null,
        maxStrategies: null,
        timeframes: null,
      };
    }
    return cfg;
  }

  async upsertMarket(marketType: string, data: {
    isActive?: boolean;
    warmupEnabled?: boolean;
    scanInterval?: number | null;
    maxStrategies?: number | null;
    timeframes?: any;
  }) {
    return this.prisma.assetConfig.upsert({
      where: { marketType_symbol: { marketType, symbol: null as any } },
      create: {
        scope: 'market',
        marketType,
        symbol: null,
        isActive: data.isActive ?? true,
        warmupEnabled: data.warmupEnabled ?? true,
        scanInterval: data.scanInterval ?? null,
        maxStrategies: data.maxStrategies ?? null,
        timeframes: data.timeframes ?? null,
      },
      update: {
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.warmupEnabled !== undefined && { warmupEnabled: data.warmupEnabled }),
        ...(data.scanInterval !== undefined && { scanInterval: data.scanInterval }),
        ...(data.maxStrategies !== undefined && { maxStrategies: data.maxStrategies }),
        ...(data.timeframes !== undefined && { timeframes: data.timeframes }),
      },
    });
  }

  async listPairs(marketType: string) {
    const configs = await this.prisma.assetConfig.findMany({
      where: { marketType, scope: 'pair' },
    });
    return configs;
  }

  async upsertPair(marketType: string, symbol: string, data: {
    isActive?: boolean;
    warmupEnabled?: boolean;
  }) {
    return this.prisma.assetConfig.upsert({
      where: { marketType_symbol: { marketType, symbol } },
      create: {
        scope: 'pair',
        marketType,
        symbol,
        isActive: data.isActive ?? true,
        warmupEnabled: data.warmupEnabled ?? true,
      },
      update: {
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.warmupEnabled !== undefined && { warmupEnabled: data.warmupEnabled }),
      },
    });
  }

  async bulkUpdatePairs(marketType: string, pairs: { symbol: string; isActive?: boolean; warmupEnabled?: boolean }[]) {
    const results = await Promise.all(
      pairs.map((p) =>
        this.upsertPair(marketType, p.symbol, {
          isActive: p.isActive,
          warmupEnabled: p.warmupEnabled,
        }),
      ),
    );
    return { updated: results.length };
  }

  async deletePair(marketType: string, symbol: string) {
    await this.prisma.assetConfig.delete({
      where: { marketType_symbol: { marketType, symbol } },
    });
    return { deleted: true };
  }

  /** Returns the effective config for a symbol, merging market + pair overrides */
  async getEffectiveConfig(marketType: string, symbol?: string) {
    const marketCfg = await this.getMarket(marketType);
    if (!symbol) return marketCfg;

    const pairCfg = await this.prisma.assetConfig.findUnique({
      where: { marketType_symbol: { marketType, symbol } },
    });

    if (!pairCfg) return marketCfg;

    return {
      marketType,
      symbol,
      isActive: pairCfg.isActive && marketCfg.isActive,
      warmupEnabled: pairCfg.warmupEnabled && marketCfg.warmupEnabled,
      scanInterval: pairCfg.scanInterval ?? marketCfg.scanInterval,
      maxStrategies: pairCfg.maxStrategies ?? marketCfg.maxStrategies,
      timeframes: pairCfg.timeframes ?? marketCfg.timeframes,
    };
  }
}
