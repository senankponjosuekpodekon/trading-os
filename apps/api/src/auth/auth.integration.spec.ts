import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthController (integration)', () => {
  let app: INestApplication;

  const users: any[] = [];
  const refreshTokens: any[] = [];

  const prismaMock = {
    user: {
      findUnique: jest.fn(async ({ where }: any) =>
        users.find(u => u.email === where.email || u.id === where.id),
      ),
      create: jest.fn(async ({ data }: any) => {
        const user = { id: `u-${users.length + 1}`, isActive: true, ...data };
        users.push(user);
        return user;
      }),
    },
    portfolio: {
      create: jest.fn(async () => ({ id: 'p1' })),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const token = { id: `rt-${refreshTokens.length + 1}`, ...data };
        refreshTokens.push(token);
        return token;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        refreshTokens.find(t => t.tokenHash === where.tokenHash),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        refreshTokens
          .filter(t => {
            if (where.tokenHash) return t.tokenHash === where.tokenHash;
            if (where.userId) return t.userId === where.userId && !t.revokedAt;
            return false;
          })
          .forEach(t => Object.assign(t, data));
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const token = refreshTokens.find(t => t.id === where.id);
        if (token) Object.assign(token, data);
        return token;
      }),
    },
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock as any)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    users.length = 0;
    refreshTokens.length = 0;
    jest.clearAllMocks();
  });

  it('POST /auth/register creates a user and returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'test@example.com', password: 'Password123!', name: 'Test' })
      .expect(201);

    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(prismaMock.portfolio.create).toHaveBeenCalled();
  });

  it('POST /auth/login returns tokens for valid credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'login@example.com', password: 'Password123!', name: 'Test' });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'login@example.com', password: 'Password123!' })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
  });

  it('POST /auth/refresh rotates the refresh token', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'refresh@example.com', password: 'Password123!', name: 'Test' });

    const { refresh_token } = registerRes.body;

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token })
      .expect(200);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.refresh_token).not.toBe(refresh_token);
  });

  it('POST /auth/logout revokes the refresh token', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'logout@example.com', password: 'Password123!', name: 'Test' });

    const { refresh_token } = registerRes.body;

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refresh_token })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token })
      .expect(401);
  });
});
