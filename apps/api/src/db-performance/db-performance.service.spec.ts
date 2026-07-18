import { Test, TestingModule } from '@nestjs/testing';
import { DbPerformanceService } from './db-performance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DbPerformanceService', () => {
  let service: DbPerformanceService;

  const mockPrisma = {
    $queryRawUnsafe: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbPerformanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DbPerformanceService>(DbPerformanceService);
    jest.clearAllMocks();
  });

  it('should detect sequential scan warning', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { 'QUERY PLAN': JSON.stringify([{ 'Plan': { 'Node Type': 'Seq Scan' }, 'Execution Time': 12.5 }]) },
    ]);

    const result = await service.analyze();

    const positions = result.results.find(r => r.name === 'positions_by_portfolio_status');
    expect(positions).toBeDefined();
    expect(positions!.warnings).toContain('Sequential scan detected — consider adding an index');
    expect(positions!.executionTimeMs).toBe(12.5);
  });

  it('should detect slow query warning', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      { 'QUERY PLAN': JSON.stringify([{ 'Plan': { 'Node Type': 'Index Scan' }, 'Execution Time': 120.0 }]) },
    ]);

    const result = await service.analyze();

    expect(result.results[0].warnings.some(w => w.startsWith('Slow query'))).toBe(true);
  });

  it('should handle explain failure gracefully', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('relation does not exist'));

    const result = await service.analyze();

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].warnings[0]).toContain('Failed');
  });
});
