import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '../useNotifications';

jest.mock('@/store/auth.store', () => ({
  useAuthStore: jest.fn(),
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, Array<(e: { data: string }) => void>> = {};
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (e: { data: string }) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  emit(type: string, e: { data: string }) {
    this.listeners[type]?.forEach((cb) => cb(e));
  }

  close() {
    this.closeCalls++;
  }
}

describe('useNotifications', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockEventSource.instances = [];
    (global as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not open an EventSource connection when there is no auth token', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue(null);

    renderHook(() => useNotifications());

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('opens an EventSource connection with the token in the URL once authenticated', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');

    renderHook(() => useNotifications());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/notifications/stream?token=tok-1');
  });

  it('adds an incoming default-message notification and increments the unread count', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { result } = renderHook(() => useNotifications());
    const es = MockEventSource.instances[0];

    act(() => es.onmessage?.({ data: JSON.stringify({ id: '1', type: 'ALERT', title: 'T', message: 'M', createdAt: 'now' }) }));

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toMatchObject({ id: '1', read: false });
    expect(result.current.unread).toBe(1);
  });

  it('adds notifications received via the "signal" custom event', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { result } = renderHook(() => useNotifications());
    const es = MockEventSource.instances[0];

    act(() => es.emit('signal', { data: JSON.stringify({ id: '2', type: 'SIGNAL', title: 'S', message: 'M', createdAt: 'now' }) }));

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unread).toBe(1);
  });

  it('ignores malformed notification payloads', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { result } = renderHook(() => useNotifications());
    const es = MockEventSource.instances[0];

    act(() => es.onmessage?.({ data: 'not-json' }));

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unread).toBe(0);
  });

  it('caps stored notifications at 50', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { result } = renderHook(() => useNotifications());
    const es = MockEventSource.instances[0];

    act(() => {
      for (let i = 0; i < 60; i++) {
        es.onmessage?.({ data: JSON.stringify({ id: String(i), type: 'SYSTEM', title: 'T', message: 'M', createdAt: 'now' }) });
      }
    });

    expect(result.current.notifications).toHaveLength(50);
    expect(result.current.unread).toBe(60);
  });

  it('markAllRead marks every notification as read and resets unread to 0', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { result } = renderHook(() => useNotifications());
    const es = MockEventSource.instances[0];

    act(() => es.onmessage?.({ data: JSON.stringify({ id: '1', type: 'SYSTEM', title: 'T', message: 'M', createdAt: 'now' }) }));
    expect(result.current.unread).toBe(1);

    act(() => result.current.markAllRead());

    expect(result.current.unread).toBe(0);
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
  });

  it('reconnects with backoff after a connection error', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    renderHook(() => useNotifications());
    const es1 = MockEventSource.instances[0];

    act(() => es1.onerror?.());
    expect(es1.closeCalls).toBe(1);
    expect(MockEventSource.instances).toHaveLength(1);

    // La première reconnexion applique déjà le backoff x1.5 (3000 -> 4500ms).
    act(() => jest.advanceTimersByTime(4500));
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it('closes the connection and stops retrying on unmount', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { unmount } = renderHook(() => useNotifications());
    const es1 = MockEventSource.instances[0];

    unmount();
    expect(es1.closeCalls).toBe(1);

    act(() => jest.advanceTimersByTime(60_000));
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('re-opens a new connection when the token changes', () => {
    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-1');
    const { rerender } = renderHook(() => useNotifications());
    expect(MockEventSource.instances).toHaveLength(1);

    (useAuthStore as unknown as jest.Mock).mockReturnValue('tok-2');
    rerender();

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('token=tok-2');
  });
});
