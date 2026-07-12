import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { WatcherService } from './watcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { PositionsService } from '../positions/positions.service';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('WatcherService', () => {
  let service: WatcherService;

  const mockPrisma = {
    position: {
      findMany: jest.fn(),
    },
  };

  const mockPositions = {
    closeByWatcher: jest.fn(),
  };

  const mockJournal = {
    createAuto: jest.fn(),
  };

  const mockHttp = {
    get: jest.fn(),
  };

  const mockNotifications = {
    push: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatcherService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PositionsService, useValue: mockPositions },
        { provide: JournalService, useValue: mockJournal },
        { provide: HttpService, useValue: mockHttp },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<WatcherService>(WatcherService);
    jest.clearAllMocks();
  });

  describe('watchPositions', () => {
    it('should close BUY position when TP is hit', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'p1',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 90,
          takeProfit: 120,
          quantity: 1,
        },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '125' }] }));
      mockPositions.closeByWatcher.mockResolvedValue({ pnl: 25, pnlPercent: 25 });

      await service.watchPositions();

      expect(mockPositions.closeByWatcher).toHaveBeenCalledWith('p1', 125, 'TP');
      expect(mockNotifications.push).toHaveBeenCalled();
    });

    it('should close SELL position when SL is hit', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'p2',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          direction: 'SELL',
          entryPrice: 100,
          stopLoss: 110,
          takeProfit: 90,
          quantity: 1,
        },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '115' }] }));
      mockPositions.closeByWatcher.mockResolvedValue({ pnl: -15, pnlPercent: -15 });

      await service.watchPositions();

      expect(mockPositions.closeByWatcher).toHaveBeenCalledWith('p2', 115, 'SL');
      expect(mockNotifications.push).toHaveBeenCalled();
    });

    it('should do nothing if price does not trigger SL/TP', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'p1',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          direction: 'BUY',
          entryPrice: 100,
          stopLoss: 90,
          takeProfit: 120,
          quantity: 1,
        },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '105' }] }));

      await service.watchPositions();

      expect(mockPositions.closeByWatcher).not.toHaveBeenCalled();
    });
  });
});
