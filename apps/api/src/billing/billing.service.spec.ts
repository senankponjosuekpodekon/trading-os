import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BillingService', () => {
  let service: BillingService;

  const mockPrisma = {
    plan: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    subscription: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [BillingService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listPlans', () => {
    it('returns only active plans', async () => {
      const plans = [{ id: '1', code: 'FREE', isActive: true }];
      mockPrisma.plan.findMany.mockResolvedValue(plans);

      const result = await service.listPlans();

      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result).toEqual(plans);
    });
  });

  describe('findPlan', () => {
    it('returns the plan when found', async () => {
      const plan = { id: '1', code: 'PRO' };
      mockPrisma.plan.findUnique.mockResolvedValue(plan);

      const result = await service.findPlan('PRO');

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({ where: { code: 'PRO' } });
      expect(result).toEqual(plan);
    });

    it('throws NotFoundException when plan does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.findPlan('UNKNOWN')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPlan', () => {
    it('creates a plan with defaults applied', async () => {
      const dto = { name: 'Pro', code: 'PRO', price: 9.99, interval: 'MONTHLY' } as any;
      const created = { id: '1', ...dto };
      mockPrisma.plan.create.mockResolvedValue(created);

      const result = await service.createPlan(dto);

      expect(mockPrisma.plan.create).toHaveBeenCalledWith({
        data: {
          name: 'Pro',
          code: 'PRO',
          price: 9.99,
          interval: 'MONTHLY',
          maxStrategies: null,
          maxSignals: null,
          maxPortfolios: null,
          features: [],
          isActive: true,
        },
      });
      expect(result).toEqual(created);
    });

    it('honors explicit optional fields when provided', async () => {
      const dto = {
        name: 'Pro',
        code: 'PRO',
        price: 9.99,
        interval: 'MONTHLY',
        maxStrategies: 5,
        maxSignals: 100,
        maxPortfolios: 3,
        features: ['a', 'b'],
        isActive: false,
      } as any;
      mockPrisma.plan.create.mockResolvedValue(dto);

      await service.createPlan(dto);

      expect(mockPrisma.plan.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          maxStrategies: 5,
          maxSignals: 100,
          maxPortfolios: 3,
          features: ['a', 'b'],
          isActive: false,
        }),
      });
    });
  });

  describe('subscribe', () => {
    it('throws NotFoundException when plan code is invalid', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.subscribe('user-1', 'INVALID')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('cancels existing active/trial subscriptions and creates a new trial', async () => {
      const plan = { id: 'plan-1', code: 'PRO' };
      mockPrisma.plan.findUnique.mockResolvedValue(plan);
      mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
      const created = { id: 'sub-1', userId: 'user-1', planId: 'plan-1', status: 'TRIAL', plan };
      mockPrisma.subscription.create.mockResolvedValue(created);

      const result = await service.subscribe('user-1', 'PRO', 14);

      expect(mockPrisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: { in: ['ACTIVE', 'TRIAL'] } },
        data: { status: 'CANCELLED' },
      });
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            planId: 'plan-1',
            status: 'TRIAL',
          }),
          include: { plan: true },
        }),
      );
      expect(result).toEqual(created);
    });

    it('sets currentPeriodEnd trialDays after currentPeriodStart', async () => {
      const plan = { id: 'plan-1', code: 'PRO' };
      mockPrisma.plan.findUnique.mockResolvedValue(plan);
      mockPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.subscription.create.mockImplementation(({ data }: any) => Promise.resolve(data));

      const result: any = await service.subscribe('user-1', 'PRO', 7);

      const diffMs = result.currentPeriodEnd.getTime() - result.currentPeriodStart.getTime();
      expect(Math.round(diffMs / (1000 * 60 * 60 * 24))).toBe(7);
    });
  });

  describe('getActiveSubscription', () => {
    it('queries for active/trial subscriptions ordered by most recent', async () => {
      const sub = { id: 'sub-1', status: 'ACTIVE' };
      mockPrisma.subscription.findFirst.mockResolvedValue(sub);

      const result = await service.getActiveSubscription('user-1');

      expect(mockPrisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: { in: ['ACTIVE', 'TRIAL'] } },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      });
      expect(result).toEqual(sub);
    });
  });

  describe('cancel', () => {
    it('throws BadRequestException when there is no active subscription', async () => {
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancel('user-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('cancels the active subscription', async () => {
      const active = { id: 'sub-1', status: 'ACTIVE' };
      mockPrisma.subscription.findFirst.mockResolvedValue(active);
      const cancelled = { ...active, status: 'CANCELLED' };
      mockPrisma.subscription.update.mockResolvedValue(cancelled);

      const result = await service.cancel('user-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED' },
      });
      expect(result).toEqual(cancelled);
    });
  });
});
