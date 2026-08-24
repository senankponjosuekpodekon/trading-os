import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService, PrismaSystemService } from '../src/prisma/prisma.service';
import { PositionsModule } from '../src/positions/positions.module';
import { logger } from '../src/common/logger';

describe('PositionsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connected = false;
  const testEmail = `e2e-positions-${Date.now()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e_test_secret';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, PositionsModule],
    })
      .overrideProvider(PrismaSystemService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    try {
      await prisma.$connect();
      connected = true;
    } catch {
      connected = false;
    }
    await app.init();
  });

  afterAll(async () => {
    if (connected) {
      try {
        await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
      } catch (e: any) {
        logger.warn(`E2E cleanup failed: ${e?.message}`);
      }
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  async function getToken() {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: testEmail, password, name: 'E2E Positions' })
      .expect(201);
    return res.body.access_token;
  }

  it('GET /positions should be protected', async () => {
    await request(app.getHttpServer()).get('/positions').expect(401);
  });

  it('GET /positions should 404 for missing portfolio', async () => {
    if (!connected) {
      logger.info('Skipping Positions e2e test: database not available');
      return;
    }
    const token = await getToken();
    await request(app.getHttpServer())
      .get('/positions?portfolioId=nonexistent')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /positions/summary should return empty for a new user', async () => {
    if (!connected) {
      logger.info('Skipping Positions e2e test: database not available');
      return;
    }
    const token = await getToken();
    const res = await request(app.getHttpServer())
      .get('/positions/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty('open');
  });

  it('POST /positions should reject unknown asset', async () => {
    if (!connected) {
      logger.info('Skipping Positions e2e test: database not available');
      return;
    }
    const token = await getToken();
    await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        portfolioId: 'nonexistent',
        assetSymbol: 'UNKNOWN/USD',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 1,
      })
      .expect(404);
  });
});
