import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrisma } from '../test/prisma.mock';

describe('AuditService', () => {
  let service: AuditService;
  const mockPrisma = createMockPrisma();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<AuditService>(AuditService);
  });

  it('should create an audit log', async () => {
    await service.log({ userId: 'u1', action: 'LOGIN', resource: 'auth', details: { email: 'test@example.com' } });
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('should find user audit logs with pagination', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ id: 'a1', action: 'LOGIN' }]);
    mockPrisma.auditLog.count.mockResolvedValue(1);
    const result = await service.findByUser('u1', { page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });
});
