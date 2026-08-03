import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';

describe('QuotaService', () => {
  let service: QuotaService;

  const mockPrisma = {
    portfolio: { count: jest.fn() },
    userStrategy: { count: jest.fn() },
    signalDailyUsage: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;

  const mockBilling = {
    getActiveSubscription: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BillingService, useValue: mockBilling },
      ],
    }).compile();
    service = module.get<QuotaService>(QuotaService);
    jest.clearAllMocks();
  });

  it('enforces portfolio limit for free tier without subscription', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue(null);
    mockPrisma.portfolio.count.mockResolvedValue(1);
    await expect(service.assertCanCreatePortfolio('u1')).rejects.toThrow(ForbiddenException);
  });

  it('allows portfolio creation when plan has no limit', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({ plan: { name: 'Pro', maxPortfolios: null } });
    await expect(service.assertCanCreatePortfolio('u1')).resolves.toBeUndefined();
  });

  it('allows portfolio creation under the plan limit', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({ plan: { name: 'Basic', maxPortfolios: 2 } });
    mockPrisma.portfolio.count.mockResolvedValue(1);
    await expect(service.assertCanCreatePortfolio('u1')).resolves.toBeUndefined();
  });

  it('blocks portfolio creation at the plan limit', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({ plan: { name: 'Basic', maxPortfolios: 2 } });
    mockPrisma.portfolio.count.mockResolvedValue(2);
    await expect(service.assertCanCreatePortfolio('u1')).rejects.toThrow(ForbiddenException);
  });

  it('blocks strategy activation at the plan limit', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({ plan: { name: 'Basic', maxStrategies: 3 } });
    mockPrisma.userStrategy.count.mockResolvedValue(3);
    await expect(service.assertCanEnableStrategy('u1')).rejects.toThrow(ForbiddenException);
  });

  it('returns usage with plan limits and signal usage', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({
      plan: { name: 'Basic', code: 'basic', maxPortfolios: 2, maxStrategies: 3, maxSignals: 50 },
    });
    mockPrisma.portfolio.count.mockResolvedValue(1);
    mockPrisma.userStrategy.count.mockResolvedValue(2);
    mockPrisma.signalDailyUsage.findUnique.mockResolvedValue({ signalsUsed: 5 });
    const usage = await service.getUsage('u1');
    expect(usage.plan?.code).toBe('basic');
    expect(usage.portfolios).toEqual({ used: 1, limit: 2 });
    expect(usage.strategies).toEqual({ used: 2, limit: 3 });
    expect(usage.signals).toEqual({ used: 5, limit: 50 });
  });

  it('returns usage with free tier limits when no subscription', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue(null);
    mockPrisma.portfolio.count.mockResolvedValue(0);
    mockPrisma.userStrategy.count.mockResolvedValue(0);
    mockPrisma.signalDailyUsage.findUnique.mockResolvedValue(null);
    const usage = await service.getUsage('u1');
    expect(usage.plan?.code).toBe('FREE');
    expect(usage.portfolios.limit).toBe(1);
    expect(usage.signals.limit).toBe(5);
  });

  it('enforces signal quota and increments usage atomically', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({
      plan: { name: 'Pro', code: 'pro', maxSignals: 2 },
    });
    mockPrisma.signalDailyUsage.findUnique.mockResolvedValue({ signalsUsed: 1 });
    await expect(service.assertSignalQuota('u1')).resolves.toEqual({ limit: 2, used: 1 });
    mockPrisma.signalDailyUsage.updateMany.mockResolvedValue({ count: 1 });
    await service.incrementSignalUsage('u1', 1);
    expect(mockPrisma.signalDailyUsage.updateMany).toHaveBeenCalled();
  });

  it('blocks signal quota when exhausted', async () => {
    mockBilling.getActiveSubscription.mockResolvedValue({ plan: { name: 'Pro', maxSignals: 1 } });
    mockPrisma.signalDailyUsage.findUnique.mockResolvedValue({ signalsUsed: 1 });
    await expect(service.assertSignalQuota('u1')).rejects.toThrow(ForbiddenException);
  });
});
