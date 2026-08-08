import { Test } from '@nestjs/testing';
import { AdminUsersController } from './admin-users.controller';
import { PrismaService } from '../prisma/prisma.service';

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

  it('should return user stats', async () => {
    prisma.user.groupBy = jest.fn().mockResolvedValue([{ role: 'TRADER', _count: 5 }]);
    const result = await controller.stats();
    expect(result.total).toBe(1);
    expect(result.byRole.TRADER).toBe(5);
  });
});
