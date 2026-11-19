import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AutoTraderService } from './auto-trader.service';
import { AutopilotReadService } from '../admin/autopilot-read.service';

const databaseUrl = process.env.AUTOPILOT_TEST_DATABASE_URL
  ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined);
if (databaseUrl && process.env.CI !== 'true' && !new URL(databaseUrl).pathname.includes('test')) {
  throw new Error('AutoPilot integration tests require a dedicated database with test in its name');
}
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('AutoPilot durable outbox (dedicated PostgreSQL)', () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const flags = { getFlag: jest.fn().mockResolvedValue(true), setFlag: jest.fn() };
  const config = new ConfigService({ ENGINE_URL: 'http://paper-gate.invalid', ENGINE_API_KEY: 'test-engine-key' });
  const originalFetch = global.fetch;
  const prefix = `outbox-${Date.now()}`;
  let sequence = 0;
  let marketId: string;
  let strategyId: string;

  const worker = (client: any = db) => new AutoTraderService(client, flags as any, config);

  beforeAll(async () => {
    await db.$connect();
    marketId = (await db.market.create({ data: { name: prefix, type: 'CRYPTO' } })).id;
    strategyId = (await db.strategy.create({ data: { name: prefix, rules: {} } })).id;
  });

  beforeEach(() => {
    flags.getFlag.mockResolvedValue(true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ allow: true }) });
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await db.$disconnect();
  });

  async function newSignal() {
    const asset = await db.asset.create({ data: { symbol: `${prefix}-${++sequence}/USDT`, name: 'Test asset', marketId } });
    return db.signal.create({ data: { assetId: asset.id, strategyId, signal: 'BUY', confidence: 80, timeframe: '1h', entryPrice: 100, stopLoss: 90, executionStatus: 'ACTIVE' } });
  }

  async function event(signalId: string, type: 'ENTRY_HIT' | 'TP1_HIT' | 'SL_HIT', price: number, extra: any = {}) {
    return db.signalExecutionEvent.create({ data: { signalId, type, price, candleTime: new Date(), candleTimeframe: '1h', ...extra } });
  }

  async function close(signalId: string) {
    await event(signalId, 'SL_HIT', 90);
    await worker().processPendingEvents();
  }

  it('processes one entry once across concurrent workers and closes while entries are disabled', async () => {
    const signal = await newSignal();
    const entry = await event(signal.id, 'ENTRY_HIT', 100);
    await Promise.all([worker().processPendingEvents(), worker().processPendingEvents()]);
    expect(await db.position.count({ where: { signalId: signal.id } })).toBe(1);
    expect((await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: entry.id } })).autopilotStatus).toBe('COMPLETED');
    await worker().processPendingEvents();
    expect(await db.position.count({ where: { signalId: signal.id } })).toBe(1);
    flags.getFlag.mockResolvedValue(false);
    await close(signal.id);
    expect((await db.position.findFirstOrThrow({ where: { signalId: signal.id } })).status).toBe('CLOSED');
  });

  it('rolls back a position when decision persistence fails, then recovers after a worker restart', async () => {
    const signal = await newSignal();
    const entry = await event(signal.id, 'ENTRY_HIT', 100);
    let fail = true;
    const failingClient = new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction') return (callback: any, options: any) => target.$transaction(async tx => {
          const wrapped = new Proxy(tx, {
            get(transaction, key) {
              if (key === 'signalExecutionEvent') return new Proxy(transaction.signalExecutionEvent, {
                get(delegate, method) {
                  if (method === 'update') return async (args: any) => {
                    if (fail) { fail = false; throw new Error('simulated persistence failure'); }
                    return delegate.update(args);
                  };
                  const value = (delegate as any)[method];
                  return typeof value === 'function' ? value.bind(delegate) : value;
                },
              });
              const value = (transaction as any)[key];
              return typeof value === 'function' ? value.bind(transaction) : value;
            },
          });
          return callback(wrapped);
        }, options);
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await worker(failingClient).processPendingEvents();
    expect(await db.position.count({ where: { signalId: signal.id } })).toBe(0);
    const retry = await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: entry.id } });
    expect(retry.autopilotStatus).toBe('RETRY');
    expect(retry.autopilotAttempts).toBe(1);
    expect(retry.autopilotNextAttemptAt).toBeInstanceOf(Date);
    await db.signalExecutionEvent.update({ where: { id: entry.id }, data: { autopilotNextAttemptAt: new Date() } });
    await worker().processPendingEvents();
    expect(await db.position.count({ where: { signalId: signal.id } })).toBe(1);
    expect((await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: entry.id } })).autopilotAttempts).toBe(2);
    await close(signal.id);
  });

  it('credits a partial exit and its event exactly once under concurrency', async () => {
    const signal = await newSignal();
    await event(signal.id, 'ENTRY_HIT', 100);
    await worker().processPendingEvents();
    const before = await db.position.findFirstOrThrow({ where: { signalId: signal.id } });
    const capitalBefore = Number((await db.portfolio.findUniqueOrThrow({ where: { id: before.portfolioId } })).currentCapital);
    const partial = await event(signal.id, 'TP1_HIT', 110);
    await Promise.all([worker().processPendingEvents(), worker().processPendingEvents()]);
    await worker().processPendingEvents();
    const after = await db.position.findUniqueOrThrow({ where: { id: before.id } });
    const capitalAfter = Number((await db.portfolio.findUniqueOrThrow({ where: { id: before.portfolioId } })).currentCapital);
    expect(Number(after.quantity)).toBeCloseTo(Number(before.quantity) * 0.667);
    expect(capitalAfter - capitalBefore).toBeCloseTo(Number(after.pnl));
    expect((await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: partial.id } })).autopilotAttempts).toBe(1);
    await close(signal.id);
  });

  it('does not replay historical or stale entries', async () => {
    const historical = await newSignal();
    await event(historical.id, 'ENTRY_HIT', 100, { autopilotStatus: 'HISTORICAL' });
    const stale = await newSignal();
    const staleEvent = await event(stale.id, 'ENTRY_HIT', 100, { createdAt: new Date(Date.now() - 3_600_000) });
    await worker().processPendingEvents();
    expect(await db.position.count({ where: { signalId: { in: [historical.id, stale.id] } } })).toBe(0);
    expect((await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: staleEvent.id } })).autopilotStatus).toBe('SKIPPED');
  });

  it('does not process an exit ahead of a deferred entry, without blocking unrelated signals', async () => {
    const blocked = await newSignal();
    const retry = await event(blocked.id, 'ENTRY_HIT', 100, { autopilotStatus: 'RETRY', autopilotAttempts: 1, autopilotNextAttemptAt: new Date(Date.now() + 60_000) });
    const exit = await event(blocked.id, 'SL_HIT', 90);
    const independent = await newSignal();
    await event(independent.id, 'ENTRY_HIT', 100);
    await worker().processPendingEvents();
    expect((await db.signalExecutionEvent.findUniqueOrThrow({ where: { id: exit.id } })).autopilotStatus).toBe('PENDING');
    expect(await db.position.count({ where: { signalId: independent.id } })).toBe(1);
    await db.signalExecutionEvent.update({ where: { id: retry.id }, data: { autopilotStatus: 'SKIPPED' } });
    await worker().processPendingEvents();
    await close(independent.id);
  });

  it('supervises real paper accounting without including another user portfolio', async () => {
    const signal = await newSignal();
    await event(signal.id, 'ENTRY_HIT', 100);
    await worker().processPendingEvents();
    await event(signal.id, 'TP1_HIT', 110);
    await worker().processPendingEvents();
    const position = await db.position.findFirstOrThrow({ where: { signalId: signal.id } });
    const asset = await db.asset.findUniqueOrThrow({ where: { id: signal.assetId } });
    await db.candle.create({ data: { symbol: asset.symbol, timeframe: '1m', openTime: new Date(Date.now() - 120000), open: 105, high: 105, low: 105, close: 105 } });
    const otherUser = await db.user.create({ data: { email: `${prefix}@test.invalid`, name: 'Other user', password: 'disabled-login' } });
    const otherPortfolio = await db.portfolio.create({ data: { userId: otherUser.id, name: 'AutoPilot', type: 'PAPER' } });
    const otherPosition = await db.position.create({ data: { portfolioId: otherPortfolio.id, assetId: asset.id, direction: 'BUY', entryPrice: 999, quantity: 1 } });
    const reader = new AutopilotReadService(db as any, { isAutoTraderEnabled: async () => true } as any);
    const snapshot = await reader.snapshot();
    expect(snapshot.portfolio?.id).toBe(position.portfolioId);
    expect(snapshot.portfolio?.positions.map(p => p.id)).toContain(position.id);
    expect(snapshot.portfolio?.positions.map(p => p.id)).not.toContain(otherPosition.id);
    expect(snapshot.portfolio?.positions.find(p => p.id === position.id)?.unrealizedPnl).toBeCloseTo((105 - Number(position.entryPrice)) * Number(position.quantity));
    expect(snapshot.portfolio?.accountingDifference).toBeCloseTo(0, 6);
    expect(snapshot.signals.find(s => s.id === signal.id)?.events.some(e => e.reason === 'PAPER_PARTIAL_CLOSED')).toBe(true);
    await close(signal.id);
  });

  it('migration excludes pre-existing events while queuing new inserts', async () => {
    const sql = readFileSync(resolve(__dirname, '../../prisma/migrations/20261118230000_autopilot_event_outbox/migration.sql'), 'utf8');
    await db.$transaction(async tx => {
      const schema = `autopilot_probe_${Date.now()}`;
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE signal_execution_events (id text PRIMARY KEY, candle_time timestamp, created_at timestamp)');
      await tx.$executeRawUnsafe("INSERT INTO signal_execution_events (id) VALUES ('historical')");
      for (const statement of sql.split(';').map(part => part.trim()).filter(part => part && !['BEGIN', 'COMMIT'].includes(part))) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe("INSERT INTO signal_execution_events (id) VALUES ('new')");
      const rows = await tx.$queryRawUnsafe<{ id: string; autopilot_status: string }[]>('SELECT id, autopilot_status FROM signal_execution_events ORDER BY id');
      expect(rows).toEqual([{ id: 'historical', autopilot_status: 'HISTORICAL' }, { id: 'new', autopilot_status: 'PENDING' }]);
    });
  });
});
