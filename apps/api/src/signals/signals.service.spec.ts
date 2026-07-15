import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { SignalsService } from './signals.service';
import { SignalOutcomeService } from './signal-outcome.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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
  };

  const mockHttp = {
    post: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn(() => 'http://localhost:8000'),
  };

  const mockNotifications = {
    pushGlobal: jest.fn(),
  };

  const mockOutcomeService = {
    logSignal: jest.fn().mockResolvedValue(undefined),
    getStats: jest.fn().mockResolvedValue({ total: 0, winRate: 0 }),
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
        { provide: SignalOutcomeService, useValue: mockOutcomeService },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
    jest.clearAllMocks();
  });

  describe('triggerScan', () => {
    it('should save high-confidence BUY signals and notify', async () => {
      mockHttp.post.mockReturnValue(of({
        data: {
          results: [
            { symbol: 'BTC/USDT', signal: 'BUY', confidence: 75, timeframe: '1h', entry_price: 100, stop_loss: 90, take_profit_1: 120, take_profit_2: 130, risk_reward: 2, indicators: {}, price_action: {}, sr_zones: {}, patterns: {}, regime: {}, smc: {}, explanation: 'test', news_sentiment: { score: 0.5 } },
            { symbol: 'ETH/USDT', signal: 'NEUTRAL', confidence: 40 },
          ],
        },
      }));
      mockPrisma.strategy.findFirst.mockResolvedValue({ id: 's1' });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.signal.create.mockResolvedValue({ id: 'sig1' });

      const result = await service.triggerScan(['BTC/USDT'], '1h');

      expect(result.saved).toHaveLength(1);
      expect(mockNotifications.pushGlobal).toHaveBeenCalled();
    });

    it('should not notify signals below 70 confidence', async () => {
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

      expect(mockNotifications.pushGlobal).not.toHaveBeenCalled();
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
  });
});
