import { Test } from '@nestjs/testing';
import { AdminUsersController } from './admin-users.controller';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: '1', email: 'a@test.com', name: 'A', role: 'TRADER', isActive: true, timezone: 'UTC', createdAt: new Date(), _count: { portfolios: 1, strategies: 0 } },
        ]),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue({ id: '1', email: 'a@test.com', name: 'A', role: 'ADMIN', isActive: true }),
      },
      notificationPreference: {
        upsert: jest.fn().mockResolvedValue({ userId: '1', pushEnabled: true }),
      },
    };

    const module = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    controller = module.get(AdminUsersController);
  });

  it('should list users with pagination', async () => {
    const result = await controller.findAll('1', '20');
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });

  it('should list users with search', async () => {
    await controller.findAll('1', '20', 'test');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: expect.any(Array) },
    }));
  });

  it('should update user role', async () => {
    const result = await controller.update('1', { role: 'ADMIN' });
    expect(result.role).toBe('ADMIN');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '1' },
      data: { role: 'ADMIN' },
    }));
  });

  it('should update user isActive', async () => {
    await controller.update('1', { isActive: false });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: false },
    }));
  });

  it('should update notification preferences', async () => {
    const result = await controller.updateNotifications('1', { telegramEnabled: true });
    expect(result.updated).toBe(true);
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: '1' },
      update: { telegramEnabled: true },
      create: { userId: '1', telegramEnabled: true },
    }));
  });

  it('should clear push subscription when disabling push', async () => {
    await controller.updateNotifications('1', { pushEnabled: false });
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ pushEnabled: false }),
    }));
    const call = prisma.notificationPreference.upsert.mock.calls[0][0];
    expect(call.update.pushSubscription).toBe(Prisma.DbNull);
  });

  it('should clamp minConfidence to 0-100', async () => {
    await controller.updateNotifications('1', { minConfidence: 150 });
    const call = prisma.notificationPreference.upsert.mock.calls[0][0];
    expect(call.update.minConfidence).toBe(100);
  });

  it('should reject empty notification body', async () => {
    const result = await controller.updateNotifications('1', {});
    expect(result.updated).toBe(false);
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('should return user stats', async () => {
    prisma.user.groupBy = jest.fn().mockResolvedValue([{ role: 'TRADER', _count: 5 }]);
    const result = await controller.stats();
    expect(result.total).toBe(1);
    expect(result.byRole.TRADER).toBe(5);
  });
});
