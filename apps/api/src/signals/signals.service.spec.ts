import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { FeatureStoreService } from './feature-store.service';
import { SignalPredictorService } from './signal-predictor.service';
import { RegimeClassifierService } from './regime-classifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertService } from '../notifications/alert.service';
import { MarketDataService } from '../market-data/market-data.service';
import { QuotaService } from '../billing/quota.service';

describe('SignalsService', () => {
  let service: SignalsService;

  const mockPrisma = {
    asset: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    strategy: {
      findFirst: jest.fn(),
    },
    signal: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    userStrategy: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockHttp = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn(() => 'http://localhost:8000'),
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
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AlertService, useValue: mockAlertService },
        { provide: SignalOutcomeService, useValue: mockOutcomeService },
        { provide: FeatureStoreService, useValue: mockFeatureStore },
        { provide: SignalPredictorService, useValue: mockPredictor },
        { provide: RegimeClassifierService, useValue: mockRegimeClassifier },
        { provide: MarketDataService, useValue: mockMarketData },
        { provide: QuotaService, useValue: mockQuota },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
    jest.clearAllMocks();
    mockHttp.get.mockReturnValue(of({ data: null }));
    mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', market: { name: 'CRYPTO' } });
  });

  describe('triggerScan', () => {
    it('should save high-confidence BUY signals and notify', async () => {
      mockRegimePredict.mockResolvedValueOnce({ regimes: ['NORMAL'] });
      const fetchSpy = jest
        .spyOn<any, any>(service as any, 'fetchExpectedMove')
        .mockResolvedValue({ close: 100, ranges: [{ move_pct: 2 }, { move_pct: 1.5 }, { move_pct: 0.8 }] });
      mockHttp.post.mockReturnValue(of({
        data: {
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 75, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test', news_sentiment: { score: 0.5 }, feature_vector: { levels: { trend: 0.8 } } },
            { symbol: 'ETH/USDT', signal: 'NEUTRAL', confidence: 40 },
          ],
        },
      }));
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1', market: { name: 'CRYPTO' } });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      const result = await service.triggerScan(['BTC/USDT'], '1h');

      expect(result.saved).toHaveLength(1);
      expect(mockAlertService.sendSignal).toHaveBeenCalled();
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

    it('should not notify signals below 70 confidence', async () => {
      mockRegimePredict.mockResolvedValue({ regimes: ['LOW'] });
      mockHttp.post.mockReturnValue(of({
        data: {
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 60, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test' },
          ],
        },
      }));
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      await service.triggerScan(['BTC/USDT'], '1h');

      expect(mockAlertService.sendSignal).not.toHaveBeenCalled();
    });

    it('should enforce user signal quota and skip notifications when exhausted', async () => {
      mockQuota.assertSignalQuota.mockResolvedValueOnce({ limit: 1, used: 1 });
      mockHttp.post.mockReturnValue(of({
        data: {
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'quota' },
          ],
        },
      }));
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
      mockHttp.post.mockReturnValue(of({
        data: {
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 80, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'ok', news_sentiment: { score: 0.5 } },
          ],
        },
      }));
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
});
