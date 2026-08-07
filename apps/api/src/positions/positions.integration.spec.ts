import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as request from 'supertest';
import { PositionsModule } from './positions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const fakeGuard: CanActivate = {
  canActivate: (context: ExecutionContext) => {
    context.switchToHttp().getRequest().user = { id: 'user-1' };
    return true;
  },
};

describe('PositionsController (integration)', () => {
  let app: INestApplication;
  const httpService = { get: jest.fn() };
  const portfolio = { id: 'p1', userId: 'user-1', currentCapital: 10000 };
  const asset = { id: 'a1', symbol: 'BTC/USDT' };
  const position = {
    id: 'pos1',
    portfolioId: 'p1',
    assetId: 'a1',
    direction: 'BUY',
    entryPrice: 100,
    quantity: 1,
    status: 'OPEN',
    stopLoss: 95,
    takeProfit: 110,
    pnl: 0,
    asset: { symbol: 'BTC/USDT' },
  };

  const prismaMock = {
    portfolio: {
      findFirst: jest.fn().mockResolvedValue(portfolio),
      update: jest.fn().mockResolvedValue({}),
    },
    asset: { findUnique: jest.fn().mockResolvedValue(asset) },
    position: {
      findFirst: jest.fn().mockResolvedValue(position),
      findMany: jest.fn().mockResolvedValue([position]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockResolvedValue(position),
      update: jest.fn().mockResolvedValue({ ...position, status: 'CLOSED' }),
    },
    $transaction: jest.fn((ops: any) =>
      typeof ops === 'function' ? ops(prismaMock) : Promise.all(ops),
    ),
    $executeRaw: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, PositionsModule],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(PrismaService)
      .useValue(prismaMock as any)
      .overrideProvider(PrismaSystemService)
      .useValue(prismaMock as any)
      .overrideProvider(NotificationsService)
      .useValue({ send: jest.fn() } as any)
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    httpService.get.mockReset();
  });

  it('GET /positions returns positions for portfolio', async () => {
    await request(app.getHttpServer())
      .get('/positions?portfolioId=p1')
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.meta.total).toBe(1);
      });
  });

  it('POST /positions creates a position', async () => {
    prismaMock.position.findFirst.mockResolvedValue(null);
    const dto = {
      portfolioId: 'p1',
      assetSymbol: 'BTC/USDT',
      direction: 'BUY',
      entryPrice: 100,
      quantity: 1,
      stopLoss: 95,
      takeProfit: 110,
    };
    await request(app.getHttpServer())
      .post('/positions')
      .send(dto)
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe('pos1');
      });
  });

  it('PATCH /positions/:id/close closes a position', async () => {
    prismaMock.position.findFirst.mockResolvedValue(position);
    await request(app.getHttpServer())
      .patch('/positions/pos1/close')
      .send({ exitPrice: 110 })
      .expect(200)
      .expect((res) => {
        expect(res.body.pnl).toBe('10.00');
      });
  });
});
