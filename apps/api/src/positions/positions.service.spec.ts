import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PositionsService } from './positions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('PositionsService', () => {
  let service: PositionsService;

  const mockPrisma = {
    portfolio: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    asset: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(async (ops: any) => {
      const results: any[] = [];
      for (const op of Array.isArray(ops) ? ops : []) results.push(await op);
      return results;
    }),
    position: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockHttp = {
    get: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn(),
  };

  const mockNotifications = {
    push: jest.fn(),
    pushGlobal: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: HttpService, useValue: mockHttp },
        { provide: ConfigService, useValue: mockConfig },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PositionsService>(PositionsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a position and decrement capital', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 10000 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });
      mockPrisma.position.create.mockResolvedValue({ id: 'pos1' });

      const result = await service.create('u1', {
        portfolioId: 'p1',
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: 100,
        quantity: 10,
      } as any);

      expect(result.id).toBe('pos1');
      expect(mockPrisma.portfolio.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException if insufficient capital', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1', currentCapital: 50 });
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'a1' });

      await expect(
        service.create('u1', {
          portfolioId: 'p1',
          assetSymbol: 'BTC/USDT',
          direction: 'BUY',
          entryPrice: 100,
          quantity: 10,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByPortfolio', () => {
    it('should return paginated positions', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.position.findMany.mockResolvedValue([{ id: 'pos1' }]);
      mockPrisma.position.count.mockResolvedValue(1);

      const result = await service.findByPortfolio('u1', 'p1', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should throw NotFoundException for unknown portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);

      await expect(
        service.findByPortfolio('u1', 'p1', { page: 1, limit: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
