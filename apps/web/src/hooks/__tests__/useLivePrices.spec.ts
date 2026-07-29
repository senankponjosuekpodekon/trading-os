import { renderHook, act } from '@testing-library/react';
import { useLivePrices, useLiveSignals } from '../useLivePrices';

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

describe('useLivePrices / useLiveSignals', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (global as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('useLivePrices', () => {
    it('connects to the engine prices websocket endpoint on mount', () => {
      renderHook(() => useLivePrices());

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toContain('/ws/prices');
    });

    it('sets connected=true on open and merges incoming price updates', () => {
      const { result } = renderHook(() => useLivePrices());
      const ws = MockWebSocket.instances[0];

      act(() => ws.onopen?.());
      expect(result.current.connected).toBe(true);

      act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'prices', data: { 'BTC/USDT': 65000 } }) }));
      expect(result.current.prices).toEqual({ 'BTC/USDT': 65000 });

      act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'prices', data: { 'ETH/USDT': 3000 } }) }));
      expect(result.current.prices).toEqual({ 'BTC/USDT': 65000, 'ETH/USDT': 3000 });
    });

    it('ignores malformed payloads and non-"prices" message types', () => {
      const { result } = renderHook(() => useLivePrices());
      const ws = MockWebSocket.instances[0];

      act(() => ws.onmessage?.({ data: 'not-json' }));
      expect(result.current.prices).toEqual({});

      act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'other', data: { x: 1 } }) }));
      expect(result.current.prices).toEqual({});
    });

    it('sets connected=false and reconnects with backoff after the socket closes', () => {
      renderHook(() => useLivePrices());
      const ws1 = MockWebSocket.instances[0];

      act(() => ws1.onclose?.());
      expect(MockWebSocket.instances).toHaveLength(1);

      // La première reconnexion applique déjà le backoff x1.5 (3000 -> 4500ms).
      act(() => jest.advanceTimersByTime(4500));
      expect(MockWebSocket.instances).toHaveLength(2);
    });

    it('closes the socket on unmount and stops retrying', () => {
      const { unmount } = renderHook(() => useLivePrices());
      const ws1 = MockWebSocket.instances[0];

      unmount();
      expect(ws1.closeCalls).toBeGreaterThanOrEqual(1);

      act(() => jest.advanceTimersByTime(60_000));
      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('closes the socket when an error occurs', () => {
      renderHook(() => useLivePrices());
      const ws = MockWebSocket.instances[0];
      const closeSpy = jest.spyOn(ws, 'close');

      act(() => ws.onerror?.());
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('useLiveSignals', () => {
    it('connects to the engine signals websocket endpoint on mount', () => {
      renderHook(() => useLiveSignals());

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toContain('/ws/signals');
    });

    it('updates signals state and invokes onNewSignal on incoming "signals" messages', () => {
      const onNewSignal = jest.fn();
      const { result } = renderHook(() => useLiveSignals(onNewSignal));
      const ws = MockWebSocket.instances[0];

      act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'signals', data: [{ id: '1' }] }) }));

      expect(result.current.signals).toEqual([{ id: '1' }]);
      expect(onNewSignal).toHaveBeenCalledWith([{ id: '1' }]);
    });

    it('ignores non-"signals" message types', () => {
      const { result } = renderHook(() => useLiveSignals());
      const ws = MockWebSocket.instances[0];

      act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'prices', data: {} }) }));

      expect(result.current.signals).toEqual([]);
    });

    it('reconnects with backoff after the socket closes', () => {
      renderHook(() => useLiveSignals());
      const ws1 = MockWebSocket.instances[0];

      act(() => ws1.onclose?.());
      act(() => jest.advanceTimersByTime(4500));

      expect(MockWebSocket.instances).toHaveLength(2);
    });
  });
});
