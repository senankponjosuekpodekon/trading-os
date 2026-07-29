import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { of } from 'rxjs';
import { WatcherModule } from '../watcher/watcher.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WatcherService } from '../watcher/watcher.service';
import { PositionsService } from './positions.service';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';

describe('openPosition → watcher → closePosition flow', () => {
  let positionsService: PositionsService;
  let watcherService: WatcherService;

  const notifications = { push: jest.fn() };
  const journal = { createAuto: jest.fn().mockResolvedValue(undefined) };
  const httpService = { get: jest.fn() };

  const portfolio = {
    id: 'portfolio-1',
    userId: 'user-1',
    currentCapital: 10000,
    initialCapital: 10000,
  };
  const asset = { id: 'asset-1', symbol: 'BTC/USDT' };

  const prismaMock: any = {
    portfolio: {
      findFirst: jest.fn().mockResolvedValue(portfolio),
      update: jest.fn().mockResolvedValue({}),
    },
    asset: {
      findUnique: jest.fn().mockResolvedValue(asset),
    },
    position: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, WatcherModule],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(PrismaSystemService)
      .useValue(prismaMock)
      .overrideProvider(NotificationsService)
      .useValue(notifications as any)
      .overrideProvider(JournalService)
      .useValue(journal as any)
      .compile();

    positionsService = moduleRef.get<PositionsService>(PositionsService);
    watcherService = moduleRef.get<WatcherService>(WatcherService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.position.findMany.mockResolvedValue([]);
  });

  it('opens a BUY position and closes it via the watcher when TP is hit', async () => {
    const createdPosition = {
      id: 'pos-1',
      portfolioId: portfolio.id,
      assetId: asset.id,
      asset: { symbol: asset.symbol },
      portfolio: { userId: portfolio.userId },
      direction: 'BUY',
      entryPrice: '100',
      quantity: '1',
      originalQuantity: '1',
      stopLoss: '95',
      takeProfit: '110',
      status: 'OPEN',
    };

    // Stage 1: open position
    prismaMock.position.findFirst.mockResolvedValue(null);
    prismaMock.position.create.mockResolvedValue(createdPosition);

    const position = await positionsService.create(portfolio.userId, {
      portfolioId: portfolio.id,
      assetSymbol: asset.symbol,
      direction: 'BUY',
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
    } as any);

    expect(position.status).toBe('OPEN');
    expect(prismaMock.position.create).toHaveBeenCalled();

    // Stage 2: watcher sees TP hit
    prismaMock.position.findFirst.mockResolvedValue(createdPosition);
    prismaMock.position.findMany.mockResolvedValue([createdPosition]);
    httpService.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '115' }] }));

    await watcherService.watchPositions();

    expect(prismaMock.position.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pos-1' },
        data: expect.objectContaining({ status: 'CLOSED', exitPrice: 115 }),
      }),
    );
    expect(notifications.push).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'POSITION',
        title: expect.stringContaining('TP'),
      }),
    );
  });
});
