import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import * as request from 'supertest';
import { BacktestModule } from './backtest.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const fakeGuard: CanActivate = {
  canActivate: (context: ExecutionContext) => {
    context.switchToHttp().getRequest().user = { id: 'user-1' };
    return true;
  },
};

describe('BacktestController (integration)', () => {
  let app: INestApplication;
  const httpService = {
    post: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BacktestModule],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(PrismaService)
      .useValue({
        strategy: { findFirst: jest.fn().mockResolvedValue({ id: 's1', name: 'Test', rules: {} }) },
      } as any)
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

  it('POST /backtest/run forwards payload to engine and returns result', async () => {
    httpService.post.mockReturnValue(of({ data: { id: 'bt1', total_pnl: 123.45 } }));
    const dto = {
      symbol: 'BTC/USDT',
      timeframe: '1h',
      strategy: { name: 'EMA', rules: { ema_fast: 20 } },
      start: '2024-01-01',
      end: '2024-01-31',
    };
    await request(app.getHttpServer())
      .post('/backtest/run')
      .send(dto)
      .expect(201)
      .expect({ id: 'bt1', total_pnl: 123.45 });
    expect(httpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/backtest/run'),
      expect.objectContaining({ symbol: 'BTC/USDT' }),
    );
  });

  it('POST /backtest/multi forwards multiple payloads to engine', async () => {
    httpService.post.mockReturnValue(of({ data: { results: [{ total_pnl: 10 }, { total_pnl: -5 }] } }));
    const dtos = [
      { symbol: 'BTC/USDT', timeframe: '1h', strategy: { name: 'A' }, start: '2024-01-01', end: '2024-01-31' },
      { symbol: 'ETH/USDT', timeframe: '4h', strategy: { name: 'B' }, start: '2024-01-01', end: '2024-01-31' },
    ];
    await request(app.getHttpServer())
      .post('/backtest/multi')
      .send(dtos)
      .expect(201)
      .expect({ results: [{ total_pnl: 10 }, { total_pnl: -5 }] });
  });
});
