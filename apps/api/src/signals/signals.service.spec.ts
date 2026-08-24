import { Test, TestingModule } from '@nestjs/testing';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { FeatureStoreService } from './feature-store.service';
import { SignalPredictorService } from './signal-predictor.service';
import { PatternPredictorService } from './pattern-predictor.service';
import { ExpectedMoveService } from '../expected-move/expected-move.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertService } from '../notifications/alert.service';
import { MarketDataService } from '../market-data/market-data.service';
import { QuotaService } from '../billing/quota.service';
import { EngineHttpService } from '../engine/engine-http.service';
import { SystemHealthService } from '../system-health/system-health.service';

describe('SignalsService', () => {
  let service: SignalsService;

  const mockPrisma = {
    asset: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    strategy: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    signal: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userStrategy: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    signalLog: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    scanHistory: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockEngineHttp = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockNotifications = {
    pushGlobal: jest.fn(),
    pushSignal: jest.fn(),
  };

  const mockAlertService = {
    sendSignal: jest.fn().mockReturnValue({ id: 'n1' }),
    getStats: jest.fn().mockReturnValue({ sentToday: 0, maxDaily: 5 }),
  };

  const mockOutcomeService = {
    logSignal: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn().mockResolvedValue({ total: 0, winRate: 0 }),
  };

  const mockFeatureStore = {
    upsertSnapshot: jest.fn().mockResolvedValue(undefined),
    listSnapshots: jest.fn().mockResolvedValue([]),
  };

  const mockPredictorImpl = {
    predict: jest.fn().mockResolvedValue({ confidence_ml: 72.5 }),
    train: jest.fn().mockResolvedValue({ trained: true }),
    getStatus: jest.fn().mockResolvedValue({ trained: true, accuracy: 0.72, updatedAt: new Date().toISOString() }),
    getFeatureWeights: jest.fn().mockResolvedValue({ topFeatures: [] }),
  };
  const mockPredictor = mockPredictorImpl as unknown as SignalPredictorService;

  const mockRegimePredict = jest.fn().mockResolvedValue({ regimes: ['LOW'] });
  const mockRegimeClassifier = {
    predict: mockRegimePredict,
  } as unknown as RegimeClassifierService;

  const mockMarketData = {
    getFearGreed: jest.fn().mockResolvedValue([{ value: 50, classification: 'Neutral' }]),
    getFundingRates: jest.fn().mockResolvedValue([]),
    getOnChainBtc: jest.fn().mockResolvedValue(null),
    getOnChainEth: jest.fn().mockResolvedValue(null),
    getEconomicCalendar: jest.fn().mockResolvedValue([]),
    getSpotPerpBasis: jest.fn().mockResolvedValue([]),
    getCot: jest.fn().mockResolvedValue(null),
  };

  const mockQuota = {
    assertSignalQuota: jest.fn().mockResolvedValue({ limit: null, used: 0 }),
    incrementSignalUsage: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        SignalOutcomeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EngineHttpService, useValue: mockEngineHttp },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AlertService, useValue: mockAlertService },
        { provide: SignalOutcomeService, useValue: mockOutcomeService },
        { provide: FeatureStoreService, useValue: mockFeatureStore },
        { provide: SignalPredictorService, useValue: mockPredictor },
        { provide: RegimeClassifierService, useValue: mockRegimeClassifier },
        { provide: MarketDataService, useValue: mockMarketData },
        { provide: QuotaService, useValue: mockQuota },
        { provide: SystemHealthService, useValue: { recordCronRun: jest.fn(), getCronStatus: jest.fn() } },
        { provide: PatternPredictorService, useValue: { train: jest.fn().mockResolvedValue(undefined), predict: jest.fn().mockResolvedValue({ probability: NaN }) } },
        { provide: ExpectedMoveService, useValue: { getExpectedMove: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
    jest.clearAllMocks();
    mockEngineHttp.get.mockImplementation((path: string) => {
      // Return mock candle data for /candles/ endpoints (used by predictMlRegime)
      if (path.includes('/candles/')) {
        const candles = Array.from({ length: 10 }, (_, i) => ({ close: 100 + i * 0.5 }));
        return Promise.resolve(candles);
      }
      return Promise.resolve(null);
    });
    mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', market: { name: 'CRYPTO' } });
  });

  describe('triggerScan', () => {
    it('should save high-confidence SELL signals', async () => {
      mockEngineHttp.post.mockResolvedValue({
        results: [
          { symbol: 'BTC/USDT', signal: 'SELL', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 110, take_profit_1: 90, take_profit_2: 80, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'sell', news_sentiment: { score: -0.3 }, feature_vector: { levels: { trend: 0.3 } } },
        ],
      });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', market: { name: 'CRYPTO' } });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig2' });

      const result = await service.triggerScan(['BTC/USDT'], '1h');

      expect(result.saved).toHaveLength(1);
      expect(mockPrisma.signal.create).toHaveBeenCalled();
    });

    it('should save high-confidence BUY signals and notify', async () => {
      mockRegimePredict.mockResolvedValueOnce({ regimes: ['NORMAL'] });
      const fetchSpy = jest
        .spyOn<any, any>(service as any, 'fetchExpectedMove')
        .mockResolvedValue({ close: 100, ranges: [{ move_pct: 2 }, { move_pct: 1.5 }, { move_pct: 0.8 }] });
      mockEngineHttp.post.mockResolvedValue({
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 75, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test', news_sentiment: { score: 0.5 }, feature_vector: { levels: { trend: 0.8 } } },
            { symbol: 'ETH/USDT', signal: 'NEUTRAL', confidence: 40 },
          ],
          data_gaps: [{ symbol: 'XAU/USD', providers: ['binance', 'twelvedata'] }],
        });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', market: { name: 'CRYPTO' } });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      const result = await service.triggerScan(['BTC/USDT'], '1h');

      expect(result.saved).toHaveLength(1);
      expect(mockAlertService.sendSignal).toHaveBeenCalled();
      expect(result.data_gaps).toEqual([{ symbol: 'XAU/USD', providers: ['binance', 'twelvedata'] }]);
      expect(mockQuota.assertSignalQuota).not.toHaveBeenCalled();
      expect(mockPredictorImpl.predict).toHaveBeenCalled();
      expect(mockRegimePredict).toHaveBeenCalled();
      const metadata = mockPrisma.signal.create.mock.calls[0][0].data.metadata;
      expect(metadata.ml_regime).toBe('NORMAL');
      expect(mockFeatureStore.upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        signalId: 'sig1',
        symbol: 'BTC/USDT',
        market: 'CRYPTO',
        timeframe: '1h',
        direction: 'BUY',
      }));
      fetchSpy.mockRestore();
    });

    it('handles missing expected move data', async () => {
      const fetchSpy = jest
        .spyOn<any, any>(service as any, 'fetchExpectedMove')
        .mockResolvedValue(null);
      mockEngineHttp.post.mockResolvedValue({
        results: [
          { symbol: 'BTC/USDT', signal: 'BUY', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test' },
        ],
      });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      const result = await service.triggerScan(['BTC/USDT'], '1h');

      expect(result.saved).toHaveLength(1);
      fetchSpy.mockRestore();
    });

    it('rethrows engine scan errors', async () => {
      mockEngineHttp.post.mockRejectedValue(new Error('engine down'));

      await expect(service.triggerScan(['BTC/USDT'], '1h')).rejects.toThrow('Engine scan failed: engine down');
    });

    it('should not notify signals below 70 confidence', async () => {
      mockRegimePredict.mockResolvedValue({ regimes: ['LOW'] });
      mockEngineHttp.post.mockResolvedValue({
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 60, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test' },
          ],
        });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      await service.triggerScan(['BTC/USDT'], '1h');

      expect(mockAlertService.sendSignal).not.toHaveBeenCalled();
    });

    it('should enforce user signal quota and skip notifications when exhausted', async () => {
      mockQuota.assertSignalQuota.mockResolvedValueOnce({ limit: 1, used: 1 });
      mockEngineHttp.post.mockResolvedValue({
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'quota' },
          ],
        });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      await service.triggerScan(['BTC/USDT'], '1h', { userId: 'user-1' });

      expect(mockQuota.assertSignalQuota).toHaveBeenCalledWith('user-1');
      expect(mockAlertService.sendSignal).not.toHaveBeenCalled();
      expect(mockQuota.incrementSignalUsage).not.toHaveBeenCalled();
    });

    it('increments signal usage when notifications are sent for a user', async () => {
      mockQuota.assertSignalQuota.mockResolvedValueOnce({ limit: 3, used: 1 });
      mockEngineHttp.post.mockResolvedValue({
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'ok', news_sentiment: { score: 0.5 } },
          ],
        });
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      await service.triggerScan(['BTC/USDT'], '1h', { userId: 'user-2' });

      expect(mockQuota.incrementSignalUsage).toHaveBeenCalledWith('user-2', 1);
    });
  });

  describe('findAll', () => {
    it('should return paginated signals', async () => {
      mockPrisma.signal.findMany.mockResolvedValue([{ id: 'sig1' }]);
      mockPrisma.signal.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10, sort: 'createdAt:desc' });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should filter signals by market', async () => {
      mockPrisma.signal.findMany.mockResolvedValue([{ id: 'sig1', asset: { market: { name: 'crypto' } } }]);
      mockPrisma.signal.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10, sort: 'createdAt:desc', market: 'CRYPTO' });

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.signal.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          asset: { market: { name: { equals: 'CRYPTO', mode: 'insensitive' } } },
        }),
      }));
    });
  });

  describe('predictor orchestration', () => {
    it('trains the predictor through service', async () => {
      await service.trainPredictor({ market: 'CRYPTO', timeframe: '1h', limit: 500 });
      expect(mockPredictorImpl.train).toHaveBeenCalledWith('CRYPTO', '1h', 500);
    });

    it('exposes predictor status', async () => {
      const status = await service.getPredictorStatus();
      expect(mockPredictorImpl.getStatus).toHaveBeenCalled();
      expect(status.trained).toBe(true);
    });
  });

  describe('scheduled scans (cron)', () => {
    it('scheduledMorningScan groups strategies by analysisTimeframe and scans each group', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }]);
      const strategies = [
        { id: 's1', name: 'EMA Trend', rules: {}, analysisTimeframe: '1h', entryTimeframe: '1h' },
        { id: 's2', name: 'Swing Trend', rules: {}, analysisTimeframe: '4h', entryTimeframe: '1h' },
        { id: 's3', name: 'BRVM Value', rules: {}, analysisTimeframe: '1d', entryTimeframe: '1d' },
      ];
      mockPrisma.strategy.findMany.mockResolvedValue(strategies);
      const triggerScanSpy = jest.spyOn(service, 'triggerScan').mockResolvedValue({ saved: [] } as any);

      await service.scheduledMorningScan();

      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { symbol: true },
      });
      expect(mockPrisma.strategy.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { id: true, name: true, rules: true, analysisTimeframe: true, entryTimeframe: true },
      });
      // One triggerScan call per timeframe group
      expect(triggerScanSpy).toHaveBeenCalledTimes(3);
      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT', 'ETH/USDT'], '1h', { strategies: [strategies[0]] });
      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT', 'ETH/USDT'], '4h', { strategies: [strategies[1]] });
      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT', 'ETH/USDT'], '1d', { strategies: [strategies[2]] });
    });

    it('scheduledDayScan falls back to 1h when no strategies are active', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([{ symbol: 'BTC/USDT' }]);
      mockPrisma.strategy.findMany.mockResolvedValue([]);
      const triggerScanSpy = jest.spyOn(service, 'triggerScan').mockResolvedValue({ saved: [] } as any);

      await service.scheduledDayScan();

      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT'], '1h', { strategies: [] });
    });

    it('scheduledDayScan groups strategies by analysisTimeframe', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([{ symbol: 'BTC/USDT' }]);
      const strategies = [
        { id: 's1', name: 'EMA Trend', rules: {}, analysisTimeframe: '1h', entryTimeframe: '1h' },
        { id: 's2', name: 'Swing', rules: {}, analysisTimeframe: '4h', entryTimeframe: '1h' },
      ];
      mockPrisma.strategy.findMany.mockResolvedValue(strategies);
      const triggerScanSpy = jest.spyOn(service, 'triggerScan').mockResolvedValue({ saved: [] } as any);

      await service.scheduledDayScan();

      expect(triggerScanSpy).toHaveBeenCalledTimes(2);
      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT'], '1h', { strategies: [strategies[0]] });
      expect(triggerScanSpy).toHaveBeenCalledWith(['BTC/USDT'], '4h', { strategies: [strategies[1]] });
    });

    it('skips the scan entirely when there are no active assets', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([]);
      mockPrisma.strategy.findMany.mockResolvedValue([]);
      const triggerScanSpy = jest.spyOn(service, 'triggerScan');

      await service.scheduledMorningScan();

      expect(triggerScanSpy).not.toHaveBeenCalled();
    });

    it('scheduledPredictorTraining trains the CRYPTO/1h predictor', async () => {
      const trainSpy = jest.spyOn(service, 'trainPredictor').mockResolvedValue({ trained: true } as any);

      await service.scheduledPredictorTraining();

      expect(trainSpy).toHaveBeenCalledWith({ market: 'CRYPTO', timeframe: '1h' });
    });

    it('scheduledPredictorTraining swallows training errors without throwing', async () => {
      jest.spyOn(service, 'trainPredictor').mockRejectedValue(new Error('training failed'));

      await expect(service.scheduledPredictorTraining()).resolves.toBeUndefined();
    });
  });

  describe('findByAsset', () => {
    it('returns active signals for an asset', async () => {
      mockPrisma.signal.findMany.mockResolvedValue([{ id: 's1', asset: { symbol: 'BTC/USDT' } }]);

      const result = await service.findByAsset('a1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.signal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assetId: 'a1', isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
    });
  });

  describe('findScanHistory', () => {
    it('returns paginated scan history with all filters', async () => {
      mockPrisma.scanHistory.findMany.mockResolvedValue([{ id: 'h1' }]);
      mockPrisma.scanHistory.count.mockResolvedValue(1);

      const result = await service.findScanHistory({
        page: 1,
        limit: 20,
        strategyId: 's1',
        strategyName: 'Stoch',
        symbol: 'BTC/USDT',
        signal: 'BUY',
        timeframe: '1h',
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.scanHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            strategyId: 's1',
            strategyName: 'Stoch',
            symbol: 'BTC/USDT',
            signal: 'BUY',
            timeframe: '1h',
          },
        }),
      );
    });

    it('returns second page', async () => {
      mockPrisma.scanHistory.findMany.mockResolvedValue([]);
      mockPrisma.scanHistory.count.mockResolvedValue(30);

      const result = await service.findScanHistory({ page: 2, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
    });
  });

  describe('exportFeatureDataset', () => {
    it('maps snapshots to CSV-ready rows', async () => {
      mockFeatureStore.listSnapshots.mockResolvedValue([
        {
          signalId: 's1',
          signal: { id: 's1', signal: 'BUY', confidence: 80, timeframe: '1h', createdAt: new Date(), asset: { market: { name: 'CRYPTO' }, symbol: 'BTC/USDT' } },
          outcome: 'WIN',
          pnl: 12,
          features: { rsi: 60 },
          concept: 'breakout',
          embedding: [1, 2],
        },
      ]);

      const result = await service.exportFeatureDataset({ market: 'CRYPTO', limit: 500 });

      expect(result[0].symbol).toBe('BTC/USDT');
      expect(result[0].market).toBe('CRYPTO');
      expect(result[0].direction).toBe('BUY');
      expect(mockFeatureStore.listSnapshots).toHaveBeenCalledWith({ market: 'CRYPTO', limit: 500 });
    });

    it('defaults limit to 1000', async () => {
      mockFeatureStore.listSnapshots.mockResolvedValue([]);
      await service.exportFeatureDataset({});
      expect(mockFeatureStore.listSnapshots).toHaveBeenCalledWith({ limit: 1000 });
    });
  });

  describe('ingestSignal', () => {
    it('returns null when input is empty', async () => {
      expect(await service.ingestSignal(null as any)).toBeNull();
      expect(await service.ingestSignal({ signal: 'BUY' } as any)).toBeNull();
    });

    it('returns null for NEUTRAL signal', async () => {
      const result = await service.ingestSignal({ signal: 'NEUTRAL', confidence: 80 });
      expect(result).toBeNull();
    });

    it('returns null when confidence < 70', async () => {
      const result = await service.ingestSignal({ signal: 'BUY', confidence: 50 });
      expect(result).toBeNull();
    });

    it('returns saved signal on success', async () => {
      const saveSpy = jest.spyOn(service as any, 'saveSignals').mockResolvedValue([{ id: 's1' }]);
      const result = await service.ingestSignal({ signal: 'BUY', confidence: 80, symbol: 'BTC/USDT' });
      expect(result).toEqual({ id: 's1' });
      expect(saveSpy).toHaveBeenCalledWith([{ signal: 'BUY', confidence: 80, symbol: 'BTC/USDT' }], '*');
    });

    it('returns null and warns when save fails', async () => {
      jest.spyOn(service as any, 'saveSignals').mockRejectedValue(new Error('db'));
      const result = await service.ingestSignal({ signal: 'BUY', confidence: 80, symbol: 'BTC/USDT' });
      expect(result).toBeNull();
    });
  });
});
