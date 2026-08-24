import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService, PrismaSystemService } from '../src/prisma/prisma.service';
import { logger } from '../src/common/logger';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let connected = false;
  const testEmail = `e2e-auth-${Date.now()}@example.com`;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e_test_secret';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
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
        await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-auth-' } } });
      } catch (e: any) {
        logger.warn(`E2E cleanup failed: ${e?.message}`);
      }
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  it('POST /auth/register should create a real user and return tokens', async () => {
    if (!connected) {
      logger.info('Skipping Auth e2e test: database not available');
      return;
    }

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: testEmail, password: 'Password123!', name: 'E2E Test' })
      .expect(201);

    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user).not.toBeNull();
  });

  it('POST /auth/login should return tokens for the registered user', async () => {
    if (!connected) {
      logger.info('Skipping Auth e2e test: database not available');
      return;
    }

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: 'Password123!' })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
  });
});
