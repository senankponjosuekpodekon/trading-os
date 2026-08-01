import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { LabService } from './lab.service';
import { PrismaService } from '../prisma/prisma.service';
import { EngineHttpService } from '../engine/engine-http.service';

describe('LabService', () => {
  let service: LabService;

  const mockPrisma = {
    labSession: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    strategy: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockEngine = {
    post: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EngineHttpService, useValue: mockEngine },
      ],
    }).compile();

    service = module.get<LabService>(LabService);
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a lab session', async () => {
      mockPrisma.labSession.create.mockResolvedValue({ id: 'lab-1' });

      const result = await service.createSession('u1', {
        name: 'Test',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        strategy: { name: 'MA Cross' },
      });

      expect(result.id).toBe('lab-1');
    });
  });

  describe('findByUser', () => {
    it('should filter by status if provided', async () => {
      mockPrisma.labSession.findMany.mockResolvedValue([]);

      await service.findByUser('u1', 'COMPLETED');

      expect(mockPrisma.labSession.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('runBacktest', () => {
    it('should persist backtest metrics on success', async () => {
      const session = {
        id: 'lab-1',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        strategy: { name: 'MA' },
      };
      mockPrisma.labSession.findFirst.mockResolvedValue(session);
      mockPrisma.labSession.update.mockResolvedValue({ ...session, status: 'COMPLETED' });
      mockEngine.post.mockResolvedValue({
        win_rate: 60,
        total_pnl: 100,
        total_pnl_pct: 1,
        max_drawdown: 50,
        max_drawdown_pct: 0.5,
        sharpe_ratio: 1.2,
        profit_factor: 1.8,
        expectancy: 0.6,
        trades: 10,
        final_capital: 10100,
        benchmark_pnl_pct: 0.5,
        outperformance_pct: 0.5,
        trade_list: [{ pnl: 10 }],
      });

      const result = await service.runBacktest('u1', 'lab-1', {});

      expect(mockPrisma.labSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lab-1' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(result.metrics.profit_factor).toBe(1.8);
    });

    it('should reset status to DRAFT on engine failure', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1', symbol: 'BTC/USDT', timeframe: '1h', strategy: {},
      });
      mockEngine.post.mockRejectedValue(new Error('engine down'));

      await expect(service.runBacktest('u1', 'lab-1', {})).rejects.toThrow('engine down');

      expect(mockPrisma.labSession.update).toHaveBeenCalledWith({
        where: { id: 'lab-1' },
        data: { status: 'DRAFT' },
      });
    });
  });

  describe('evaluate', () => {
    it('should return STRONG verdict for excellent metrics', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        backtestMetrics: {
          profit_factor: 2.0,
          win_rate: 60,
          expectancy: 0.8,
          max_drawdown_pct: 5,
          sharpe_ratio: 1.5,
        },
      });

      const result = await service.evaluate('u1', 'lab-1');

      expect(result.verdict).toBe('STRONG');
      expect(result.score).toBeGreaterThanOrEqual(7);
    });

    it('should return NO_DATA when metrics are absent', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({ id: 'lab-1', backtestMetrics: null });

      const result = await service.evaluate('u1', 'lab-1');

      expect(result.verdict).toBe('NO_DATA');
      expect(result.score).toBeNull();
    });
  });

  describe('profileSuitability', () => {
    it('should approve a conservative-friendly strategy', () => {
      const metrics = {
        max_drawdown_pct: 8,
        profit_factor: 1.6,
        win_rate: 55,
        sharpe_ratio: 1.2,
      };

      const result = service.profileSuitability(metrics, { riskLevel: 'conservative' });

      expect(result.suitable).toBe(true);
      expect(result.reasons).toBeUndefined();
    });

    it('should reject a too-risky strategy for conservative profile', () => {
      const metrics = {
        max_drawdown_pct: 25,
        profit_factor: 1.1,
        win_rate: 40,
        sharpe_ratio: 0.5,
      };

      const result = service.profileSuitability(metrics, { riskLevel: 'conservative', maxDrawdownPct: 10, minWinRate: 50 });

      expect(result.suitable).toBe(false);
      expect(result.reasons?.length).toBeGreaterThan(0);
    });
  });

  describe('getStrategyTemplates', () => {
    it('should return built-in strategy templates', () => {
      const templates = service.getStrategyTemplates();

      expect(templates.length).toBeGreaterThanOrEqual(3);
      expect(templates.find(t => t.id === 'trend_following')).toBeDefined();
    });
  });

  describe('promoteToProduction', () => {
    it('should create a Strategy from a completed lab session', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        userId: 'u1',
        name: 'Trend breakout',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        status: 'COMPLETED',
        strategy: { type: 'trend' },
        backtestMetrics: { profit_factor: 1.8, win_rate: 55 },
      });
      mockPrisma.strategy.findUnique.mockResolvedValue(null);
      mockPrisma.strategy.create.mockResolvedValue({ id: 'strat-1', name: 'Trend breakout (Lab)' });
      mockPrisma.labSession.update.mockResolvedValue({});

      const result = await service.promoteToProduction('u1', 'lab-1');

      expect(result.promoted).toBe(true);
      expect(result.strategyId).toBe('strat-1');
      expect(mockPrisma.strategy.create).toHaveBeenCalled();
    });

    it('should reject promotion if backtest is not completed', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1', userId: 'u1', status: 'DRAFT', name: 'x', symbol: 'BTC/USDT', timeframe: '1h', strategy: {},
      });

      const result = await service.promoteToProduction('u1', 'lab-1');

      expect(result.error).toBe('NOT_COMPLETED');
    });

    it('should reject promotion if performance is too weak', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1', userId: 'u1', status: 'COMPLETED', name: 'x', symbol: 'BTC/USDT', timeframe: '1h',
        strategy: {}, backtestMetrics: { profit_factor: 1.0, win_rate: 30 },
      });

      const result = await service.promoteToProduction('u1', 'lab-1');

      expect(result.error).toBe('WEAK_PERFORMANCE');
    });
  });

  describe('generateReport', () => {
    it('should return a detailed report from session data', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        name: 'Test report',
        symbol: 'BTC/USDT',
        timeframe: '1h',
        strategy: { type: 'trend' },
        backtestMetrics: {
          win_rate: 55,
          profit_factor: 1.8,
          expectancy: 0.6,
          max_drawdown_pct: 10,
          sharpe_ratio: 1.3,
          outperformance_pct: 2.5,
        },
        tradeList: [
          { win: true, pnl_pct: 1.2, pnl: 120, entry_bar: 10, exit_bar: 14, entry_price: 100, exit_price: 101, direction: 'BUY', exit_reason: 'TP', rr_achieved: 2, confidence: 70, signal_reasons: ['ema'] },
          { win: false, pnl_pct: -0.6, pnl: -60, entry_bar: 20, exit_bar: 22, entry_price: 101, exit_price: 100, direction: 'SELL', exit_reason: 'SL', rr_achieved: 0.5, confidence: 60, signal_reasons: ['rsi'] },
        ],
      });

      const report = await service.generateReport('u1', 'lab-1');

      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('tradeDetails');
      expect(report).toHaveProperty('recommendations');
      expect(report.statistics.avgHoldBars).toBe(3);
      expect(report.statistics.bestTradePct).toBe(1.2);
      expect(report.statistics.reasonDistribution).toEqual({ ema: 1, rsi: 1 });
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should return NO_DATA when there are no trades', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        name: 'Empty',
        backtestMetrics: { win_rate: 0 },
        tradeList: [],
      });

      const report = await service.generateReport('u1', 'lab-1');

      expect(report.error).toBe('NO_DATA');
    });
  });

  describe('walkForwardAnalysis', () => {
    it('should flag robust strategy when IS/OOS metrics are stable', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        backtestMetrics: { win_rate: 55, profit_factor: 1.8 },
        tradeList: [
          { win: true, pnl: 100, pnl_pct: 1 },
          { win: true, pnl: 100, pnl_pct: 1 },
          { win: true, pnl: 100, pnl_pct: 1 },
          { win: true, pnl: 100, pnl_pct: 1 },
        ],
      });

      const result = await service.walkForwardAnalysis('u1', 'lab-1') as any;

      expect(result.verdict).toBe('ROBUST');
      expect(result.inSample.trades).toBe(2);
      expect(result.outOfSample.trades).toBe(2);
    });

    it('should return INSUFFICIENT_DATA for fewer than 4 trades', async () => {
      mockPrisma.labSession.findFirst.mockResolvedValue({
        id: 'lab-1',
        backtestMetrics: { win_rate: 55 },
        tradeList: [{ win: true, pnl: 100, pnl_pct: 1 }],
      });

      const result = await service.walkForwardAnalysis('u1', 'lab-1');

      expect(result.error).toBe('INSUFFICIENT_DATA');
    });
  });

  describe('compareSessions', () => {
    it('should rank sessions and pick a winner', async () => {
      mockPrisma.labSession.findMany.mockResolvedValue([
        {
          id: 'lab-a',
          name: 'Strategy A',
          status: 'COMPLETED',
          createdAt: new Date('2026-01-01'),
          backtestMetrics: { win_rate: 50, profit_factor: 1.5, sharpe_ratio: 1.0, max_drawdown_pct: 10 },
        },
        {
          id: 'lab-b',
          name: 'Strategy B',
          status: 'COMPLETED',
          createdAt: new Date('2026-01-02'),
          backtestMetrics: { win_rate: 60, profit_factor: 2.0, sharpe_ratio: 1.5, max_drawdown_pct: 5 },
        },
      ]);

      const result = await service.compareSessions('u1', ['lab-a', 'lab-b']);

      expect(result.count).toBe(2);
      expect(result.winnerId).toBe('lab-b');
      expect(result.sessions[0].id).toBe('lab-b');
      expect(result.sessions[0].score).toBeGreaterThan(result.sessions[1].score);
    });
  });
});
