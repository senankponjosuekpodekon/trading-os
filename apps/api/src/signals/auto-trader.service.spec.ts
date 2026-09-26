import { AutoTraderService } from './auto-trader.service';

const AUTOPILOT_PORTFOLIO_ID = 'ap-portfolio';

const mockPrisma = {
  user: {
    findUnique: jest.fn().mockResolvedValue({ id: 'ap-user' }),
    create: jest.fn(),
  },
  portfolio: {
    findFirst: jest.fn().mockResolvedValue({ id: AUTOPILOT_PORTFOLIO_ID, currentCapital: 10_000, initialCapital: 10_000 }),
    create: jest.fn(),
    update: jest.fn(),
  },
  position: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
};

const mockFlags = { getFlag: jest.fn().mockResolvedValue(true), setFlag: jest.fn() };
const mockConfig = { get: jest.fn((_k: string, d: any) => d) };

describe('AutoTraderService — isolation portfolio', () => {
  let service: AutoTraderService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.getFlag.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'ap-user' });
    mockPrisma.portfolio.findFirst.mockResolvedValue({ id: AUTOPILOT_PORTFOLIO_ID, currentCapital: 10_000, initialCapital: 10_000 });
    mockPrisma.position.findMany.mockResolvedValue([]);
    service = new AutoTraderService(mockPrisma as any, mockFlags as any, mockConfig as any);
  });

  it('partialClose filtre par portfolioId AutoPilot (pas de touch aux positions user)', async () => {
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await service.handleSignalEvent({ id: 'sig1' }, 'TP1_HIT', 100);

    expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
      where: { signalId: 'sig1', portfolioId: AUTOPILOT_PORTFOLIO_ID, status: 'OPEN' },
    });
  });

  it('closeRemaining filtre par portfolioId AutoPilot', async () => {
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await service.handleSignalEvent({ id: 'sig2' }, 'SL_HIT', 90);

    expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
      where: { signalId: 'sig2', portfolioId: AUTOPILOT_PORTFOLIO_ID, status: 'OPEN' },
    });
  });

  it('ne touche pas une position user trouvée hors AutoPilot', async () => {
    // findFirst scopé portfolio → null même si une position user existe sur le signal
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await service.handleSignalEvent({ id: 'sig3' }, 'SL_HIT', 90);

    expect(mockPrisma.position.update).not.toHaveBeenCalled();
    expect(mockPrisma.portfolio.update).not.toHaveBeenCalled();
  });
});
