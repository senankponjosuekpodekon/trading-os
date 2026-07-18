import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { WatcherService } from './watcher.service';
import { PrismaService } from '../prisma/prisma.service';
import { PositionsService } from '../positions/positions.service';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';

describe('WatcherService', () => {
  let service: WatcherService;

  const mockPrisma = {
    position: {
      findMany: jest.fn(),
    },
    signal: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
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

  const mockPriceAlerts = {
    checkAlerts: jest.fn().mockResolvedValue(undefined),
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
        { provide: PriceAlertsService, useValue: mockPriceAlerts },
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

  describe('watchPendingSignals', () => {
    it('invalidates PENDING signals past expiresAt', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.signal.findMany.mockResolvedValue([]);

      await service.watchPendingSignals();

      expect(mockPrisma.signal.updateMany).toHaveBeenCalledWith({
        where: { status: 'PENDING', expiresAt: { lt: expect.any(Date) } },
        data: { status: 'INVALIDATED' },
      });
    });

    it('activates a PENDING BUY signal once price reaches entryPrice', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([
        { id: 's1', signal: 'BUY', entryPrice: 100, asset: { symbol: 'BTC/USDT' } },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '99' }] }));

      await service.watchPendingSignals();

      expect(mockPrisma.signal.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('activates a PENDING SELL signal once price reaches entryPrice', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([
        { id: 's2', signal: 'SELL', entryPrice: 100, asset: { symbol: 'BTC/USDT' } },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '101' }] }));

      await service.watchPendingSignals();

      expect(mockPrisma.signal.update).toHaveBeenCalledWith({
        where: { id: 's2' },
        data: { status: 'ACTIVE' },
      });
    });

    it('does not activate when price has not reached entryPrice yet', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([
        { id: 's3', signal: 'BUY', entryPrice: 100, asset: { symbol: 'BTC/USDT' } },
      ]);
      mockHttp.get.mockReturnValue(of({ data: [{ symbol: 'BTCUSDT', price: '105' }] }));

      await service.watchPendingSignals();

      expect(mockPrisma.signal.update).not.toHaveBeenCalled();
    });

    it('does nothing when there are no pending signals', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([]);

      await service.watchPendingSignals();

      expect(mockHttp.get).not.toHaveBeenCalled();
      expect(mockPrisma.signal.update).not.toHaveBeenCalled();
    });

    it('skips signals on symbols outside the watcher symbol map', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([
        { id: 's4', signal: 'BUY', entryPrice: 100, asset: { symbol: 'EUR/USD' } },
      ]);

      await service.watchPendingSignals();

      expect(mockHttp.get).not.toHaveBeenCalled();
      expect(mockPrisma.signal.update).not.toHaveBeenCalled();
    });

    it('does not crash and skips activation if price fetch fails', async () => {
      mockPrisma.signal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.signal.findMany.mockResolvedValue([
        { id: 's5', signal: 'BUY', entryPrice: 100, asset: { symbol: 'BTC/USDT' } },
      ]);
      mockHttp.get.mockImplementation(() => {
        throw new Error('network error');
      });

      await expect(service.watchPendingSignals()).resolves.not.toThrow();
      expect(mockPrisma.signal.update).not.toHaveBeenCalled();
    });
  });
});
