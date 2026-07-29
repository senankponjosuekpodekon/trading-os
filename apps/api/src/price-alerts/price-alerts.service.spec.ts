import { Test, TestingModule } from '@nestjs/testing';
import { PriceAlertsService } from './price-alerts.service';
import { PrismaService, PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('PriceAlertsService', () => {
  let service: PriceAlertsService;

  const mockPrisma = {
    priceAlert: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = {
    push: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceAlertsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PrismaSystemService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PriceAlertsService>(PriceAlertsService);
    jest.clearAllMocks();
  });

  it('creates an alert', async () => {
    mockPrisma.priceAlert.create.mockResolvedValue({ id: 'a1' });

    const result = await service.create('u1', {
      assetSymbol: 'BTC/USDT',
      direction: 'above',
      targetPrice: 70_000,
    });

    expect(result.id).toBe('a1');
    expect(mockPrisma.priceAlert.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        assetSymbol: 'BTC/USDT',
        direction: 'above',
        targetPrice: 70_000,
      },
    });
  });

  it('notifies when price goes above target', async () => {
    mockPrisma.priceAlert.findMany.mockResolvedValue([
      { id: 'a1', userId: 'u1', assetSymbol: 'BTC/USDT', direction: 'above', targetPrice: '69000' },
    ]);

    await service.checkAlerts({ 'BTC/USDT': 70_000 });

    expect(mockPrisma.priceAlert.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { triggered: true, triggeredAt: expect.any(Date) },
    });
    expect(mockNotifications.push).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ALERT', title: expect.stringContaining('BTC/USDT') }),
    );
  });

  it('notifies when price goes below target', async () => {
    mockPrisma.priceAlert.findMany.mockResolvedValue([
      { id: 'a2', userId: 'u1', assetSymbol: 'ETH/USDT', direction: 'below', targetPrice: '3000' },
    ]);

    await service.checkAlerts({ 'ETH/USDT': 2_900 });

    expect(mockPrisma.priceAlert.update).toHaveBeenCalled();
    expect(mockNotifications.push).toHaveBeenCalled();
  });

  it('does nothing when target is not hit', async () => {
    mockPrisma.priceAlert.findMany.mockResolvedValue([
      { id: 'a3', userId: 'u1', assetSymbol: 'BTC/USDT', direction: 'above', targetPrice: '80000' },
    ]);

    await service.checkAlerts({ 'BTC/USDT': 70_000 });

    expect(mockPrisma.priceAlert.update).not.toHaveBeenCalled();
    expect(mockNotifications.push).not.toHaveBeenCalled();
  });

  it('removes an alert', async () => {
    mockPrisma.priceAlert.findFirst.mockResolvedValue({ id: 'a1' });
    mockPrisma.priceAlert.delete.mockResolvedValue({});

    await service.remove('u1', 'a1');

    expect(mockPrisma.priceAlert.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });
});
