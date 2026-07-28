import { Test, TestingModule } from '@nestjs/testing';
import { FeatureStoreService } from './feature-store.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FeatureStoreService', () => {
  let service: FeatureStoreService;

  const upsert = jest.fn();
  const update = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const mockPrisma = {
    signalFeature: {
      upsert,
      update,
      findUnique,
      findMany,
    },
  } as unknown as PrismaService;

  beforeEach(async () => {
    upsert.mockReset();
    update.mockReset();
    findUnique.mockReset();
    findMany.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureStoreService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(FeatureStoreService);
  });

  it('upserts snapshots', async () => {
    upsert.mockResolvedValue({ id: 'snap' });

    await service.upsertSnapshot({ signalId: 'sig', features: { level1: {} } });

    expect(upsert).toHaveBeenCalledWith({
      where: { signalId: 'sig' },
      create: expect.objectContaining({
        signalId: 'sig',
        features: { level1: {} },
        concept: null,
        embedding: null,
        snapshotVersion: 'v2',
      }),
      update: expect.objectContaining({
        features: { level1: {} },
        concept: null,
        embedding: null,
        snapshotVersion: 'v2',
      }),
    });
  });

  it('attaches outcome', async () => {
    update.mockResolvedValue({ signalId: 'sig' });

    await service.attachOutcome('sig', 'WIN_TP1', 4.2);

    expect(update).toHaveBeenCalledWith({
      where: { signalId: 'sig' },
      data: { outcome: 'WIN_TP1', pnl: 4.2 },
    });
  });

  it('fetches snapshot by signal', async () => {
    findUnique.mockResolvedValue({ signalId: 'sig' });

    const res = await service.getBySignal('sig');

    expect(res).toEqual({ signalId: 'sig' });
    expect(findUnique).toHaveBeenCalledWith({ where: { signalId: 'sig' } });
  });

  it('lists snapshots with filters', async () => {
    findMany.mockResolvedValue([{ signalId: 'sig' }]);

    await service.listSnapshots({ market: 'CRYPTO', outcome: 'WIN_TP1', timeframe: '1h', limit: 10 });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        outcome: 'WIN_TP1',
        signal: {
          asset: { market: { name: 'CRYPTO' } },
          timeframe: '1h',
        },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: expect.any(Object),
    });
  });
});
