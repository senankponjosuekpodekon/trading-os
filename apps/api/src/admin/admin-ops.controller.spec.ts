import { Test } from '@nestjs/testing';
import { AdminOpsController } from './admin-ops.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { ConfigService } from '@nestjs/config';

describe('AdminOpsController', () => {
  let controller: AdminOpsController;
  let prisma: any;
  let healthService: any;

  beforeEach(async () => {
    prisma = {
      user: { count: jest.fn().mockResolvedValue(10) },
      asset: { count: jest.fn().mockResolvedValue(50) },
      strategy: { count: jest.fn().mockResolvedValue(5) },
      signal: {
        count: jest.fn().mockResolvedValue(100),
        groupBy: jest.fn().mockResolvedValue([{ signal: 'BUY', _count: 60 }]),
      },
      position: { count: jest.fn().mockResolvedValue(15) },
      signalLog: { count: jest.fn().mockResolvedValue(500) },
      signalFeature: { count: jest.fn().mockResolvedValue(200) },
      portfolio: { count: jest.fn().mockResolvedValue(8) },
    };

    healthService = {
      getCronStatus: jest.fn().mockResolvedValue({ scan: { lastRun: '2026-01-01', lastStatus: 'success' } }),
    };

    const module = await Test.createTestingModule({
      controllers: [AdminOpsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: SystemHealthService, useValue: healthService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();

    controller = module.get(AdminOpsController);
  });

  it('should return db stats', async () => {
    const result = await controller.dbStats();
    expect(result.users).toBe(10);
    expect(result.assets).toBe(50);
    expect(result.signals).toBe(100);
    expect(result.timestamp).toBeDefined();
  });

  it('should return 24h signal stats', async () => {
    const result = await controller.signals24h();
    expect(result.total).toBe(100);
    expect(result.byDirection.BUY).toBe(60);
  });

  it('should return cron health', async () => {
    const result = await controller.health();
    expect(result.scan).toBeDefined();
    expect(result.scan.lastStatus).toBe('success');
  });
});
