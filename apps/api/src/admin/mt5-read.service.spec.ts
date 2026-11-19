import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Mt5ReadService } from './mt5-read.service';

jest.mock('axios');
const http = axios as jest.Mocked<typeof axios>;

let responses: Record<string, any>;
let service: Mt5ReadService;
let settings: Record<string, string>;

beforeEach(() => {
  jest.resetAllMocks();
  settings = { MT5_READ_BRIDGE_URL: 'http://mt5-read:5555/', MT5_READ_BRIDGE_TOKEN: 'read-token' };
  service = new Mt5ReadService({ get: (key: string) => settings[key] } as ConfigService);
  responses = {
    health: { connected: true, initialized: true, identity_matches: true, ready_for_read: true,
      read_only: true, account_mode: 'DEMO', account_login: 123, server: 'Broker-Demo' },
    account: { account_mode: 'DEMO', login: 123, server: 'Broker-Demo', currency: 'USD',
      balance: 10000, equity: 10000, margin: 0, margin_free: 10000, password: 'must-not-leak' },
    positions: [],
    'quote/EURUSD': { bid: 1.1, ask: 1.1001, time: Date.now() / 1000 },
    'contract/EURUSD': { contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01 },
  };
  http.get.mockImplementation(async (url) => ({ data: responses[String(url).replace('http://mt5-read:5555/', '')] }));
});

it('reads a verified demo through GET only without leaking account identity or secrets', async () => {
  const result = await service.snapshot();
  expect(result).toMatchObject({ status: 'READY', mode: 'READ_ONLY', executionEnabled: false,
    positionsCount: 0, account: { balance: 10000 }, contract: { contractSize: 100000 } });
  expect(http.get).toHaveBeenCalledTimes(5);
  expect(http.get).toHaveBeenCalledWith('http://mt5-read:5555/health', expect.objectContaining({
    headers: { Authorization: 'Bearer read-token' }, maxRedirects: 0, timeout: 5000,
    proxy: false, maxContentLength: 1024 * 1024,
  }));
  expect(http.post).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/read-token|must-not-leak|Broker-Demo|account_login/);
});

it.each(['MT5_READ_BRIDGE_URL', 'MT5_READ_BRIDGE_TOKEN'])('does not fall back to execution configuration if %s is absent', async key => {
  delete settings[key];
  settings.MT5_BRIDGE_URL = 'http://legacy-execution:5555';
  settings.MT5_BRIDGE_TOKEN = 'execution-token';
  expect(await service.snapshot()).toMatchObject({ status: 'NOT_CONFIGURED', executionEnabled: false });
  expect(http.get).not.toHaveBeenCalled();
});

it.each(['connected', 'identity_matches', 'ready_for_read', 'read_only'])('rejects unverified %s before reading account data', async key => {
  responses.health[key] = false;
  expect(await service.snapshot()).toMatchObject({ status: 'NOT_READY' });
  expect(http.get).toHaveBeenCalledTimes(1);
});

it('rejects real accounts', async () => {
  responses.health.account_mode = 'REAL';
  expect(await service.snapshot()).toMatchObject({ status: 'NOT_READY', demo: false });
});

it.each([null, [], { connected: true }])('handles malformed or incomplete health without crashing', async health => {
  responses.health = health;
  expect((await service.snapshot()).status).not.toBe('READY');
});

it.each(['account_login', 'server'])('rejects a healthy response without %s', async key => {
  delete responses.health[key];
  expect((await service.snapshot()).status).toBe('INVALID_RESPONSE');
});

it.each(['account', 'positions', 'quote/EURUSD', 'contract/EURUSD'])('rejects malformed %s without partial data', async path => {
  responses[path] = null;
  const result = await service.snapshot();
  expect(result.status).toBe('INVALID_RESPONSE');
  expect(result).not.toHaveProperty('account');
});

it.each([{ login: 456 }, { server: 'Other' }, { account_mode: 'REAL' }, { equity: Infinity }])('rejects account inconsistency %j', async change => {
  Object.assign(responses.account, change);
  expect((await service.snapshot()).status).toBe('INVALID_RESPONSE');
});

it.each([120, -120])('rejects stale or future ticks (%s seconds)', async age => {
  responses['quote/EURUSD'].time = Date.now() / 1000 - age;
  expect((await service.snapshot()).status).toBe('STALE_QUOTE');
});

it.each([{ bid: NaN }, { ask: 0 }, { bid: -1 }])('rejects invalid quotes %j', async change => {
  Object.assign(responses['quote/EURUSD'], change);
  expect((await service.snapshot()).status).toBe('INVALID_RESPONSE');
});

it('rejects invalid contract sizing', async () => {
  responses['contract/EURUSD'].volume_step = 0;
  expect((await service.snapshot()).status).toBe('INVALID_RESPONSE');
});

it('redacts transport errors and never returns cached balances', async () => {
  await service.snapshot();
  http.get.mockRejectedValueOnce(new Error('Bearer read-token'));
  const result = await service.snapshot();
  expect(result).toMatchObject({ status: 'UNAVAILABLE' });
  expect(result).not.toHaveProperty('account');
  expect(JSON.stringify(result)).not.toContain('read-token');
});
