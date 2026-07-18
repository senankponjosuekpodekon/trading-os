import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import * as request from 'supertest';
import { SignalsModule } from './signals.module';
import { SignalOutcomeService } from './signal-outcome.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuotaService } from '../billing/quota.service';

const fakeGuard: CanActivate = {
  canActivate: (context: ExecutionContext) => {
    context.switchToHttp().getRequest().user = { id: 'user-1' };
    return true;
  },
};

describe('SignalsController (integration)', () => {
  let app: INestApplication;
  let outcomeService: { logSignal: jest.Mock; getStats: jest.Mock };
  const httpService = { post: jest.fn() };
  const strategy = { id: 's1', name: 'EMA Trend + RSI', rules: {} };
  const asset = { id: 'a1', symbol: 'BTC/USDT', market: { name: 'crypto' } };
  const createdSignal = { id: 'sig1', asset: { symbol: asset.symbol, name: undefined }, strategy: { name: strategy.name } };

  const prismaMock = {
    signal: {
      findMany: jest.fn().mockResolvedValue([createdSignal]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(createdSignal),
    },
    strategy: {
      findFirst: jest.fn().mockResolvedValue(strategy),
      findUnique: jest.fn().mockResolvedValue(strategy),
    },
    asset: {
      findUnique: jest.fn().mockResolvedValue(asset),
    },
    userStrategy: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  beforeAll(async () => {
    outcomeService = {
      logSignal: jest.fn().mockResolvedValue(undefined),
      getStats: jest.fn().mockResolvedValue({ total: 0, winRate: 0 }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, SignalsModule],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(PrismaService)
      .useValue(prismaMock as any)
      .overrideProvider(SignalOutcomeService)
      .useValue(outcomeService as any)
      .overrideProvider(QuotaService)
      .useValue({
        assertSignalQuota: jest.fn().mockResolvedValue({ limit: null, used: 0 }),
        incrementSignalUsage: jest.fn().mockResolvedValue(undefined),
      })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    httpService.post.mockReset();
  });

  it('GET /signals returns paginated signals', async () => {
    await request(app.getHttpServer())
      .get('/signals')
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toEqual([createdSignal]);
        expect(res.body.meta.total).toBe(1);
      });
  });

  it('POST /signals/scan triggers engine scan and persists signals', async () => {
    httpService.post.mockReturnValue(of({
      data: {
        results: [{
          symbol: 'BTC/USDT',
          signal: 'BUY',
          confidence: 65,
          timeframe: '1h',
          entry_price: 100,
          stop_loss: 95,
          take_profit_1: 110,
          take_profit_2: 120,
          risk_reward: 2,
          profile_suitability: ['SWING'],
          indicators: {},
          price_action: {},
          sr_zones: {},
          patterns: {},
          regime: {},
          smc: {},
          explanation: 'test',
          score: 45,
        }],
        portfolio_risk: { exposure: 0.1 },
      },
    }));

    await request(app.getHttpServer())
      .post('/signals/scan')
      .send({ symbols: ['BTC/USDT'], timeframe: '1h' })
      .expect(201)
      .expect((res) => {
        expect(res.body.saved).toHaveLength(1);
        expect(res.body.portfolio_risk).toEqual({ exposure: 0.1 });
      });

    expect(outcomeService.logSignal).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTC/USDT', signal: 'BUY' }),
      'crypto',
    );
  });

  it('POST /signals/scan uses user enabled strategies with customRules', async () => {
    prismaMock.userStrategy.findMany.mockResolvedValue([
      {
        isEnabled: true,
        customRules: { ema_fast: 10 },
        strategy: { id: 'us1', name: 'Custom', rules: { ema_fast: 20 } },
      },
    ]);
    httpService.post.mockReturnValue(of({
      data: { results: [], portfolio_risk: null },
    }));

    await request(app.getHttpServer())
      .post('/signals/scan')
      .send({ symbols: ['BTC/USDT'], timeframe: '1h' })
      .expect(201);

    const payload = httpService.post.mock.calls[0][1];
    expect(payload.strategies).toHaveLength(1);
    expect(payload.strategies[0].rules.ema_fast).toBe(10);
  });

  it('GET /signals/stats returns market stats', async () => {
    await request(app.getHttpServer())
      .get('/signals/stats')
      .expect(200);
  });
});
