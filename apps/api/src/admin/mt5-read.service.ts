import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class Mt5ReadService {
  constructor(private readonly config: ConfigService) {}

  async snapshot() {
    const checkedAt = new Date().toISOString();
    const base = { checkedAt, mode: 'READ_ONLY' as const, executionEnabled: false as const };
    const url = this.config.get<string>('MT5_READ_BRIDGE_URL')?.trim().replace(/\/+$/, '');
    const token = this.config.get<string>('MT5_READ_BRIDGE_TOKEN')?.trim();
    if (!url || !token) return { ...base, status: 'NOT_CONFIGURED' as const };

    const get = async (path: string): Promise<unknown> => (await axios.get(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 5000, maxRedirects: 0,
      proxy: false, maxContentLength: 1024 * 1024,
    })).data;

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
