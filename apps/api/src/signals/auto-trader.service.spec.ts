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
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
  $transaction: jest.fn(async (callback: any) => callback(mockPrisma)),
};

const mockFlags = { getFlag: jest.fn().mockResolvedValue(true), setFlag: jest.fn() };
const mockConfig = { get: jest.fn((_k: string, d: any) => d) };

describe('AutoTraderService — isolation portfolio', () => {
  let service: AutoTraderService;
  let lastReason: string;

  async function apply(signal: any, type: string, price: number) {
    lastReason = await (service as any).applyEvent(mockPrisma, signal, type, price);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockReset().mockResolvedValue([{ acquired: true }]);
    mockPrisma.signalExecutionEvent.findFirst.mockReset().mockResolvedValue(null);
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
    expect(lastReason).toBe(reason);
  }

  it('records disabled entries without opening a position', async () => {
    mockFlags.getFlag.mockResolvedValue(false);
    await apply(signal, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason('DISABLED');
  });

  it('propagates Redis failures so the transaction can roll back and retry', async () => {
    mockFlags.getFlag.mockRejectedValueOnce(new Error('redis down'));
    await expect(apply(signal, 'ENTRY_HIT', 100)).rejects.toThrow('redis down');
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, 0, -1])('rejects invalid event price %s', async (price) => {
    await apply(signal, 'ENTRY_HIT', price);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason('INVALID_EVENT_PRICE');
  });

  it.each([
    [{ confidence: 69 }, 'LOW_CONFIDENCE'],
    [{ confidence: NaN }, 'INVALID_CONFIDENCE'],
    [{ stopLoss: 110 }, 'INVALID_STOP'],
    [{ signal: 'HOLD' }, 'INVALID_DIRECTION'],
  ])('records invalid entry inputs %s', async (changes, reason) => {
    await apply({ ...signal, ...changes }, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason(reason);
  });

  it.each([{ allow: false }, { unexpected: true }, null])('fails closed on rejected or malformed gate %s', async (body) => {
    gate(body);
    await apply(signal, 'ENTRY_HIT', 100);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expectReason(body?.['allow'] === false ? 'GATE_REJECTED' : 'GATE_UNAVAILABLE');
  });

  it('fails closed on HTTP and network errors', async () => {
    gate({}, false);
    await apply(signal, 'ENTRY_HIT', 100);
    expectReason('GATE_UNAVAILABLE');
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await apply(signal, 'ENTRY_HIT', 100);
    expectReason('GATE_UNAVAILABLE');
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
  });

  it('does not open a position in a non-paper portfolio', async () => {
    gate();
    mockPrisma.portfolio.findFirst.mockResolvedValue({ ...paperPortfolio, type: 'LIVE' });
    await apply(signal, 'ENTRY_HIT', 100);
    expect(global.fetch).not.toHaveBeenCalled();
    expectReason('NOT_PAPER_PORTFOLIO');
  });

  it('opens and closes a paper position, updating capital with adverse slippage', async () => {
    gate();
    await apply(signal, 'ENTRY_HIT', 101);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/portfolio/can-open'), expect.any(Object));
    const data = mockPrisma.position.create.mock.calls[0][0].data;
    expect(data.entryPrice).toBeCloseTo(101 * 1.0007);
    expect(data.quantity * (data.entryPrice - 90)).toBeCloseTo(100);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).qty).toBe(data.quantity);
    expectReason('PAPER_OPENED');
    mockPrisma.position.findFirst.mockResolvedValue({ ...data, id: 'pos1', pnl: 0 });
    mockFlags.getFlag.mockResolvedValue(false);
    await apply(signal, 'SL_HIT', 90);
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
    await apply(signal, 'TP3_HIT', 130);
    expect(mockPrisma.position.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED', quantity: 0 }) }));
  });

  it('accounts for TP1, TP2 and the final remainder without double-counting a partial', async () => {
    const position = { id: 'p1', portfolioId: AUTOPILOT_PORTFOLIO_ID, direction: 'BUY', entryPrice: 100, quantity: 1, originalQuantity: 1, pnl: null, partialPnl: null, secondPartialPnl: null } as any;
    let capital = 10_000;
    mockPrisma.position.findFirst.mockImplementation(async () => position.status === 'CLOSED' ? null : position);
    mockPrisma.position.update.mockImplementation(async ({ data }: any) => Object.assign(position, data));
    mockPrisma.portfolio.update.mockImplementation(async ({ data }: any) => { capital += data.currentCapital.increment; });
    await apply(signal, 'TP1_HIT', 110);
    expect(position.quantity).toBeCloseTo(0.667);
    const firstCapital = capital;
    await apply(signal, 'TP1_HIT', 110);
    expect(capital).toBe(firstCapital);
    expectReason('ALREADY_PROCESSED');
    await apply(signal, 'TP2_HIT', 120);
    expect(position.quantity).toBeCloseTo(0.334);
    await apply(signal, 'TP3_HIT', 130);
    expect(position.status).toBe('CLOSED');
    expect(position.quantity).toBe(0);
    expect(position.pnl).toBeCloseTo((110 * 0.9993 - 100) * 0.333 + (120 * 0.9993 - 100) * 0.333 + (130 * 0.9993 - 100) * 0.334);
    expect(capital - 10_000).toBeCloseTo(position.pnl);
  });

  function queueEvent(overrides: any = {}) {
    const event = {
      id: 'event1', type: 'ENTRY_HIT', price: 100, metadata: { source: 'tracker' },
      createdAt: new Date(), candleTime: new Date(), candleTimeframe: '1h',
      autopilotAttempts: 0, autopilotNextAttemptAt: null,
      signal: { ...signal, executionStatus: 'ACTIVE' }, ...overrides,
    };
    mockPrisma.signalExecutionEvent.findFirst.mockResolvedValue(null)
      .mockResolvedValueOnce(event).mockResolvedValueOnce(event);
    return event;
  }

  it('atomically records the exact event decision with a timestamp', async () => {
    queueEvent();
    mockFlags.getFlag.mockResolvedValue(false);
    await service.processPendingEvents(1);
    expect(mockPrisma.signalExecutionEvent.update).toHaveBeenCalledWith({
      where: { id: 'event1' },
      data: expect.objectContaining({
        autopilotStatus: 'SKIPPED', autopilotAttempts: { increment: 1 }, autopilotProcessedAt: expect.any(Date),
        metadata: { source: 'tracker', autopilot: { reason: 'DISABLED', mode: 'PAPER', recordedAt: expect.any(String) } },
      }),
    });
  });

  it('schedules a bounded retry when persistence fails', async () => {
    queueEvent();
    mockFlags.getFlag.mockResolvedValue(false);
    mockPrisma.signalExecutionEvent.update.mockRejectedValueOnce(new Error('db down'));
    await expect(service.processPendingEvents(1)).resolves.toBeUndefined();
    expect(mockPrisma.signalExecutionEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'event1', autopilotAttempts: 0 }),
      data: expect.objectContaining({ autopilotStatus: 'RETRY', autopilotAttempts: { increment: 1 }, autopilotLastError: 'PROCESSING_ERROR', autopilotNextAttemptAt: expect.any(Date) }),
    });
  });

  it('marks exhausted retries as FAILED', async () => {
    queueEvent({ autopilotAttempts: 4 });
    mockFlags.getFlag.mockRejectedValueOnce(new Error('redis down'));
    await service.processPendingEvents(1);
    expect(mockPrisma.signalExecutionEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ autopilotStatus: 'FAILED', autopilotNextAttemptAt: null }),
    }));
  });

  it('does not replay stale entries or entries of closed signals', async () => {
    queueEvent({ createdAt: new Date(Date.now() - 3_600_000) });
    await service.processPendingEvents(1);
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
    expect(mockPrisma.signalExecutionEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ autopilotStatus: 'SKIPPED', metadata: expect.objectContaining({ autopilot: expect.objectContaining({ reason: 'STALE_ENTRY' }) }) }),
    }));
  });

  it('leaves the queue untouched when another worker owns the advisory lock', async () => {
    queueEvent();
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }]).mockResolvedValueOnce([{ acquired: false }]);
    await service.processPendingEvents(1);
    expect(mockPrisma.signalExecutionEvent.update).not.toHaveBeenCalled();
    expect(mockPrisma.position.create).not.toHaveBeenCalled();
  });

  it('partialClose filtre par portfolioId AutoPilot (pas de touch aux positions user)', async () => {
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await apply({ id: 'sig1' }, 'TP1_HIT', 100);

    expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
      where: { signalId: 'sig1', portfolioId: AUTOPILOT_PORTFOLIO_ID, status: 'OPEN' },
    });
  });

  it('closeRemaining filtre par portfolioId AutoPilot', async () => {
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await apply({ id: 'sig2' }, 'SL_HIT', 90);

    expect(mockPrisma.position.findFirst).toHaveBeenCalledWith({
      where: { signalId: 'sig2', portfolioId: AUTOPILOT_PORTFOLIO_ID, status: 'OPEN' },
    });
  });

  it('ne touche pas une position user trouvée hors AutoPilot', async () => {
    // findFirst scopé portfolio → null même si une position user existe sur le signal
    mockPrisma.position.findFirst.mockResolvedValue(null);

    await apply({ id: 'sig3' }, 'SL_HIT', 90);

    expect(mockPrisma.position.update).not.toHaveBeenCalled();
    expect(mockPrisma.portfolio.update).not.toHaveBeenCalled();
  });
});
