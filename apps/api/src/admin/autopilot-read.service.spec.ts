import { AutopilotReadService } from './autopilot-read.service';
import { AUTOPILOT_EMAIL } from '../signals/auto-trader.service';

describe('AutopilotReadService', () => {
  let db: any;
  let service: AutopilotReadService;
  const now = new Date('2026-11-19T12:00:00Z');
  const position = (overrides = {}) => ({
    id: 'position', signalId: 'signal', status: 'OPEN', direction: 'BUY',
    entryPrice: 100, quantity: 2, originalQuantity: 3, stopLoss: 90,
    takeProfit: 120, takeProfit2: 130, takeProfit3: null,
    pnl: 10, partialPnl: 10, secondPartialPnl: null,
    partialExitAt: now, partialExitPrice: 110, secondPartialExitAt: null,
    secondPartialExitPrice: null, openedAt: now, closedAt: null, exitPrice: null,
    asset: { symbol: 'BTC/USDT' }, ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    db = {
      portfolio: { findFirst: jest.fn().mockResolvedValue({ id: 'system', name: 'AutoPilot', type: 'PAPER', currency: 'USD', initialCapital: 10000, currentCapital: 10010 }) },
      position: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.status === 'CLOSED' ? [] : [position()])),
        aggregate: jest.fn().mockResolvedValue({ _sum: { pnl: 10 } }),
        count: jest.fn().mockResolvedValue(0),
      },
      candle: { findFirst: jest.fn().mockResolvedValue({ close: 105, openTime: new Date(now.getTime() - 120000) }) },
      signal: { findMany: jest.fn().mockResolvedValue([]) },
      signalExecutionEvent: {
        groupBy: jest.fn().mockResolvedValue([{ autopilotStatus: 'RETRY', _count: { _all: 1 } }]),
        findFirst: jest.fn().mockResolvedValue({ autopilotLastAttemptAt: now }),
      },
    };
    db.$transaction = jest.fn((fn) => fn(db));
    service = new AutopilotReadService(db, { isAutoTraderEnabled: jest.fn().mockResolvedValue(true) } as any);
  });

  afterEach(() => jest.useRealTimers());

  it('scopes the privileged read to the system PAPER portfolio without creating it', async () => {
    const result = await service.snapshot();
    expect(db.portfolio.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { name: 'AutoPilot', type: 'PAPER', user: { email: AUTOPILOT_EMAIL } } }));
    expect(db.position.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portfolioId: 'system', status: { in: ['OPEN', 'PARTIAL', 'PARTIAL_2'] } } }));
    expect(result.mode).toBe('PAPER');
    expect(result.readOnly).toBe(true);
    expect(result.executionEnabled).toBe(false);
  });

  it('does not double count partial realized P&L and values only the remaining quantity', async () => {
    const { portfolio } = await service.snapshot();
    expect(portfolio).toMatchObject({ realizedPnl: 10, unrealizedPnl: 10, equity: 10020, accountingDifference: 0, riskToStop: 20 });
    expect(portfolio?.positions[0]).toMatchObject({ quantity: 2, realizedPnl: 10, unrealizedPnl: 10 });
  });

  it('calculates short P&L with the opposite sign', async () => {
    db.position.findMany.mockResolvedValueOnce([position({ direction: 'SELL', stopLoss: 110 })]).mockResolvedValueOnce([]);
    expect((await service.snapshot()).portfolio?.unrealizedPnl).toBe(-10);
  });

  it.each([null, { close: 105, openTime: new Date('2026-11-19T11:00:00Z') },
    { close: 105, openTime: new Date('2026-11-19T12:01:00Z') },
    { close: 0, openTime: new Date('2026-11-19T11:58:00Z') }])('does not present missing, stale, future or invalid marks as zero', async candle => {
    db.candle.findFirst.mockResolvedValue(candle);
    const { portfolio } = await service.snapshot();
    expect(portfolio?.unrealizedPnl).toBeNull();
    expect(portfolio?.equity).toBeNull();
    expect(portfolio?.positions[0].mark).toBeNull();
  });

  it('keeps the portfolio absent without creating it', async () => {
    db.portfolio.findFirst.mockResolvedValue(null);
    expect((await service.snapshot()).portfolio).toBeNull();
    expect(db.position.findMany).not.toHaveBeenCalled();
  });

  it('shows zero latent P&L only when there are no open positions', async () => {
    db.position.findMany.mockResolvedValue([]);
    expect((await service.snapshot()).portfolio?.unrealizedPnl).toBe(0);
    expect(db.candle.findFirst).not.toHaveBeenCalled();
  });

  it('reports accounting discrepancies instead of masking them', async () => {
    db.position.aggregate.mockResolvedValue({ _sum: { pnl: 5 } });
    expect((await service.snapshot()).portfolio?.accountingDifference).toBe(5);
  });

  it('includes closures without adding partial P&L a second time', async () => {
    db.position.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([position({ status: 'CLOSED', quantity: 0, pnl: 30, partialPnl: 10, closedAt: now, exitPrice: 110 })]);
    db.position.aggregate.mockResolvedValue({ _sum: { pnl: 30 } });
    db.position.count.mockResolvedValue(1);
    const { portfolio } = await service.snapshot();
    expect(portfolio?.realizedPnl).toBe(30);
    expect(portfolio?.closedCount).toBe(1);
    expect(portfolio?.closedPositions[0]).toMatchObject({ realizedPnl: 30, partialPnl: 10, exitPrice: 110 });
  });

  it('sanitizes event metadata and exposes persisted decision timestamps', async () => {
    db.signal.findMany.mockResolvedValue([{
      id: 'signal', signal: 'BUY', confidence: 70, executionStatus: 'ACTIVE', createdAt: now,
      asset: { symbol: 'BTC/USDT' },
      executionEvents: [{ id: 'event', type: 'ENTRY_HIT', candleTime: now, createdAt: now,
        autopilotStatus: 'SKIPPED', autopilotAttempts: 1, autopilotProcessedAt: now,
        autopilotNextAttemptAt: null, autopilotLastAttemptAt: now, autopilotLastError: null,
        metadata: { internal: 'not-for-the-client', autopilot: { reason: 'ASSET_ALREADY_OPEN' } } }],
    }]);
    const { signals } = await service.snapshot();
    expect(signals[0].events[0]).toMatchObject({ reason: 'ASSET_ALREADY_OPEN', attempts: 1, processedAt: now });
    expect(signals[0].events[0]).not.toHaveProperty('metadata');
    expect(JSON.stringify(signals)).not.toContain('not-for-the-client');
  });

  it('does not use an engine or broker fallback when marks are unavailable', async () => {
    db.candle.findFirst.mockResolvedValue(null);
    const result = await service.snapshot();
    expect(result.portfolio?.unrealizedPnl).toBeNull();
    expect(db.candle.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { symbol: 'BTC/USDT', timeframe: '1m', openTime: { gte: new Date(now.getTime() - 300000), lte: new Date(now.getTime() - 60000) } },
    }));
  });

  it('reports queue evidence without inventing a worker heartbeat', async () => {
    const { worker } = await service.snapshot();
    expect(worker).toEqual({ enabled: true, statusCounts: { RETRY: 1 }, lastAttemptAt: now });
  });
});
