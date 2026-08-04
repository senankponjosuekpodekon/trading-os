import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { NotificationsModule } from './notifications.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AlertService } from './alert.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const fakeGuard: CanActivate = {
  canActivate: (context: ExecutionContext) => {
    context.switchToHttp().getRequest().user = { id: 'user-1' };
    return true;
  },
};

const mockPrismaService = {
  notificationPreference: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: '1', userId: 'user-1' }),
    upsert: jest.fn().mockResolvedValue({ id: '1', userId: 'user-1' }),
  },
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  priceAlert: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('NotificationsController', () => {
  let app: INestApplication;
  let service: NotificationsService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        AlertService,
        NotificationPreferenceService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();

    app = moduleRef.createNestApplication();
    service = moduleRef.get<NotificationsService>(NotificationsService);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    // reset internal store by creating a fresh service instance via reflection
    (service as any).store.clear();
  });

  it('GET /notifications returns recent notifications for the user', async () => {
    service.push({ userId: 'user-1', type: 'SIGNAL', title: 'BTC BUY', message: 'test' });
    service.push({ userId: 'user-2', type: 'ALERT', title: 'secret', message: 'test' });

    await request(app.getHttpServer())
      .get('/notifications')
      .expect(200)
      .expect((res) => {
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('BTC BUY');
      });
  });

});
