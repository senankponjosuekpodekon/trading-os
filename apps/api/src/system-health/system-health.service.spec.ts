import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { SystemHealthService } from './system-health.service';
import { PrismaSystemService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EngineHttpService } from '../engine/engine-http.service';

describe('SystemHealthService', () => {
  let service: SystemHealthService;
  let httpService: HttpService;
  let prismaSystem: any;
  let notifications: any;

  beforeEach(async () => {
    prismaSystem = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      asset: { count: jest.fn().mockResolvedValue(28) },
      strategy: { count: jest.fn().mockResolvedValue(1) },
      signal: { count: jest.fn().mockResolvedValue(5) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin1', email: 'admin@example.com', name: 'Super Admin' }]) },
    };

    notifications = {
      push: jest.fn().mockReturnValue({ id: 'notif-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        SystemHealthService,
        { provide: PrismaSystemService, useValue: prismaSystem },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:8000') },
        },
        { provide: EngineHttpService, useValue: { getCircuitState: jest.fn().mockReturnValue('CLOSED'), resetCircuit: jest.fn() } },
      ],
    }).compile();

    service = module.get<SystemHealthService>(SystemHealthService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe('getHealthSummary', () => {
    it('returns ok when all checks pass', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } } as any),
      );

      const result = await service.getHealthSummary();

      expect(result.status).toBe('ok');
      expect(result.checks).toHaveLength(4);
      expect(result.checks.every((c) => c.status === 'ok')).toBe(true);
    });

    it('returns critical when engine is unreachable', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => new Error('ECONNREFUSED')) as any,
      );

      const result = await service.getHealthSummary();

      const engineCheck = result.checks.find((c) => c.name === 'engine');
      expect(engineCheck?.status).toBe('critical');
      expect(result.status).toBe('critical');
    });

    it('returns critical when database is unreachable', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } } as any),
      );
      prismaSystem.$queryRaw.mockRejectedValue(new Error('Connection refused'));

      const result = await service.getHealthSummary();

      const dbCheck = result.checks.find((c) => c.name === 'database');
      expect(dbCheck?.status).toBe('critical');
    });

    it('returns critical when no active assets (seed missing)', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } } as any),
      );
      prismaSystem.asset.count.mockResolvedValue(0);
      prismaSystem.strategy.count.mockResolvedValue(0);

      const result = await service.getHealthSummary();

      const seedCheck = result.checks.find((c) => c.name === 'seed');
      expect(seedCheck?.status).toBe('critical');
      expect(seedCheck?.message).toContain('seed was never run');
    });

    it('returns warning when no recent signals', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } } as any),
      );
      prismaSystem.signal.count.mockResolvedValue(0);

      const result = await service.getHealthSummary();

      const signalCheck = result.checks.find((c) => c.name === 'signals');
      expect(signalCheck?.status).toBe('warning');
    });
  });

  describe('runHealthChecks (cron)', () => {
    it('alerts super admins when critical issues found', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => new Error('ECONNREFUSED')) as any,
      );

      await service.runHealthChecks();

      expect(prismaSystem.user.findMany).toHaveBeenCalledWith({
        where: { role: 'SUPER_ADMIN', isActive: true },
        select: { id: true, email: true, name: true },
      });
      expect(notifications.push).toHaveBeenCalled();
      const call = notifications.push.mock.calls[0][0];
      expect(call.type).toBe('SYSTEM');
      expect(call.userId).toBe('admin1');
      expect(call.title).toContain('critical');
    });

    it('does not alert when all checks pass', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } } as any),
      );

      await service.runHealthChecks();

      expect(notifications.push).not.toHaveBeenCalled();
    });

    it('logs error when no super admin exists', async () => {
      jest.spyOn(httpService, 'get').mockReturnValue(
        throwError(() => new Error('ECONNREFUSED')) as any,
      );
      prismaSystem.user.findMany.mockResolvedValue([]);

      await service.runHealthChecks();

      expect(notifications.push).not.toHaveBeenCalled();
    });
  });
});
