import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PositionsService } from './positions.service';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';
import { AuditService } from '../audit/audit.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { CrossPositionRiskService } from './cross-position-risk.service';

describe('PositionsService additional', () => {
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

  const mockSystemPrisma = {
    position: {
      findMany: jest.fn(),
      update: jest.fn(),
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
        { provide: PrismaSystemService, useValue: mockSystemPrisma },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: JournalService, useValue: mockJournal },
        { provide: AuditService, useValue: mockAudit },
        { provide: SystemHealthService, useValue: { recordCronRun: jest.fn(), getCronStatus: jest.fn() } },
        { provide: CrossPositionRiskService, useValue: { checkCorrelationRisk: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<PositionsService>(PositionsService);
    jest.clearAllMocks();
    mockPrisma.portfolio.findFirst.mockReset();
    mockPrisma.position.findFirst.mockReset();
    mockPrisma.position.findMany.mockReset();
    mockPrisma.position.count.mockReset();
    mockPrisma.position.create.mockReset();
    mockPrisma.position.update.mockReset();
    mockPrisma.asset.findUnique.mockReset();
    mockPrisma.signal.findUnique.mockReset();
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
    mockJournal.createAuto.mockReset();
    mockNotifications.push.mockReset();
    mockAudit.log.mockReset();
  });

  describe('create', () => {
    it('should throw NotFound if portfolio missing', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);
      await expect(
        service.create('u1', { portfolioId: 'pf1', assetSymbol: 'BTC/USDT', direction: 'BUY', entryPrice: 100, quantity: 1 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFound if asset missing', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 1000, initialCapital: 1000 });
      mockPrisma.asset.findUnique.mockResolvedValue(null);
      await expect(
        service.create('u1', { portfolioId: 'pf1', assetSymbol: 'UNKNOWN', direction: 'BUY', entryPrice: 100, quantity: 1 } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest on insufficient capital', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 50, initialCapital: 1000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', symbol: 'BTC/USDT' });
      await expect(
        service.create('u1', { portfolioId: 'pf1', assetSymbol: 'BTC/USDT', direction: 'BUY', entryPrice: 100, quantity: 1 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw Conflict on duplicate open position', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 1000, initialCapital: 1000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', symbol: 'BTC/USDT' });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1' });
      await expect(
        service.create('u1', { portfolioId: 'pf1', assetSymbol: 'BTC/USDT', direction: 'BUY', entryPrice: 100, quantity: 1 } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequest if RR too low', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 1000, initialCapital: 1000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', symbol: 'BTC/USDT' });
      mockPrisma.position.findFirst.mockResolvedValue(null);
      mockPrisma.position.create.mockResolvedValue({ id: 'p1' });
      mockPrisma.portfolio.update.mockResolvedValue({});
      await expect(
        service.create('u1', { portfolioId: 'pf1', assetSymbol: 'BTC/USDT', direction: 'BUY', entryPrice: 100, quantity: 1, stopLoss: 99.5, takeProfit: 100.2 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('close', () => {
    it('closes a BUY position and returns pnl', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        originalQuantity: '1',
        portfolioId: 'pf1',
        portfolio: { currentCapital: 100 },
        asset: { symbol: 'BTC/USDT' },
      });
      mockPrisma.position.update.mockResolvedValue({});
      mockPrisma.portfolio.update.mockResolvedValue({});
      mockJournal.createAuto.mockResolvedValue(undefined);

      const result = await service.close('u1', 'p1', 110);

      expect(result.positionId).toBe('p1');
      expect(parseFloat(result.pnl)).toBe(10);
      expect(mockPrisma.position.update).toHaveBeenCalled();
    });

    it('closes a SELL position', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'SELL',
        entryPrice: '100',
        quantity: '1',
        originalQuantity: '1',
        portfolioId: 'pf1',
        portfolio: { currentCapital: 100 },
        asset: { symbol: 'BTC/USDT' },
      });
      mockPrisma.position.update.mockResolvedValue({});
      mockPrisma.portfolio.update.mockResolvedValue({});
      mockJournal.createAuto.mockResolvedValue(undefined);

      const result = await service.close('u1', 'p1', 90);

      expect(parseFloat(result.pnl)).toBe(10);
    });

    it('throws NotFound if position not open', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
      await expect(service.close('u1', 'p1', 100)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSummary', () => {
    it('returns summary for resolved portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([
        { id: 'p1', pnl: 10, status: 'OPEN' },
        { id: 'p2', pnl: -5, status: 'CLOSED' },
      ]);
      mockPrisma.position.count.mockResolvedValue(2);
      const result = await service.getSummary('u1');
      expect(result.open).toBe(1);
      expect(result.closed).toBe(1);
      expect(result.totalPnl).toBe(-5);
    });

    it('returns empty if no portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);
      const result = await service.getSummary('u1', 'ALL');
      expect(result.open).toBe(0);
    });

    it('calculates win rate correctly', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([
        { pnl: 5, status: 'CLOSED' },
        { pnl: 10, status: 'CLOSED' },
        { pnl: -2, status: 'CLOSED' },
      ]);
      mockPrisma.position.count.mockResolvedValue(3);
      const result = await service.getSummary('u1', 'pf1');
      expect(result.winRate).toBeCloseTo(66.67);
    });
  });

  describe('getLivePositions', () => {
    it('returns live positions with binance price', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', entryPrice: '100', quantity: '1', asset: { symbol: 'BTC/USDT' }, takeProfit: '110' },
      ]);
      mockHttp.get.mockReturnValue(of({ data: { price: '105' } }));

      const result = await service.getLivePositions('u1', 'pf1');

      expect(result[0].livePrice).toBe(105);
      expect(result[0].unrealizedPnl).toBe(5);
    });

    it('falls back to engine candles when binance fails', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', entryPrice: '100', quantity: '1', asset: { symbol: 'UNKNOWN/USD' }, takeProfit: '110' },
      ]);
      mockHttp.get.mockReturnValueOnce(of({ data: { candles: [{ close: 104 }] } }));

      const result = await service.getLivePositions('u1', 'pf1');

      expect(result[0].livePrice).toBe(104);
    });

    it('returns null unrealized when no live price', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([
        { id: 'p1', direction: 'BUY', entryPrice: '100', quantity: '1', asset: { symbol: 'NOPE/USD' }, takeProfit: '110' },
      ]);
      mockHttp.get.mockReturnValue(of({ data: { candles: [] } }));

      const result = await service.getLivePositions('u1', 'pf1');

      expect(result[0].livePrice).toBeNull();
      expect(result[0].unrealizedPnl).toBeNull();
    });
  });

  describe('openFromSignal', () => {
    it('opens PAPER position from signal with live price', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
        assetId: 'a1',
        entryPrice: '100',
        stopLoss: '95',
        takeProfit1: '110',
        takeProfit2: '120',
      });
      mockPrisma.position.findFirst.mockResolvedValue(null);
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 1000 });
      mockPrisma.position.create.mockResolvedValue({ id: 'p1', asset: { symbol: 'BTC/USDT' } });
      mockPrisma.portfolio.update.mockResolvedValue({});

      const result = await service.openFromSignal('u1', 's1', 'PAPER', 100.5);
      expect(result.id).toBe('p1');
    });

    it('throws NotFound when signal absent', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue(null);
      await expect(service.openFromSignal('u1', 's1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest for NEUTRAL signal', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({ id: 's1', signal: 'NEUTRAL', asset: {} });
      await expect(service.openFromSignal('u1', 's1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when no LIVE portfolio', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
        assetId: 'a1',
        entryPrice: '100',
      });
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);
      await expect(service.openFromSignal('u1', 's1', 'LIVE')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest if no entry and no live price', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
        assetId: 'a1',
        entryPrice: null,
      });
      mockPrisma.position.findFirst.mockResolvedValue(null);
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1', currentCapital: 1000 });
      await expect(service.openFromSignal('u1', 's1', 'PAPER')).rejects.toThrow(BadRequestException);
    });

    it('throws Conflict on duplicate', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
        assetId: 'a1',
        entryPrice: '100',
      });
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      await expect(service.openFromSignal('u1', 's1', 'PAPER')).rejects.toThrow(ConflictException);
    });
  });

  describe('pyramid', () => {
    it('creates a child position', async () => {
      mockPrisma.position.findFirst
        .mockResolvedValueOnce({
          id: 'p1', status: 'PARTIAL', entryPrice: '100', quantity: '1', originalQuantity: '1',
          asset: { symbol: 'BTC/USDT' }, portfolio: { currentCapital: 1000 }, portfolioId: 'pf1', assetId: 'a1',
          trailingMethod: 'atr',
          takeProfit2: '110',
          takeProfit3: '120',
        })
        .mockResolvedValueOnce(null);
      mockHttp.get.mockReturnValue(of({ data: { price: '101' } }));
      mockPrisma.position.create.mockResolvedValue({ id: 'p2' });
      mockPrisma.portfolio.update.mockResolvedValue({});

      const result = await service.pyramid('u1', 'p1');
      expect(result.childPositionId).toBe('p2');
    });

    it('throws NotFound if parent missing', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
      await expect(service.pyramid('u1', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest if parent not partial', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1', status: 'OPEN' });
      await expect(service.pyramid('u1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('throws Conflict if pyramid already exists', async () => {
      mockPrisma.position.findFirst
        .mockResolvedValueOnce({
          id: 'p1', status: 'PARTIAL', entryPrice: '100', quantity: '1', originalQuantity: '1',
          asset: { symbol: 'BTC/USDT' }, portfolio: { currentCapital: 1000 }, portfolioId: 'pf1', assetId: 'a1',
          takeProfit2: '110',
        })
        .mockResolvedValueOnce({ id: 'p2' });
      await expect(service.pyramid('u1', 'p1')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequest if cannot fetch price', async () => {
      mockPrisma.position.findFirst
        .mockResolvedValueOnce({
          id: 'p1', status: 'PARTIAL', entryPrice: '100', quantity: '1', originalQuantity: '1',
          asset: { symbol: 'BTC/USDT' }, portfolio: { currentCapital: 1000 }, portfolioId: 'pf1', assetId: 'a1',
          takeProfit2: '110',
        })
        .mockResolvedValueOnce(null);
      mockHttp.get.mockReturnValue(of({ data: { candles: [] } }));
      await expect(service.pyramid('u1', 'p1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest if pyramid cost exceeds 15% capital', async () => {
      mockPrisma.position.findFirst
        .mockResolvedValueOnce({
          id: 'p1', status: 'PARTIAL', entryPrice: '1000', quantity: '100', originalQuantity: '100',
          asset: { symbol: 'BTC/USDT' }, portfolio: { currentCapital: 1000 }, portfolioId: 'pf1', assetId: 'a1',
          takeProfit2: '1200',
        })
        .mockResolvedValueOnce(null);
      mockHttp.get.mockReturnValue(of({ data: { price: '1000' } }));
      await expect(service.pyramid('u1', 'p1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('setTrailingStop', () => {
    it('activates trailing stop with method', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1', status: 'OPEN' });
      mockPrisma.position.update.mockResolvedValue({ id: 'p1' });
      const result = await service.setTrailingStop('u1', 'p1', { method: 'ema', active: true });
      expect(result.id).toBe('p1');
      expect(mockPrisma.position.update).toHaveBeenCalled();
    });

    it('throws NotFound if position missing', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
      await expect(service.setTrailingStop('u1', 'p1', { active: false })).rejects.toThrow(NotFoundException);
    });

    it('updates only active flag when no method supplied', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1', status: 'OPEN' });
      mockPrisma.position.update.mockResolvedValue({ id: 'p1' });
      const result = await service.setTrailingStop('u1', 'p1', { active: false });
      expect(result.id).toBe('p1');
      expect(mockPrisma.position.update).toHaveBeenCalled();
    });
  });

  describe('findByPortfolio', () => {
    it('returns paginated positions for a portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([{ id: 'p1', asset: { symbol: 'BTC/USDT', name: 'Bitcoin' } }]);
      mockPrisma.position.count.mockResolvedValue(1);
      const result = await service.findByPortfolio('u1', 'pf1', { page: 1, limit: 10, sort: 'entryPrice:asc', status: 'OPEN' });
      expect(result.data).toHaveLength(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('throws NotFound when portfolio missing', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);
      await expect(service.findByPortfolio('u1', 'pf1')).rejects.toThrow(NotFoundException);
    });

    it('defaults to openedAt:desc for invalid sort fields', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'pf1' });
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.position.count.mockResolvedValue(0);
      const result = await service.findByPortfolio('u1', 'pf1', { page: 1, limit: 10, sort: 'invalid:asc' as any });
      expect(result.data).toEqual([]);
    });
  });

  describe('checkGate', () => {
    it('returns valid when price is inside the gate', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        entryPrice: '100',
        stopLoss: '95',
        takeProfit1: '110',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
      });
      const result = await service.checkGate('s1', 100.5);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('returns invalid when no price is available', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        entryPrice: null,
        stopLoss: '95',
        takeProfit1: '110',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
      });
      const result = await service.checkGate('s1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No entry price available');
    });

    it('throws NotFound when signal missing', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue(null);
      await expect(service.checkGate('s1')).rejects.toThrow(NotFoundException);
    });

    it('rejects a BUY signal that already hit stop loss', async () => {
      mockPrisma.signal.findUnique.mockResolvedValue({
        id: 's1',
        signal: 'BUY',
        entryPrice: '100',
        stopLoss: '95',
        takeProfit1: '110',
        asset: { id: 'a1', symbol: 'BTC/USDT' },
      });
      const result = await service.checkGate('s1', 94);
      expect(result.valid).toBe(false);
    });
  });

  describe('closeByWatcher', () => {
    it('closes an open position and notifies', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        originalQuantity: '1',
        portfolioId: 'pf1',
        portfolio: { userId: 'u1', currentCapital: 100 },
        asset: { symbol: 'BTC/USDT' },
      });
      mockPrisma.position.update.mockResolvedValue({});
      mockPrisma.portfolio.update.mockResolvedValue({});
      mockJournal.createAuto.mockResolvedValue(undefined);
      const result = await service.closeByWatcher('p1', 110, 'TP');
      expect(result).not.toBeNull();
      expect(result!.positionId).toBe('p1');
      expect(mockNotifications.push).toHaveBeenCalled();
    });

    it('returns null when position not found or already closed', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
      const result = await service.closeByWatcher('p1', 100, 'SL');
      expect(result).toBeNull();
    });

    it('skips journal when skipJournal option set', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        originalQuantity: '1',
        portfolioId: 'pf1',
        portfolio: { userId: 'u1', currentCapital: 100 },
        asset: { symbol: 'BTC/USDT' },
      });
      await service.closeByWatcher('p1', 110, 'TP', { skipJournal: true });
      expect(mockJournal.createAuto).not.toHaveBeenCalled();
    });
  });

  describe('continuationAdvice', () => {
    it('returns engine advice for an open position', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        asset: { symbol: 'BTC/USDT' },
        signal: { indicators: { adx: 30 } },
        takeProfit: '110',
      });
      mockHttp.get.mockReturnValue(of({ data: { price: '105' } }));
      mockHttp.post.mockReturnValue(of({ data: { recommendation: 'HOLD', confidence: 0.6 } }));
      const result = await service.continuationAdvice('u1', 'p1');
      expect(result.recommendation).toBe('HOLD');
    });

    it('uses provided current price without fetching live', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'OPEN',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        asset: { symbol: 'BTC/USDT' },
        signal: { indicators: {} },
        takeProfit: '110',
      });
      mockHttp.post.mockReturnValue(of({ data: { recommendation: 'PYRAMID' } }));
      await service.continuationAdvice('u1', 'p1', 106);
      expect(mockHttp.get).not.toHaveBeenCalled();
    });

    it('throws NotFound when position missing', async () => {
      mockPrisma.position.findFirst.mockResolvedValue(null);
      await expect(service.continuationAdvice('u1', 'p1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest when position is closed', async () => {
      mockPrisma.position.findFirst.mockResolvedValue({
        id: 'p1',
        status: 'CLOSED',
        direction: 'BUY',
        entryPrice: '100',
        quantity: '1',
        asset: { symbol: 'BTC/USDT' },
        signal: { indicators: {} },
        takeProfit: '110',
      });
      await expect(service.continuationAdvice('u1', 'p1', 105)).rejects.toThrow(BadRequestException);
    });
  });
});
