import { Test, TestingModule } from '@nestjs/testing';
import { PortfoliosService } from './portfolios.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../billing/quota.service';

describe('PortfoliosService', () => {
  let service: PortfoliosService;

  const mockPrisma = {
    portfolio: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', userId: 'u1', name: 'Default', positions: [{ id: 'pos1', status: 'OPEN' }] },
      ]),
      create: jest.fn().mockResolvedValue({ id: 'p2', userId: 'u1', name: 'Swing', type: 'PAPER' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfoliosService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuotaService, useValue: { assertCanCreatePortfolio: jest.fn().mockResolvedValue(undefined) } },
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
});
