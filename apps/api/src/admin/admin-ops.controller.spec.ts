import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { AdminOpsController } from './admin-ops.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SystemHealthService } from '../system-health/system-health.service';
import { ConfigService } from '@nestjs/config';
import { CronConfigService } from './cron-config.service';
import { MaintenanceService } from './maintenance.service';
import { Mt5ReadService } from './mt5-read.service';
import { AutopilotReadService } from './autopilot-read.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '@prisma/client';

describe('AdminOpsController', () => {
  let controller: AdminOpsController;
  let module: TestingModule;
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

    module = await Test.createTestingModule({
      controllers: [AdminOpsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: SystemHealthService, useValue: healthService },
        { provide: AutopilotReadService, useValue: { snapshot: jest.fn().mockResolvedValue({ mode: 'PAPER', readOnly: true, portfolio: null }) } },
        { provide: Mt5ReadService, useValue: { snapshot: jest.fn().mockResolvedValue({ status: 'NOT_CONFIGURED', executionEnabled: false }), activity: jest.fn().mockResolvedValue({ status: 'NOT_CONFIGURED', executionEnabled: false }) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: CronConfigService, useValue: { getAll: jest.fn().mockResolvedValue([]), setEnabled: jest.fn() } },
        { provide: MaintenanceService, useValue: { isMaintenanceMode: jest.fn().mockReturnValue(false), setMaintenanceMode: jest.fn(), isRegistrationEnabled: jest.fn().mockReturnValue(true), setRegistrationEnabled: jest.fn() } },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (ctx: any) => {
        const req = ctx.switchToHttp().getRequest();
        const role = req.headers['x-test-role'];
        if (!role) throw new UnauthorizedException();
        req.user = { id: 'test-user', role };
        return true;
      },
    }).compile();

    controller = module.get(AdminOpsController);
  });

  it('keeps MT5 supervision behind JWT and admin roles', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminOpsController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata('roles', AdminOpsController)).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
    expect(Reflect.getMetadata('roles', AdminOpsController.prototype.mt5)).toBeUndefined();
  });

  it('returns the separate read-only MT5 snapshot', async () => {
    expect(await controller.mt5()).toEqual({ status: 'NOT_CONFIGURED', executionEnabled: false });
  });

  it('protects the AutoPilot endpoint with authentication and the real admin role guard', async () => {
    const app = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/admin/ops/autopilot').expect(401);
      for (const role of ['TRADER', 'INVESTOR', 'unknown']) {
        await request(app.getHttpServer()).get('/admin/ops/autopilot').set('x-test-role', role).expect(403);
      }
      for (const role of ['ADMIN', 'SUPER_ADMIN']) {
        const response = await request(app.getHttpServer()).get('/admin/ops/autopilot').set('x-test-role', role).expect(200);
        expect(response.body).toEqual({ mode: 'PAPER', readOnly: true, portfolio: null });
      }
    } finally { await app.close(); }
  }, 30000);

  it('restricts broker activity to authenticated administrators', async () => {
    const app = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/admin/ops/mt5/activity').expect(401);
      for (const role of ['TRADER', 'INVESTOR']) {
        await request(app.getHttpServer()).get('/admin/ops/mt5/activity').set('x-test-role', role).expect(403);
      }
      for (const role of ['ADMIN', 'SUPER_ADMIN']) {
        const response = await request(app.getHttpServer()).get('/admin/ops/mt5/activity').set('x-test-role', role).expect(200);
        expect(response.body).toEqual({ status: 'NOT_CONFIGURED', executionEnabled: false });
      }
    } finally { await app.close(); }
  }, 30000);

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
