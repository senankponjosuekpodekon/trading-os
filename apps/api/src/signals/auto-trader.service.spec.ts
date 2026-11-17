import { AutoTraderService } from './auto-trader.service';

const AUTOPILOT_PORTFOLIO_ID = 'ap-portfolio';

const mockPrisma = {
  user: {
    findUnique: jest.fn().mockResolvedValue({ id: 'ap-user' }),
    create: jest.fn(),
  },
  portfolio: {
    findFirst: jest.fn().mockResolvedValue({ id: AUTOPILOT_PORTFOLIO_ID, type: 'PAPER', currentCapital: 10_000, initialCapital: 10_000 }),
    create: jest.fn(),
    update: jest.fn(),
  },
  position: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
  },
  signalExecutionEvent: {
    findFirst: jest.fn().mockResolvedValue({ id: 'event1', metadata: { source: 'tracker' } }),
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
    mockPrisma.position.findFirst.mockResolvedValue(null);
    mockConfig.get.mockImplementation((_k: string, d: any) => d);
    mockFlags.getFlag.mockResolvedValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'ap-user' });
    mockPrisma.portfolio.findFirst.mockResolvedValue({ id: AUTOPILOT_PORTFOLIO_ID, type: 'PAPER', currentCapital: 10_000, initialCapital: 10_000 });
    mockPrisma.position.findMany.mockResolvedValue([]);
    service = new AutoTraderService(mockPrisma as any, mockFlags as any, mockConfig as any);
  });

  const signal = { id: 'sig1', assetId: 'sol', asset: { symbol: 'SOL/USDT' }, signal: 'BUY', confidence: 70, entryPrice: 100, stopLoss: 90 };
  const paperPortfolio = { id: AUTOPILOT_PORTFOLIO_ID, type: 'PAPER', currentCapital: 10_000, initialCapital: 10_000 };
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  function gate(body: unknown = { allow: true }, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 503, json: async () => body });
    mockPrisma.portfolio.findFirst.mockResolvedValue(paperPortfolio);
  }

  function expectReason(reason: string) {
    expect(mockPrisma.signalExecutionEvent.update).toHaveBeenLastCalledWith({
      where: { id: 'event1' },
      data: { metadata: { source: 'tracker', autopilot: { reason, mode: 'PAPER', recordedAt: expect.any(String) } } },
    });
  }

  it('records disabled entries without opening a position', async () => {
    mockFlags.getFlag.mockResolvedValue(false);
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason('DISABLED');
  });

  it('contains Redis failures and records a processing error', async () => {
    mockFlags.getFlag.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.handleSignalEvent(signal, 'ENTRY_HIT', 100)).resolves.toBeUndefined();
    expectReason('PROCESSING_ERROR');
  });

  it.each([NaN, Infinity, 0, -1])('rejects invalid event price %s', async (price) => {
    await service.handleSignalEvent(signal, 'ENTRY_HIT', price);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason('INVALID_EVENT_PRICE');
  });

  it.each([
    [{ confidence: 69 }, 'LOW_CONFIDENCE'],
    [{ confidence: NaN }, 'INVALID_CONFIDENCE'],
    [{ stopLoss: 110 }, 'INVALID_STOP'],
    [{ signal: 'HOLD' }, 'INVALID_DIRECTION'],
  ])('records invalid entry inputs %s', async (changes, reason) => {
    await service.handleSignalEvent({ ...signal, ...changes }, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason(reason);
  });

  it.each([{ allow: false }, { unexpected: true }, null])('fails closed on rejected or malformed gate %s', async (body) => {
    gate(body);
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason(body?.['allow'] === false ? 'GATE_REJECTED' : 'GATE_UNAVAILABLE');
  });

  it('fails closed on HTTP and network errors', async () => {
    gate({}, false);
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 100);
    expectReason('GATE_UNAVAILABLE');
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 100);
    expectReason('GATE_UNAVAILABLE');
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
  });

  it('does not open a position in a non-paper portfolio', async () => {
    gate();
    mockPrisma.portfolio.findFirst.mockResolvedValue({ ...paperPortfolio, type: 'LIVE' });
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 100);
    expect(global.fetch).not.toHaveBeenCalled();
    expectReason('NOT_PAPER_PORTFOLIO');
  });

  it('opens and closes a paper position, updating capital with adverse slippage', async () => {
    gate();
    await service.handleSignalEvent(signal, 'ENTRY_HIT', 101);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/portfolio/can-open'), expect.any(Object));
    const data = mockPrisma.position.create.mock.calls[0][0].data;
    expect(data.entryPrice).toBeCloseTo(101 * 1.0007);
    expect(data.quantity * (data.entryPrice - 90)).toBeCloseTo(100);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).qty).toBe(data.quantity);
    expectReason('PAPER_OPENED');
    mockPrisma.position.findFirst.mockResolvedValue({ ...data, id: 'pos1', pnl: 0 });
    mockFlags.getFlag.mockResolvedValue(false);
    await service.handleSignalEvent(signal, 'SL_HIT', 90);
    const closed = mockPrisma.position.update.mock.calls[0][0].data;
    expect(closed.status).toBe('CLOSED');
    expect(closed.quantity).toBe(0);
    expect(closed.pnl).toBeLessThan(-100);
    expect(mockPrisma.portfolio.update).toHaveBeenCalledWith({
      where: { id: AUTOPILOT_PORTFOLIO_ID }, data: { currentCapital: { increment: closed.pnl } },
    });
  });

  it('closes the whole remainder at TP3', async () => {
    mockPrisma.position.findFirst.mockResolvedValue({ id: 'p1', portfolioId: AUTOPILOT_PORTFOLIO_ID, direction: 'BUY', entryPrice: 100, quantity: 0.334, originalQuantity: 1, pnl: 10 });
    await service.handleSignalEvent(signal, 'TP3_HIT', 130);
    expect(mockPrisma.position.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', quantity: 0 }) }));
  });

  it('accounts for TP1, TP2 and the final remainder without double-counting a partial', async () => {
    const position = { id: 'p1', portfolioId: AUTOPILOT_PORTFOLIO_ID, direction: 'BUY', entryPrice: 100, quantity: 1, originalQuantity: 1, pnl: null, partialPnl: null, secondPartialPnl: null } as any;
    let capital = 10_000;
    mockPrisma.position.findFirst.mockImplementation(async () => position.status === 'CLOSED' ? null : position);
    mockPrisma.position.update.mockImplementation(async ({ data }: any) => Object.assign(position, data));
    mockPrisma.portfolio.update.mockImplementation(async ({ data }: any) => { capital += data.currentCapital.increment; });
    await service.handleSignalEvent(signal, 'TP1_HIT', 110);
    expect(position.quantity).toBeCloseTo(0.667);
    const firstCapital = capital;
    await service.handleSignalEvent(signal, 'TP1_HIT', 110);
    expect(capital).toBe(firstCapital);
    expectReason('ALREADY_PROCESSED');
    await service.handleSignalEvent(signal, 'TP2_HIT', 120);
    expect(position.quantity).toBeCloseTo(0.334);
    await service.handleSignalEvent(signal, 'TP3_HIT', 130);
    expect(position.status).toBe('CLOSED');
    expect(position.quantity).toBe(0);
    expect(position.pnl).toBeCloseTo((110 * 0.9993 - 100) * 0.333 + (120 * 0.9993 - 100) * 0.333 + (130 * 0.9993 - 100) * 0.334);
    expect(capital - 10_000).toBeCloseTo(position.pnl);
  });

  it('contains decision persistence failures', async () => {
    mockFlags.getFlag.mockResolvedValue(false);
    mockPrisma.signalExecutionEvent.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.handleSignalEvent(signal, 'ENTRY_HIT', 100)).resolves.toBeUndefined();
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
