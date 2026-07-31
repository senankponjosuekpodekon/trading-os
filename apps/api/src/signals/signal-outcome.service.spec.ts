import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SignalOutcomeService } from './signal-outcome.service';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureStoreService } from './feature-store.service';

describe('SignalOutcomeService', () => {
  let service: SignalOutcomeService;

  const mockPrisma = {
    signalLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockHttp = {
    get: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string, def: string) => def),
  };

  const mockFeatureStore = {
    attachOutcome: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalOutcomeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: FeatureStoreService, useValue: mockFeatureStore },
      ],
    }).compile();

    service = module.get<SignalOutcomeService>(SignalOutcomeService);
    jest.clearAllMocks();
    mockPrisma.signalLog.findMany.mockResolvedValue([]);
  });

  describe('logSignal', () => {
    it('should persist a valid BUY signal', async () => {
      mockPrisma.signalLog.create.mockResolvedValue({ id: 'log-1' });

      await service.logSignal(
        {
          symbol: 'BTC/USDT',
          timeframe: '1h',
          signal: 'BUY',
          confidence: 80,
          entry_price: 50000,
          stop_loss: 49000,
          take_profit_1: 51000,
          take_profit_2: 52000,
          risk_reward: 2,
          indicators: { score_trend: 1, score_total: 80 },
          regime: { regime: 'TREND', adx: 30 },
        },
        'CRYPTO',
      );

      expect(mockPrisma.signalLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          symbol: 'BTC/USDT',
          signalType: 'BUY',
          entryPrice: 50000,
          scoreTrend: 1,
          scoreTotal: 80,
          regime: 'TREND',
          market: 'CRYPTO',
        }),
      });
    });

    it('should skip NEUTRAL signals', async () => {
      await service.logSignal(
        { symbol: 'BTC/USDT', signal: 'NEUTRAL', entry_price: 50000 },
        'CRYPTO',
      );
      expect(mockPrisma.signalLog.create).not.toHaveBeenCalled();
    });

    it('should skip signals without entry price', async () => {
      await service.logSignal({ symbol: 'BTC/USDT', signal: 'BUY' }, 'CRYPTO');
      expect(mockPrisma.signalLog.create).not.toHaveBeenCalled();
    });

    it('should not throw when prisma create fails', async () => {
      mockPrisma.signalLog.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.logSignal(
          { symbol: 'BTC/USDT', signal: 'BUY', confidence: 70, entry_price: 50000 },
          'CRYPTO',
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('resolveOutcomes', () => {
    const makeKline = (ts: number, high: number, low: number) => [
      ts, '0', String(high), String(low), '0', '0',
    ];

    it('should mark WIN_TP1 when high reaches TP1 for a BUY', async () => {
      const created = Date.now() - 3600_000;
      mockFeatureStore.attachOutcome.mockResolvedValue(undefined);
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          signalId: 'sig-1',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          signalType: 'BUY',
          entryPrice: '50000',
          stopLoss: '49000',
          takeProfit1: '51000',
          takeProfit2: '52000',
          createdAt: new Date(created),
        },
      ]);
      mockHttp.get.mockReturnValue(
        of({ data: [makeKline(created + 60_000, 51_500, 49_800)] }),
      );
      mockPrisma.signalLog.update.mockResolvedValue({});

      await service.resolveOutcomes();

      expect(mockPrisma.signalLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: expect.objectContaining({ outcome: 'WIN_TP1', outcomePrice: 51000 }),
      });
      expect(mockFeatureStore.attachOutcome).toHaveBeenCalledWith('sig-1', 'WIN_TP1', expect.any(Number));
    });

    it('should mark LOSS_SL when low hits SL for a BUY', async () => {
      const created = Date.now() - 3600_000;
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-2',
          symbol: 'ETH/USDT',
          timeframe: '1h',
          signalType: 'BUY',
          entryPrice: '3000',
          stopLoss: '2900',
          takeProfit1: '3100',
          takeProfit2: null,
          createdAt: new Date(created),
        },
      ]);
      mockHttp.get.mockReturnValue(
        of({ data: [makeKline(created + 60_000, 3050, 2890)] }),
      );
      mockPrisma.signalLog.update.mockResolvedValue({});

      await service.resolveOutcomes();

      expect(mockPrisma.signalLog.update).toHaveBeenCalledWith({
        where: { id: 'log-2' },
        data: expect.objectContaining({ outcome: 'LOSS_SL', outcomePrice: 2900 }),
      });
    });

    it('should mark WIN_TP2 when low reaches TP2 for a SELL', async () => {
      const created = Date.now() - 3600_000;
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-3',
          symbol: 'SOL/USDT',
          timeframe: '1h',
          signalType: 'SELL',
          entryPrice: '150',
          stopLoss: '155',
          takeProfit1: '145',
          takeProfit2: '140',
          createdAt: new Date(created),
        },
      ]);
      mockHttp.get.mockReturnValue(
        of({ data: [makeKline(created + 60_000, 151, 139)] }),
      );
      mockPrisma.signalLog.update.mockResolvedValue({});

      await service.resolveOutcomes();

      expect(mockPrisma.signalLog.update).toHaveBeenCalledWith({
        where: { id: 'log-3' },
        data: expect.objectContaining({ outcome: 'WIN_TP2', outcomePrice: 140 }),
      });
    });

    it('should not update when no target hit and not expired', async () => {
      const created = Date.now() - 60_000;
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-4',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          signalType: 'BUY',
          entryPrice: '50000',
          stopLoss: '49000',
          takeProfit1: '51000',
          takeProfit2: null,
          createdAt: new Date(created),
        },
      ]);
      mockHttp.get.mockReturnValue(
        of({ data: [makeKline(created + 30_000, 50_500, 49_500)] }),
      );

      await service.resolveOutcomes();

      expect(mockPrisma.signalLog.update).not.toHaveBeenCalled();
    });

    it('should expire old non-Binance (BRVM) signals after 5 days when engine returns no data', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-5',
          symbol: 'SNTS',
          timeframe: '1d',
          signalType: 'BUY',
          entryPrice: '10000',
          createdAt: new Date(Date.now() - 6 * 86_400_000),
        },
      ]);
      mockPrisma.signalLog.update.mockResolvedValue({});
      // Engine returns empty candles — resolution fails, signal expires
      mockHttp.get.mockReturnValue(of({ data: [] }));

      await service.resolveOutcomes();

      // Engine was called for non-Binance symbol
      expect(mockHttp.get).toHaveBeenCalledWith(
        expect.stringContaining('/candles/SNTS'),
      );
      expect(mockPrisma.signalLog.update).toHaveBeenCalledWith({
        where: { id: 'log-5' },
        data: expect.objectContaining({ outcome: 'EXPIRED' }),
      });
    });

    it('should continue when one resolution fails', async () => {
      const created = Date.now() - 3600_000;
      mockPrisma.signalLog.findMany.mockResolvedValue([
        {
          id: 'log-err',
          symbol: 'BTC/USDT',
          timeframe: '1h',
          signalType: 'BUY',
          entryPrice: '50000',
          stopLoss: '49000',
          takeProfit1: '51000',
          takeProfit2: null,
          createdAt: new Date(created),
        },
        {
          id: 'log-ok',
          symbol: 'ETH/USDT',
          timeframe: '1h',
          signalType: 'BUY',
          entryPrice: '3000',
          stopLoss: '2900',
          takeProfit1: '3100',
          takeProfit2: null,
          createdAt: new Date(created),
        },
      ]);
      mockHttp.get
        .mockImplementationOnce(() => {
          throw new Error('binance down');
        })
        .mockReturnValueOnce(
          of({ data: [makeKline(created + 60_000, 3150, 2950)] }),
        );
      mockPrisma.signalLog.update.mockResolvedValue({});

      await expect(service.resolveOutcomes()).resolves.toBeUndefined();

      expect(mockPrisma.signalLog.update).toHaveBeenCalledWith({
        where: { id: 'log-ok' },
        data: expect.objectContaining({ outcome: 'WIN_TP1' }),
      });
    });
  });

  describe('getStats', () => {
    it('should compute win rates from resolved logs', async () => {
      const logs = [
        { outcome: 'WIN_TP1' },
        { outcome: 'WIN_TP2' },
        { outcome: 'LOSS_SL' },
        { outcome: 'EXPIRED' },
      ];
      // Appel principal + 4 marchés (_statsByMarket)
      mockPrisma.signalLog.findMany
        .mockResolvedValueOnce(logs)
        .mockResolvedValue([]);

      const stats = await service.getStats();

      expect(stats.total).toBe(4);
      expect(stats.win_tp1).toBe(1);
      expect(stats.win_tp2).toBe(1);
      expect(stats.loss_sl).toBe(1);
      expect(stats.expired).toBe(1);
      expect(stats.win_rate_tp1).toBe(50);
      expect(stats.win_rate_tp2).toBe(25);
      expect(stats.by_market).toBeDefined();
    });

    it('should return null win rates when no logs', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([]);

      const stats = await service.getStats('CRYPTO');

      expect(stats.total).toBe(0);
      expect(stats.win_rate_tp1).toBeNull();
      expect(stats.by_market).toBeNull();
    });
  });

  describe('confidence calibration (feedback loop)', () => {
    it('should bucket resolved outcomes by confidence decile', async () => {
      const logs = [
        { confidence: 72, outcome: 'WIN_TP1' },
        { confidence: 75, outcome: 'WIN_TP2' },
        { confidence: 78, outcome: 'LOSS_SL' },
        { confidence: 81, outcome: 'WIN_TP1' },
        { confidence: 85, outcome: 'EXPIRED' },
      ];
      mockPrisma.signalLog.findMany.mockResolvedValue(logs);

      const calibration = await service.getConfidenceCalibration();

      expect(calibration.total).toBe(5);
      expect(calibration.buckets['70-80']).toEqual({
        total: 3, win: 2, loss: 1, other: 0, winRate: 67,
      });
      expect(calibration.buckets['80-90']).toEqual({
        total: 2, win: 1, loss: 0, other: 1, winRate: 50,
      });
    });

    it('should filter by market and signalType', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([]);

      await service.getConfidenceCalibration('CRYPTO', 'BUY');

      expect(mockPrisma.signalLog.findMany).toHaveBeenCalledWith({
        where: { outcome: { not: 'PENDING' }, market: 'CRYPTO', signalType: 'BUY' },
        take: 5000,
      });
    });

    it('should predict win rate from matching bucket', async () => {
      const logs = [
        { confidence: 62, outcome: 'WIN_TP1' },
        { confidence: 65, outcome: 'WIN_TP2' },
        { confidence: 68, outcome: 'LOSS_SL' },
      ];
      mockPrisma.signalLog.findMany.mockResolvedValue(logs);

      const prediction = await service.predictWinRate(63, 'CRYPTO');

      expect(prediction.bucket).toBe('60-70');
      expect(prediction.predictedWinRate).toBe(67);
      expect(prediction.sampleSize).toBe(3);
    });

    it('should return null predicted win rate for empty bucket', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([]);

      const prediction = await service.predictWinRate(93);

      expect(prediction.bucket).toBe('90-100');
      expect(prediction.predictedWinRate).toBeNull();
      expect(prediction.sampleSize).toBe(0);
    });
  });

  describe('getPatternStats', () => {
    it('should aggregate outcomes by pattern name', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([
        { patternName: 'double_top', outcome: 'WIN_TP1', barsToOutcome: 5, patternConfluenceScore: 0.8, realizedPnlPct: 2.1, expectedPnlPct: 1.5, entryPrice: '100', outcomePrice: '102' },
        { patternName: 'double_top', outcome: 'LOSS_SL', barsToOutcome: 3, patternConfluenceScore: 0.6, realizedPnlPct: -1.0, expectedPnlPct: 1.5, entryPrice: '100', outcomePrice: '99' },
        { patternName: 'abcd', outcome: 'WIN_TP2', barsToOutcome: 8, patternConfluenceScore: 0.9, realizedPnlPct: 3.5, expectedPnlPct: 2.0, entryPrice: '100', outcomePrice: '104' },
      ]);

      const stats = await service.getPatternStats();

      expect(stats.total).toBe(3);
      expect(stats.patterns.double_top.trades).toBe(2);
      expect(stats.patterns.double_top.wins).toBe(1);
      expect(stats.patterns.double_top.losses).toBe(1);
      expect(stats.patterns.double_top.winRate).toBe(50);
      expect(stats.patterns.abcd.winRate).toBe(100);
    });
  });

  describe('getPostTradeAnalysis', () => {
    it('should compare expected vs realized PnL', async () => {
      mockPrisma.signalLog.findMany.mockResolvedValue([
        { expectedPnlPct: 2, realizedPnlPct: 1 },
        { expectedPnlPct: 2, realizedPnlPct: 3 },
      ]);

      const analysis = await service.getPostTradeAnalysis();

      expect(analysis.avgExpectedPnlPct).toBe(2);
      expect(analysis.avgRealizedPnlPct).toBe(2);
      expect(analysis.bias).toBe(0);
    });
  });
});
