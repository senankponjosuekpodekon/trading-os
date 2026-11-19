import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const currency = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 16;
const demoHealth = (h: unknown): h is Record<string, unknown> => record(h) && h.connected === true
  && h.identity_matches === true && h.ready_for_read === true && h.read_only === true && h.account_mode === 'DEMO'
  && integer(h.account_login) && h.account_login > 0 && typeof h.server === 'string' && !!h.server;

function brokerPage(value: unknown, deal = false) {
  if (!record(value) || !Array.isArray(value.items) || !integer(value.total) || value.limit !== 100 || value.offset !== 0
    || value.items.length !== Math.min(value.total, 100)
    || value.next_offset !== (value.total > 100 ? 100 : null)) return null;
  const ids = deal ? ['ticket', 'order', 'position_id', 'magic'] : ['ticket', 'position_id', 'magic'];
  const ints = deal ? ['type', 'entry', 'time_msc', 'reason']
    : ['type', 'state', 'time_setup_msc', 'time_done_msc', 'time_expiration', 'type_time', 'type_filling', 'reason'];
  const nums = deal ? ['volume', 'price', 'commission', 'swap', 'profit', 'fee']
    : ['volume_initial', 'volume_current', 'price_open', 'price_current', 'price_stoplimit', 'sl', 'tp'];
  const items: Record<string, string | number>[] = [];
  for (const row of value.items) {
    if (!record(row) || typeof row.symbol !== 'string' || row.symbol.length > 128
      || !ids.every(key => typeof row[key] === 'string' && (key === 'magic' ? /^-?\d{1,20}$/ : /^\d{1,20}$/).test(String(row[key])))
      || !ints.every(key => integer(row[key])) || !nums.every(key => finite(row[key]))) return null;
    items.push(Object.fromEntries(['symbol', ...ids, ...ints, ...nums].map(key => [key, row[key]])) as Record<string, string | number>);
  }
  if (new Set(items.map(row => row.ticket)).size !== items.length || items.some(row => /^0+$/.test(String(row.ticket)))) return null;
  return { items, total: value.total, limit: 100, offset: 0, nextOffset: value.next_offset as number | null };
}

function brokerContract(value: unknown) {
  const positive = ['contract_size', 'volume_min', 'volume_max', 'volume_step', 'point'];
  const nonnegative = ['tick_size', 'tick_value', 'tick_value_profit', 'tick_value_loss', 'margin_initial', 'margin_maintenance', 'volume_limit'];
  const ints = ['digits', 'stops_level', 'freeze_level', 'trade_calc_mode', 'trade_mode', 'filling_mode'];
  const currencies = ['currency_base', 'currency_profit', 'currency_margin'];
  if (!record(value) || value.symbol !== 'EURUSD'
    || !positive.every(key => finite(value[key]) && Number(value[key]) > 0)
    || !nonnegative.every(key => finite(value[key]) && Number(value[key]) >= 0)
    || !ints.every(key => integer(value[key])) || !currencies.every(key => currency(value[key]))
    || Number(value.volume_min) > Number(value.volume_max) || Number(value.volume_step) > Number(value.volume_max)) return null;
  return Object.fromEntries(['symbol', ...positive, ...nonnegative, ...ints, ...currencies].map(key => [key, value[key]])) as Record<string, string | number>;
}

@Injectable()
export class Mt5ReadService {
  constructor(private readonly config: ConfigService) {}

  private reader() {
    const url = this.config.get<string>('MT5_READ_BRIDGE_URL')?.trim().replace(/\/+$/, '');
    const token = this.config.get<string>('MT5_READ_BRIDGE_TOKEN')?.trim();
    if (!url || !token) return null;
    return async (path: string): Promise<unknown> => (await axios.get(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 5000, maxRedirects: 0,
      proxy: false, maxContentLength: 1024 * 1024,
    })).data;
  }

  async activity() {
    const end = new Date();
    end.setMilliseconds(0);
    const from = new Date(end.getTime() - 7 * 86400000).toISOString();
    const to = end.toISOString();
    const base = { checkedAt: new Date().toISOString(), mode: 'READ_ONLY' as const, executionEnabled: false as const };
    const get = this.reader();
    if (!get) return { ...base, status: 'NOT_CONFIGURED' as const };
    try {
      const before = await get('/health');
      if (!demoHealth(before)) return { ...base, status: 'NOT_READY' as const };
      const query = new URLSearchParams({ from, to, limit: '100', offset: '0' });
      const data = await get(`/activity?${query}`);
      const after = await get('/health');
      if (!demoHealth(after) || after.account_login !== before.account_login || after.server !== before.server) {
        return { ...base, status: 'NOT_READY' as const };
      }
      if (!record(data) || data.account_login !== before.account_login || data.server !== before.server
        || data.account_mode !== 'DEMO' || !currency(data.currency) || typeof data.checked_at !== 'string'
        || !Number.isFinite(Date.parse(data.checked_at)) || Date.now() - Date.parse(data.checked_at) > 30000
        || Date.parse(data.checked_at) - Date.now() > 5000 || !record(data.range)
        || typeof data.range.from !== 'string' || typeof data.range.to !== 'string'
        || Date.parse(data.range.from) !== Date.parse(from) || Date.parse(data.range.to) !== Date.parse(to)) {
        return { ...base, status: 'INVALID_RESPONSE' as const };
      }
      const pendingOrders = brokerPage(data.pending_orders);
      const historyOrders = brokerPage(data.history_orders);
      const deals = brokerPage(data.deals, true);
      const contract = brokerContract(data.contract);
      if (!pendingOrders || !historyOrders || !deals || !contract) return { ...base, status: 'INVALID_RESPONSE' as const };
      return { ...base, status: 'READY' as const, brokerCheckedAt: data.checked_at, currency: data.currency,
        period: { from, to }, pendingOrders, historyOrders, deals, contract };
    } catch (error: unknown) {
      const response = record(error) && record(error.response) ? error.response : null;
      const code = response && record(response.data) ? response.data.broker_error_code : null;
      return { ...base, status: 'UNAVAILABLE' as const, brokerErrorCode: finite(code) && Number.isSafeInteger(code) ? code : null };
    }
  }

  async snapshot() {
    const checkedAt = new Date().toISOString();
    const base = { checkedAt, mode: 'READ_ONLY' as const, executionEnabled: false as const };
    const get = this.reader();
    if (!get) return { ...base, status: 'NOT_CONFIGURED' as const };
    try {
      const health = await get('/health');
      if (!record(health)) return { ...base, status: 'INVALID_RESPONSE' as const };
      if (health.connected !== true || health.identity_matches !== true || health.ready_for_read !== true
        || health.read_only !== true || health.account_mode !== 'DEMO') {
        return { ...base, status: 'NOT_READY' as const,
          connected: health.connected === true, identityMatches: health.identity_matches === true,
          bridgeReadOnly: health.read_only === true, demo: health.account_mode === 'DEMO' };
      }

      if (!Number.isSafeInteger(health.account_login) || Number(health.account_login) <= 0
        || typeof health.server !== 'string' || !health.server) {
        return { ...base, status: 'INVALID_RESPONSE' as const };
      }
      const [account, positions, quote, contract] = await Promise.all([
        get('/account'), get('/positions'), get('/quote/EURUSD'), get('/contract/EURUSD'),
      ]);
      if (!record(account) || account.account_mode !== 'DEMO' || account.login !== health.account_login
        || account.server !== health.server || typeof account.currency !== 'string'
        || !['balance', 'equity', 'margin', 'margin_free'].every(key => finite(account[key]))
        || !Array.isArray(positions) || !positions.every(p => record(p) && finite(p.ticket) && typeof p.symbol === 'string')
        || !record(quote) || !finite(quote.bid) || !finite(quote.ask) || !finite(quote.time)
        || quote.bid <= 0 || quote.ask < quote.bid
        || !record(contract) || !['contract_size', 'volume_min', 'volume_max', 'volume_step'].every(
          key => finite(contract[key]) && Number(contract[key]) > 0)) {
        return { ...base, status: 'INVALID_RESPONSE' as const };
      }
      const age = Date.now() / 1000 - quote.time;
      if (age < -5 || age > 60) return { ...base, status: 'STALE_QUOTE' as const };

      return { ...base, status: 'READY' as const, connected: true, identityMatches: true,
        bridgeReadOnly: true, demo: true,
        account: { balance: account.balance as number, equity: account.equity as number,
          margin: account.margin as number, marginFree: account.margin_free as number,
          currency: account.currency },
        positionsCount: positions.length,
        quote: { symbol: 'EURUSD', bid: quote.bid, ask: quote.ask, time: quote.time },
        contract: { contractSize: contract.contract_size as number, volumeMin: contract.volume_min as number,
          volumeMax: contract.volume_max as number, volumeStep: contract.volume_step as number } };
    } catch {
      return { ...base, status: 'UNAVAILABLE' as const };
    }
  }
}
