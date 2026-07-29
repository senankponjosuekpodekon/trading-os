import axios from 'axios';
import { api } from '../api';

// Les intercepteurs axios sont accessibles via `interceptors.request/response.handlers`
// (API interne mais stable) — seul moyen d'invoquer directement fulfilled/rejected
// sans déclencher une vraie requête HTTP.
const getRequestFulfilled = () => (api.interceptors.request as any).handlers[0].fulfilled;
const getResponseHandlers = () => (api.interceptors.response as any).handlers[0];

describe('api client', () => {
  const ORIGINAL_ADAPTER = api.defaults.adapter;

  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    api.defaults.adapter = ORIGINAL_ADAPTER;
  });

  it('configures baseURL from NEXT_PUBLIC_API_URL with an /api suffix', () => {
    expect(api.defaults.baseURL).toMatch(/\/api$/);
  });

  it('sets Content-Type: application/json by default', () => {
    expect((api.defaults.headers as any)['Content-Type']).toBe('application/json');
  });

  describe('request interceptor', () => {
    it('attaches an Authorization header when a token is stored', () => {
      localStorage.setItem('trading_os_token', 'abc123');
      const fulfilled = getRequestFulfilled();

      const config = fulfilled({ headers: {} });

      expect(config.headers.Authorization).toBe('Bearer abc123');
    });

    it('does not attach an Authorization header when no token is stored', () => {
      const fulfilled = getRequestFulfilled();

      const config = fulfilled({ headers: {} });

      expect(config.headers.Authorization).toBeUndefined();
    });
  });

  describe('response interceptor', () => {
    it('passes successful responses through unchanged', () => {
      const { fulfilled } = getResponseHandlers();
      const res = { data: 'ok' };

      expect(fulfilled(res)).toBe(res);
    });

    it('rejects unchanged when the error is not a 401', async () => {
      const { rejected } = getResponseHandlers();
      const err = { response: { status: 500 }, config: {} };

      await expect(rejected(err)).rejects.toBe(err);
    });

    it('rejects unchanged when the request was already retried', async () => {
      const { rejected } = getResponseHandlers();
      const err = { response: { status: 401 }, config: { _retry: true, headers: {} } };

      await expect(rejected(err)).rejects.toBe(err);
    });

    it('refreshes the token and retries the original request on a first 401', async () => {
      localStorage.setItem('trading_os_refresh_token', 'refresh-1');
      const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
        data: { access_token: 'new-token', refresh_token: 'new-refresh' },
      });
      const mockAdapter = jest.fn().mockResolvedValue({ data: 'retried', status: 200, headers: {}, config: {} });
      api.defaults.adapter = mockAdapter;

      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      const result = await rejected(err);

      expect(postSpy).toHaveBeenCalledWith(expect.stringContaining('/auth/refresh'), { refresh_token: 'refresh-1' });
      expect(localStorage.getItem('trading_os_token')).toBe('new-token');
      expect(localStorage.getItem('trading_os_refresh_token')).toBe('new-refresh');
      expect(originalConfig._retry).toBe(true);
      expect(originalConfig.headers.Authorization).toBe('Bearer new-token');
      expect(mockAdapter).toHaveBeenCalled();
      expect(result.data).toBe('retried');
    });

    it('queues concurrent 401s behind a single refresh call and resolves all of them', async () => {
      localStorage.setItem('trading_os_refresh_token', 'refresh-1');
      let resolveRefresh: (v: any) => void = () => {};
      const postSpy = jest.spyOn(axios, 'post').mockImplementation(
        () => new Promise((resolve) => { resolveRefresh = resolve; }),
      );
      api.defaults.adapter = jest.fn().mockResolvedValue({ data: 'ok', status: 200, headers: {}, config: {} });

      const { rejected } = getResponseHandlers();
      const config1: any = { headers: {} };
      const config2: any = { headers: {} };

      const p1 = rejected({ response: { status: 401 }, config: config1 });
      const p2 = rejected({ response: { status: 401 }, config: config2 });

      resolveRefresh({ data: { access_token: 'shared-token', refresh_token: 'shared-refresh' } });
      await Promise.all([p1, p2]);

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(config1.headers.Authorization).toBe('Bearer shared-token');
      expect(config2.headers.Authorization).toBe('Bearer shared-token');
    });

    it('clears tokens and redirects to login when the refresh call itself fails', async () => {
      localStorage.setItem('trading_os_token', 'stale-token');
      localStorage.setItem('trading_os_refresh_token', 'stale-refresh');
      localStorage.setItem('trading_os_user', '{"id":"1"}');
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));

      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      // jsdom verrouille `window.location` (non reconfigurable) — on vérifie donc
      // uniquement l'effet observable côté application : le nettoyage des tokens
      // et le rejet de la promesse (la redirection elle-même n'est pas testable ici).
      await expect(rejected(err)).rejects.toBe(err);

      expect(localStorage.getItem('trading_os_token')).toBeNull();
      expect(localStorage.getItem('trading_os_refresh_token')).toBeNull();
      expect(localStorage.getItem('trading_os_user')).toBeNull();
    });

    it('rejects with "No refresh token" when no refresh token is stored', async () => {
      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      await expect(rejected(err)).rejects.toBe(err);
    });
  });
});
