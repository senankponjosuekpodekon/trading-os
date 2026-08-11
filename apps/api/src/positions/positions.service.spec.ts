import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { PositionsService } from './positions.service';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';
import { AuditService } from '../audit/audit.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { CrossPositionRiskService } from './cross-position-risk.service';

describe('PositionsService', () => {
  let service: PositionsService;

  const mockPrisma = {
    portfolio: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
    },
    signal: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (ops: any) => {
      if (typeof ops === 'function') return ops(mockPrisma);
      const results: any[] = [];
      for (const op of Array.isArray(ops) ? ops : []) results.push(await op);
      return results;
    }),
    $executeRaw: jest.fn(),
    position: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockHttp = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string, def: string) => def),
  };

  const mockNotifications = {
    push: jest.fn(),
    pushGlobal: jest.fn(),
  };

  const mockJournal = {
    createAuto: jest.fn(),
  };

  const mockAudit = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PrismaSystemService, useValue: mockPrisma },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: JournalService, useValue: mockJournal },
        { provide: AuditService, useValue: mockAudit },
        { provide: SystemHealthService, useValue: { recordCronRun: jest.fn(), getCronStatus: jest.fn() } },
        { provide: CrossPositionRiskService, useValue: { checkCorrelationRisk: jest.fn().mockResolvedValue({ allowed: true }) } },
      ],
    }).compile();

    service = module.get<PositionsService>(PositionsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
    });

    it('should create a position and decrement capital', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.position.create.mockResolvedValue({ id: 'pos1' });

      const result = await service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 10,
      } as any);

      expect(result.id).toBe('pos1');
      expect(mockPrisma.position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trailingMethod: 'atr',
            trailingActive: true,
          }),
        }),
      );
      expect(mockPrisma.portfolio.update).toHaveBeenCalled();
    });

    it('should store custom trailing method', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.position.create.mockResolvedValue({ id: 'pos1' });

      await service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 10,
        trailingMethod: 'chandelier',
        trailingActive: false,
      } as any);

      expect(mockPrisma.position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            trailingMethod: 'chandelier',
            trailingActive: false,
          }),
        }),
      );
    });

    it('should throw BadRequestException if insufficient capital', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 50 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(
        service.create('u1', {
          portfolioId: 'p1',
          assetSymbol: 'BTC/USDT',
          direction: 'BUY',
          entryPrice: 100,
          quantity: 10,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByPortfolio', () => {
    it('should return paginated positions', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.position.findMany.mockResolvedValue([{ id: 'pos1' }]);
      mockPrisma.position.count.mockResolvedValue(1);

      const result = await service.findByPortfolio('u1', 'p1', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should throw NotFoundException for unknown portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);

      await expect(
        service.findByPortfolio('u1', 'p1', { page: 1, limit: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('partial lifecycle (Sprint 5)', () => {
    it('close() should throw NotFoundException for unknown or already closed position', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await expect(service.close('u1', 'pos-missing', 100)).rejects.toThrow(NotFoundException);
    });

    it('close() should allow PARTIAL status and include realized partialPnl in final pnl', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos1',
        portfolioId: 'p1',
        status: 'PARTIAL',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 5,
        originalQuantity: 10,
        partialPnl: 50,
        portfolio: { id: 'p1', currentCapital: 10000 },
      });
      mockPrisma.position.update.mockResolvedValue({ id: 'pos1' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 'p1' });

      const result = await service.close('u1', 'pos1', 110);

      // pnl total = partialPnl (50) + pnl restant (5 * 10 = 50) = 100
      expect(result.pnl).toBe('100.00');
      expect(result.pnlPercent).toBe('10.00');
    });

    it('closeByWatcher() should aggregate partialPnl when closing remaining quantity', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos2',
        portfolioId: 'p1',
        status: 'PARTIAL',
        direction: 'SELL',
        entryPrice: 100,
        quantity: 5,
        originalQuantity: 10,
        partialPnl: 25,
        asset: { symbol: 'BTC/USDT' },
        portfolio: { userId: 'u1', id: 'p1', currentCapital: 10000, user: {} },
      });
      mockPrisma.position.update.mockResolvedValue({ id: 'pos2' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 'p1' });

      const result = await service.closeByWatcher('pos2', 90, 'TP');

      // SELL remaining qty: (100-90)*5 = 50 ; total = 50 + 25 = 75
      expect(result?.pnl).toBe('75.00');
      expect(result?.pnlPercent).toBe('7.50');
    });

    it('syncTrailingStops() should transition OPEN to PARTIAL when TP1 hit and TP2 exists', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'pos3',
          status: 'OPEN',
          direction: 'BUY',
          entryPrice: 100,
          quantity: 10,
          stopLoss: 95,
          takeProfit: 105,
          takeProfit2: 120,
          trailingStop: 95,
          portfolioId: 'p1',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          signal: { indicators: { atr: 2 } },
        },
      ]);
      mockHttp.get.mockReturnValue(of({ data: { price: '106' } }));
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos3',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 10,
        takeProfit2: 120,
        trailingStop: 95,
        asset: { symbol: 'BTC/USDT' },
        portfolioId: 'p1',
        portfolio: { userId: 'u1', id: 'p1', user: {} },
      });
      mockPrisma.position.update.mockResolvedValue({ id: 'pos3', status: 'PARTIAL' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 'p1' });

      await service.syncTrailingStops();

      expect(mockPrisma.position.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pos3' },
          data: expect.objectContaining({ status: 'PARTIAL' }),
        }),
      );
    });

    it('setTrailingStop() should update method and active state', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos4' });
      mockPrisma.position.update.mockResolvedValue({ id: 'pos4', trailingMethod: 'ema', trailingActive: false });

      const result = await service.setTrailingStop('u1', 'pos4', { method: 'ema', active: false });

      expect(mockPrisma.position.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pos4' },
          data: { trailingMethod: 'ema', trailingActive: false },
        }),
      );
      expect(result.trailingMethod).toBe('ema');
      expect(result.trailingActive).toBe(false);
    });

    it('syncTrailingStops() should call engine trailing-stop/compute when klines available', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'pos5',
          status: 'OPEN',
          direction: 'BUY',
          entryPrice: 100,
          quantity: 10,
          stopLoss: 95,
          takeProfit: 105,
          takeProfit2: 120,
          trailingStop: 95,
          trailingMethod: 'atr',
          trailingActive: true,
          portfolioId: 'p1',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          signal: { timeframe: '1h', indicators: { atr: 2 } },
        },
      ]);
      mockHttp.get
        .mockReturnValueOnce(of({ data: { price: '104' } })) // live price below TP1
        .mockReturnValueOnce(of({ data: { klines: [{ time: 't', open: 100, high: 112, low: 103, close: 104, volume: 1 }] } }));
      mockHttp.post.mockReturnValue(of({ data: { recommended_stop: 103, activated: true, reason: 'stop remonté' } }));
      mockPrisma.position.update.mockResolvedValue({ id: 'pos5', trailingStop: 105 });

      await service.syncTrailingStops();

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining('/trailing-stop/compute'),
        expect.objectContaining({ symbol: 'BTC/USDT', method: 'atr' }),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
      expect(mockPrisma.position.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pos5' },
          data: expect.objectContaining({ trailingStop: 103 }),
        }),
      );
    });

    it('closeByWatcher() should close position with TRAILING reason', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos3',
        portfolioId: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        asset: { symbol: 'BTC/USDT' },
        portfolio: { userId: 'u1', id: 'p1', currentCapital: 10000, user: {} },
      });
      mockPrisma.position.update.mockResolvedValue({ id: 'pos3' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 'p1' });

      const result = await service.closeByWatcher('pos3', 96, 'TRAILING');

      expect(result?.reason).toBe('TRAILING');
      expect(mockNotifications.push).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('TRAILING'),
        }),
      );
    });

    it('create() should reject position with RR < 1.0', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000, initialCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 1,
        stopLoss: 95,
        takeProfit: 96,
      } as any)).rejects.toThrow(BadRequestException);
    });

    it('create() should reject duplicate open position on same asset', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000, initialCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'pos-existing' });

      await expect(service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 1,
        stopLoss: 95,
        takeProfit: 110,
      } as any)).rejects.toThrow(ConflictException);
    });

    it('create() should block when portfolio drawdown exceeds 10%', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 8900, initialCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 1,
        stopLoss: 95,
        takeProfit: 110,
      } as any)).rejects.toThrow(BadRequestException);
    });

    it('syncTrailingStops() should close position with TRAILING reason when price hits trailing stop', async () => {
      mockPrisma.position.findMany.mockResolvedValue([
        {
          id: 'pos6',
          status: 'OPEN',
          direction: 'BUY',
          entryPrice: 100,
          quantity: 1,
          stopLoss: 95,
          takeProfit: 105,
          takeProfit2: 120,
          trailingStop: 95,
          trailingMethod: 'atr',
          trailingActive: true,
          portfolioId: 'p1',
          asset: { symbol: 'BTC/USDT' },
          portfolio: { userId: 'u1' },
          signal: { timeframe: '1h', indicators: { atr: 2 } },
        },
      ]);
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos6',
        portfolioId: 'p1',
        entryPrice: 100,
        quantity: 1,
        direction: 'BUY',
        asset: { symbol: 'BTC/USDT' },
        portfolio: { userId: 'u1', id: 'p1', user: {} },
      });
      mockHttp.get.mockReturnValue(of({ data: { price: '94' } }));
      mockHttp.post.mockReturnValue(of({ data: { recommended_stop: null, activated: true, reason: 'no update' } }));
      mockPrisma.position.update.mockResolvedValue({ id: 'pos6' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 'p1' });

      await service.syncTrailingStops();

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockNotifications.push).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('TRAILING'),
        }),
      );
    });
  });

  describe('openFromSignal', () => {
    it('should reject opening from a NEUTRAL signal', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 'sig1',
        signal: 'NEUTRAL',
        asset: { id: 'a1' },
      });

      await expect(service.openFromSignal('u1', 'sig1')).rejects.toThrow(BadRequestException);
    });

    it('should reject opening when signal has no entry price', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 'sig2',
        signal: 'BUY',
        assetId: 'a1',
        asset: { id: 'a1' },
        entryPrice: null,
        stopLoss: '95',
        takeProfit1: '110',
        takeProfit2: '120',
      });
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000, initialCapital: 10000 });
      mockPrisma.position.findFirst.mockResolvedValue(null);

      await expect(service.openFromSignal('u1', 'sig2')).rejects.toThrow(BadRequestException);
    });
  });

  describe('continuationAdvice', () => {
    it('should call engine continuation endpoint for an open position', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        takeProfit: '105',
        takeProfit2: '110',
        asset: { symbol: 'BTC/USDT' },
        signal: { indicators: { adx: 35 } },
      });
      mockHttp.get.mockReturnValue(of({ data: { price: '106' } }));
      mockHttp.post.mockReturnValue(of({ data: { score: 75, action: 'ACTIVATE_TRAILING', reason: 'Momentum' } }));

      const result = await service.continuationAdvice('u1', 'pos1');

      expect(result.action).toBe('ACTIVATE_TRAILING');
      expect(mockHttp.post).toHaveBeenCalledWith(
        'http://localhost:8000/probability/continuation',
        expect.objectContaining({ direction: 'BUY', price: 106, adx: 35 }),
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('should reject advice for a closed position', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'pos1',
        status: 'CLOSED',
        asset: { symbol: 'BTC/USDT' },
        signal: null,
      });

      await expect(service.continuationAdvice('u1', 'pos1')).rejects.toThrow(BadRequestException);
    });
  });
});
