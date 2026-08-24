import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService, PrismaSystemService } from '../src/prisma/prisma.service';
import { SignalsModule } from '../src/signals/signals.module';
import { logger } from '../src/common/logger';

describe('SignalsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connected = false;
  const testEmail = `e2e-signals-${Date.now()}@example.com`;
  const password = 'Password123!';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e_test_secret';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, SignalsModule],
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
      .send({ email: testEmail, password, name: 'E2E Signals' })
      .expect(201);
    return res.body.access_token;
  }

  it('GET /signals should be protected', async () => {
    await request(app.getHttpServer()).get('/signals').expect(401);
  });

  it('GET /signals should return data for authenticated user', async () => {
    if (!connected) {
      logger.info('Skipping Signals e2e test: database not available');
      return;
    }
    const token = await getToken();
    const res = await request(app.getHttpServer())
      .get('/signals')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /signals/scan-history/db should be accessible', async () => {
    if (!connected) {
      logger.info('Skipping Signals e2e test: database not available');
      return;
    }
    const token = await getToken();
    const res = await request(app.getHttpServer())
      .get('/signals/scan-history/db')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveProperty('data');
  });
});
