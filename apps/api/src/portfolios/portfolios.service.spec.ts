import { Test, TestingModule } from '@nestjs/testing';
import { PortfoliosService } from './portfolios.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';
import { ConfigService } from '@nestjs/config';

describe('PortfoliosService', () => {
  let service: PortfoliosService;

  const mockPrisma = {
    portfolio: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', userId: 'u1', name: 'Default', positions: [{ id: 'pos1', status: 'OPEN' }] },
      ]),
      create: jest.fn().mockResolvedValue({ id: 'p2', userId: 'u1', name: 'Swing', type: 'PAPER' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', type: 'PAPER', currentCapital: '10000' }),
    },
    position: { findMany: jest.fn().mockResolvedValue([{ id: 'pos1' }]) },
    $queryRaw: jest.fn().mockResolvedValue([{ equity: 10000 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuotaService, useValue: { assertCanCreatePortfolio: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://engine:8000') } },
      ],
    }).compile();

    service = module.get<PortfoliosService>(PortfoliosService);
  });

  it('returns portfolios with open positions for a user', async () => {
    const result = await service.findByUser('u1');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('u1');
    expect(result[0].positions).toHaveLength(1);
    expect(mockPrisma.portfolio.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      include: { positions: { where: { status: 'OPEN' } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('creates a new portfolio for a user', async () => {
    const result = await service.create('u1', { name: 'Swing', type: 'PAPER', initialCapital: 5000 });
    expect(result.id).toBe('p2');
    expect(mockPrisma.portfolio.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        name: 'Swing',
        type: 'PAPER',
        currency: 'USD',
        initialCapital: 5000,
        currentCapital: 5000,
      },
    });
  });

  it('state() falls back to a degraded snapshot when the engine is down', async () => {
    const result = await service.state('u1', 'p1');
    expect(result.portfolio_id).toBe('p1');
    expect(result.stale).toBe(true);
    expect(result.equity).toBe(10000);
    expect(result.n_positions).toBe(1);
  });

  it('state() throws NotFoundException for a foreign portfolio', async () => {
    mockPrisma.portfolio.findFirst.mockResolvedValueOnce(null);
    await expect(service.state('u1', 'other')).rejects.toThrow('Portfolio not found');
  });

  it('snapshots() and ledger() query the raw tables', async () => {
    expect(await service.snapshots('u1', 'p1')).toEqual([{ equity: 10000 }]);
    expect(await service.ledger('u1', 'p1')).toEqual([{ equity: 10000 }]);
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('execConfig() merges the db row and a null engine status', async () => {
    const result = await service.execConfig();
    expect(result.db).toEqual({ equity: 10000 });
    expect(result.engine).toBeNull();
  });

  it('updateExecConfig() rejects an invalid mode', async () => {
    await expect(service.updateExecConfig('u1', { mode: 'yolo' })).rejects.toThrow('mode invalide');
  });

  it('updateExecConfig() writes and returns merged config', async () => {
    const result = await service.updateExecConfig('u1', { mode: 'paper', live_venues: ['margin'], gate_fail_closed: true });
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(result.db).toBeDefined();
  });
});
