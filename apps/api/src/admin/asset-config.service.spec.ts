import { Test } from '@nestjs/testing';
import { AssetConfigService } from './asset-config.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AssetConfigService', () => {
  let service: AssetConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      assetConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AssetConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AssetConfigService>(AssetConfigService);
  });

  it('listMarkets returns all six markets with defaults when DB is empty', async () => {
    const result = await service.listMarkets();
    expect(result).toHaveLength(6);
    expect(result.find(m => m.marketType === 'CRYPTO')).toEqual({
      marketType: 'CRYPTO',
      isActive: true,
      warmupEnabled: true,
      scanInterval: null,
      maxStrategies: null,
      timeframes: null,
    });
  });

  it('listMarkets merges stored values with defaults', async () => {
    prisma.assetConfig.findMany = jest.fn().mockResolvedValue([
      { marketType: 'CRYPTO', isActive: false, warmupEnabled: false, scanInterval: 120, maxStrategies: 5, timeframes: ['1h'] },
    ]);
    const result = await service.listMarkets();
    const crypto = result.find(m => m.marketType === 'CRYPTO');
    expect(crypto?.isActive).toBe(false);
    expect(crypto?.warmupEnabled).toBe(false);
    expect(crypto?.scanInterval).toBe(120);
    expect(crypto?.maxStrategies).toBe(5);
    expect(crypto?.timeframes).toEqual(['1h']);
  });

  it('upsertMarket updates an existing market config', async () => {
    prisma.assetConfig.findFirst = jest.fn().mockResolvedValue({ id: 'cfg-1', marketType: 'CRYPTO' });
    await service.upsertMarket('CRYPTO', { isActive: false, warmupEnabled: false });
    expect(prisma.assetConfig.update).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: { isActive: false, warmupEnabled: false },
    });
  });

  it('upsertMarket creates a new market config when none exists', async () => {
    prisma.assetConfig.findFirst = jest.fn().mockResolvedValue(null);
    await service.upsertMarket('CRYPTO', { isActive: false });
    expect(prisma.assetConfig.create).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'market',
      marketType: 'CRYPTO',
      symbol: null,
      isActive: false,
    }));
  });
});
