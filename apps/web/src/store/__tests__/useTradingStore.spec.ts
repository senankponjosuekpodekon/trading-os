import { api } from '@/lib/api';
import { useTradingStore } from '../trading.store';

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn() },
}));

describe('useTradingStore', () => {
  beforeEach(() => {
    useTradingStore.setState({
      prices: {},
      wsConnected: false,
      signals: [],
      signalsLoading: false,
      signalsError: null,
      signalsFetchedAt: null,
    });
    jest.clearAllMocks();
    localStorage.setItem('trading_os_token', 'test-token');
  });

  afterEach(() => {
    localStorage.removeItem('trading_os_token');
  });

  it('updates prices', () => {
    useTradingStore.getState().setPrice({ 'BTC/USDT': 100_000 });
    expect(useTradingStore.getState().prices['BTC/USDT']).toBe(100_000);
  });

  it('updates wsConnected', () => {
    useTradingStore.getState().setWsConnected(true);
    expect(useTradingStore.getState().wsConnected).toBe(true);
  });

  it('fetches signals and stores them', async () => {
    const signals = [{ id: 's1', asset: { symbol: 'BTC/USDT' } }] as any;
    (api.get as jest.Mock).mockResolvedValue({ data: { data: signals } });

    await useTradingStore.getState().fetchSignals(true);

    expect(api.get).toHaveBeenCalledWith('/signals?limit=200');
    expect(useTradingStore.getState().signals).toEqual(signals);
    expect(useTradingStore.getState().signalsLoading).toBe(false);
    expect(useTradingStore.getState().signalsError).toBeNull();
  });

  it('does not refetch within stale window without force', async () => {
    const signals = [{ id: 's1' }] as any;
    (api.get as jest.Mock).mockResolvedValue({ data: { data: signals } });

    await useTradingStore.getState().fetchSignals(true);
    expect(api.get).toHaveBeenCalledTimes(1);

    await useTradingStore.getState().fetchSignals(false);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('sets error when fetch fails', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('Network error'));

    await useTradingStore.getState().fetchSignals(true);

    expect(useTradingStore.getState().signalsError).toBe('Network error');
    expect(useTradingStore.getState().signalsLoading).toBe(false);
  });
});
