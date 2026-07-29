import { render, act } from '@testing-library/react';
import { useTradingStore } from '@/store/trading.store';
import { useToast } from '@/hooks/useToast';
import { TradingStoreProvider } from '../TradingStoreProvider';

jest.mock('@/store/trading.store', () => ({
  useTradingStore: jest.fn(),
}));

jest.mock('@/hooks/useToast', () => ({
  useToast: jest.fn(),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls++;
  }
}

describe('TradingStoreProvider', () => {
  const setPrice = jest.fn();
  const setWsConnected = jest.fn();
  const setSignals = jest.fn();
  const fetchSignals = jest.fn();
  const toast = jest.fn();

  const mockState = { signalsError: null as string | null };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    MockWebSocket.instances = [];
    (global as any).WebSocket = MockWebSocket;
    mockState.signalsError = null;

    (useTradingStore as unknown as jest.Mock).mockImplementation((selector: any) =>
      selector({
        setPrice,
        setWsConnected,
        setSignals,
        fetchSignals,
        signalsError: mockState.signalsError,
      }),
    );
    (useToast as unknown as jest.Mock).mockReturnValue({ toast });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders its children', () => {
    const { getByText } = render(
      <TradingStoreProvider>
        <span>child content</span>
      </TradingStoreProvider>,
    );

    expect(getByText('child content')).toBeInTheDocument();
  });

  it('opens a single shared prices websocket on mount', () => {
    render(<TradingStoreProvider>content</TradingStoreProvider>);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('/ws/prices');
  });

  it('fetches signals once on mount and polls every 30s', () => {
    render(<TradingStoreProvider>content</TradingStoreProvider>);

    expect(fetchSignals).toHaveBeenCalledTimes(1);

    act(() => jest.advanceTimersByTime(30_000));
    expect(fetchSignals).toHaveBeenCalledTimes(2);

    act(() => jest.advanceTimersByTime(30_000));
    expect(fetchSignals).toHaveBeenCalledTimes(3);
  });

  it('marks the socket connected on open and dispatches price/signal messages to the store', () => {
    render(<TradingStoreProvider>content</TradingStoreProvider>);
    const ws = MockWebSocket.instances[0];

    act(() => ws.onopen?.());
    expect(setWsConnected).toHaveBeenCalledWith(true);

    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'prices', data: { 'BTC/USDT': 1 } }) }));
    expect(setPrice).toHaveBeenCalledWith({ 'BTC/USDT': 1 });

    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'signals', data: [{ id: '1' }] }) }));
    expect(setSignals).toHaveBeenCalledWith([{ id: '1' }]);
  });

  it('shows a warning toast (once) and reconnects with backoff when the socket closes', () => {
    render(<TradingStoreProvider>content</TradingStoreProvider>);
    const ws1 = MockWebSocket.instances[0];

    act(() => ws1.onclose?.());
    expect(setWsConnected).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: 'Perte du flux temps réel', type: 'warning' }));

    // Reconnexion : le backoff x1.5 s'applique dès la première tentative (3000 -> 4500ms).
    act(() => jest.advanceTimersByTime(4500));
    expect(MockWebSocket.instances).toHaveLength(2);

    // Un deuxième close ne doit pas re-toaster (wsWarnedRef déjà levé).
    act(() => MockWebSocket.instances[1].onclose?.());
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast and closes the socket on a connection error', () => {
    render(<TradingStoreProvider>content</TradingStoreProvider>);
    const ws = MockWebSocket.instances[0];
    const closeSpy = jest.spyOn(ws, 'close');

    act(() => ws.onerror?.());

    expect(toast).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ title: 'WebSocket erreur', type: 'error' }));
    expect(closeSpy).toHaveBeenCalled();
  });

  it('closes the socket and clears the polling interval on unmount', () => {
    const { unmount } = render(<TradingStoreProvider>content</TradingStoreProvider>);
    const ws = MockWebSocket.instances[0];

    unmount();
    expect(ws.closeCalls).toBeGreaterThanOrEqual(1);

    const callsBefore = fetchSignals.mock.calls.length;
    act(() => jest.advanceTimersByTime(60_000));
    expect(fetchSignals.mock.calls.length).toBe(callsBefore);
  });

  it('surfaces a new signalsError as an error toast exactly once', () => {
    const { rerender } = render(<TradingStoreProvider>content</TradingStoreProvider>);

    mockState.signalsError = 'Erreur réseau';
    rerender(<TradingStoreProvider>content</TradingStoreProvider>);
    expect(toast).toHaveBeenCalledWith('Erreur réseau', expect.objectContaining({ title: 'Signaux indisponibles', type: 'error' }));

    const callsAfterFirst = toast.mock.calls.length;
    rerender(<TradingStoreProvider>content</TradingStoreProvider>);
    expect(toast.mock.calls.length).toBe(callsAfterFirst);
  });
});
