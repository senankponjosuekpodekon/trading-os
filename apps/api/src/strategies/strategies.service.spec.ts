import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';

describe('StrategiesService', () => {
  let service: StrategiesService;

  const prismaMock = {
    strategy: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    userStrategy: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategiesService,
        { provide: PrismaService, useValue: prismaMock as any },
        { provide: QuotaService, useValue: { assertCanEnableStrategy: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<StrategiesService>(StrategiesService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns all strategies ordered by createdAt desc', async () => {
      prismaMock.strategy.findMany.mockResolvedValue([{ id: '1', name: 'Test' }]);
      const result = await service.findAll();
      expect(prismaMock.strategy.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
      expect(result).toEqual([{ id: '1', name: 'Test' }]);
    });
  });

  describe('create', () => {
    it('creates a strategy with the provided DTO', async () => {
      const dto = { name: 'EMA Strategy', description: '', rules: { ema_fast: 20 }, isActive: true } as any;
      prismaMock.strategy.create.mockResolvedValue({ id: 's1', ...dto });
      const result = await service.create(dto);
      expect(prismaMock.strategy.create).toHaveBeenCalledWith({ data: dto });
      expect(result.id).toBe('s1');
    });
  });

  describe('findOne', () => {
    it('returns the strategy when it exists', async () => {
      prismaMock.strategy.findUnique.mockResolvedValue({ id: 's1', name: 'Test' });
      const result = await service.findOne('s1');
      expect(result).toEqual({ id: 's1', name: 'Test' });
    });

    it('throws NotFoundException when strategy is missing', async () => {
      prismaMock.strategy.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('returns total and active strategy counts', async () => {
      prismaMock.strategy.count.mockResolvedValueOnce(10).mockResolvedValueOnce(3);
      const result = await service.getStats();
      expect(result).toEqual({ total: 10, active: 3 });
    });
  });
});
