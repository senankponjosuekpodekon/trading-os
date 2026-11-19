import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Mt5ReadService } from './mt5-read.service';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;
const now = new Date('2026-11-19T12:00:00Z');
let service: Mt5ReadService;
let health: any;
let activity: any;
const page = (items: any[] = []) => ({ items, total: items.length, limit: 100, offset: 0, next_offset: null });
const order = () => ({ ticket: '9007199254740993', position_id: '0', magic: '42', symbol: 'EURUSD', type: 2, state: 1,
  time_setup_msc: now.getTime(), time_done_msc: 0, time_expiration: 0, type_time: 0, type_filling: 1, reason: 0,
  volume_initial: 0.01, volume_current: 0.01, price_open: 1.1, price_current: 1.1, price_stoplimit: 0, sl: 1.08, tp: 1.12,
  comment: 'must-not-leak', account_login: 123 });

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
  jest.resetAllMocks();
  service = new Mt5ReadService(new ConfigService({ MT5_READ_BRIDGE_URL: 'http://mt5-read:5555', MT5_READ_BRIDGE_TOKEN: 'private-read-token' }));
  health = { connected: true, identity_matches: true, ready_for_read: true, read_only: true,
    account_mode: 'DEMO', account_login: 123, server: 'Broker-Demo' };
  activity = { account_login: 123, server: 'Broker-Demo', account_mode: 'DEMO', currency: 'USD', checked_at: now.toISOString(),
    range: { from: '2026-11-12T12:00:00Z', to: now.toISOString() },
    pending_orders: page([order()]), history_orders: page(), deals: page(),
    contract: { symbol: 'EURUSD', contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01,
      digits: 5, point: 0.00001, tick_size: 0.00001, tick_value: 1, tick_value_profit: 1, tick_value_loss: 1,
      stops_level: 10, freeze_level: 0, trade_calc_mode: 0, trade_mode: 4, filling_mode: 3,
      margin_initial: 0, margin_maintenance: 0, volume_limit: 0,
      currency_base: 'EUR', currency_profit: 'USD', currency_margin: 'EUR', password: 'must-not-leak' },
  };
  http.get.mockImplementation(async url => ({ data: String(url).includes('/activity?') ? activity : health }));
});
afterEach(() => jest.useRealTimers());

it('returns bounded read-only activity, keeps large IDs exact and strips private metadata', async () => {
  const data = await service.activity();
  expect(data).toMatchObject({ status: 'READY', mode: 'READ_ONLY', executionEnabled: false,
    pendingOrders: { total: 1, items: [{ ticket: '9007199254740993' }] }, contract: { tick_value_loss: 1 } });
  expect(http.get).toHaveBeenCalledTimes(3);
  expect(http.post).not.toHaveBeenCalled();
  const url = new URL(String(http.get.mock.calls[1][0]));
  expect(url.searchParams.get('limit')).toBe('100');
  expect(url.searchParams.get('from')).toBe('2026-11-12T12:00:00.000Z');
  expect(JSON.stringify(data)).not.toMatch(/private-read-token|must-not-leak|Broker-Demo|account_login|password|comment/);
});

it.each(['connected', 'identity_matches', 'read_only', 'ready_for_read'])('refuses activity when %s is not verified', async key => {
  health[key] = false;
  expect(await service.activity()).toMatchObject({ status: 'NOT_READY' });
  expect(http.get).toHaveBeenCalledTimes(1);
});

it('never falls back to the execution bridge', async () => {
  service = new Mt5ReadService(new ConfigService({ MT5_BRIDGE_URL: 'http://execution:5555', MT5_BRIDGE_TOKEN: 'execution-token' }));
  expect(await service.activity()).toMatchObject({ status: 'NOT_CONFIGURED' });
  expect(http.get).not.toHaveBeenCalled();
});

it('rejects a real account before querying activity', async () => {
  health.account_mode = 'REAL';
  expect(await service.activity()).toMatchObject({ status: 'NOT_READY' });
  expect(http.get).toHaveBeenCalledTimes(1);
});

it('discards activity when the health identity changes after the read', async () => {
  http.get.mockResolvedValueOnce({ data: health }).mockResolvedValueOnce({ data: activity })
    .mockResolvedValueOnce({ data: { ...health, account_login: 456 } });
  const data = await service.activity();
  expect(data.status).toBe('NOT_READY');
  expect(data).not.toHaveProperty('pendingOrders');
});

it.each([
  { account_login: 456 }, { account_mode: 'REAL' }, { server: 'Other' }, { currency: null },
  { checked_at: '2026-11-19T11:00:00Z' }, { checked_at: '2026-11-19T12:05:00Z' },
  { range: { from: '2026-11-01T00:00:00Z', to: now.toISOString() } },
  { pending_orders: { ...page(), items: null } }, { deals: null }, { contract: null },
])('rejects inconsistent or stale activity without partial data: %j', async update => {
  Object.assign(activity, update);
  const data = await service.activity();
  expect(data.status).toBe('INVALID_RESPONSE');
  expect(data).not.toHaveProperty('pendingOrders');
});

it.each([
  { ticket: 9007199254740992 }, { volume_current: NaN }, { time_setup_msc: -1 }, { magic: {} },
])('rejects invalid order rows: %j', async update => {
  activity.pending_orders.items[0] = { ...order(), ...update };
  expect((await service.activity()).status).toBe('INVALID_RESPONSE');
});

it('reports pagination instead of silently implying the history is complete', async () => {
  activity.history_orders = { items: Array.from({ length: 100 }, (_, i) => ({ ...order(), ticket: String(i + 1) })), total: 120, limit: 100, offset: 0, next_offset: 100 };
  expect(await service.activity()).toMatchObject({ status: 'READY', historyOrders: { total: 120, nextOffset: 100 } });
});

it('rejects duplicate order tickets rather than hiding them', async () => {
  activity.pending_orders = page([order(), order()]);
  expect((await service.activity()).status).toBe('INVALID_RESPONSE');
});

it('rejects inconsistent pagination', async () => {
  activity.deals.total = 10;
  expect((await service.activity()).status).toBe('INVALID_RESPONSE');
});

it('allows broker-reported zero tick values without claiming sizing is validated', async () => {
  activity.contract.tick_value_loss = 0;
  expect(await service.activity()).toMatchObject({ status: 'READY', contract: { tick_value_loss: 0 }, executionEnabled: false });
});

it('sanitizes structured broker errors and does not cache a successful response', async () => {
  await service.activity();
  http.get.mockRejectedValueOnce({ response: { data: { error: 'private-read-token', broker_error_code: -10004 } } });
  const data = await service.activity();
  expect(data).toMatchObject({ status: 'UNAVAILABLE', brokerErrorCode: -10004 });
  expect(data).not.toHaveProperty('pendingOrders');
  expect(JSON.stringify(data)).not.toContain('private-read-token');
});
