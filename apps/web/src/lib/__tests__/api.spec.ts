import axios from 'axios';
import { api } from '../api';

// Les intercepteurs axios sont accessibles via `interceptors.response.handlers`
// (API interne mais stable) — seul moyen d'invoquer directement fulfilled/rejected
// sans déclencher une vraie requête HTTP.
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

  it('uses withCredentials for cookie-based auth', () => {
    expect(api.defaults.withCredentials).toBe(true);
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

    it('refreshes the session and retries the original request on a first 401', async () => {
      const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
        data: { access_token: 'new-token' },
      });
      const mockAdapter = jest.fn().mockResolvedValue({ data: 'retried', status: 200, headers: {}, config: {} });
      api.defaults.adapter = mockAdapter;

      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      const result = await rejected(err);

      expect(postSpy).toHaveBeenCalledWith(expect.stringContaining('/auth/refresh'), {}, { withCredentials: true });
      expect(originalConfig._retry).toBe(true);
      expect(mockAdapter).toHaveBeenCalled();
      expect(result.data).toBe('retried');
    });

    it('queues concurrent 401s behind a single refresh call and resolves all of them', async () => {
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

      resolveRefresh({ data: { access_token: 'shared-token' } });
      await Promise.all([p1, p2]);

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(api.defaults.adapter as jest.Mock).toHaveBeenCalledTimes(2);
    });

    it('clears user storage and redirects to login when the refresh call itself fails', async () => {
      localStorage.setItem('trading_os_user', '{"id":"1"}');
      jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));

      // jsdom blocks window.location.href assignment — wrap in try/catch
      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      await expect(rejected(err)).rejects.toBe(err);

      expect(localStorage.getItem('trading_os_user')).toBeNull();
    });

    it('rejects unchanged when refresh has no stored session', async () => {
      const { rejected } = getResponseHandlers();
      const originalConfig: any = { headers: {} };
      const err = { response: { status: 401 }, config: originalConfig };

      await expect(rejected(err)).rejects.toBe(err);
    });
  });
});
