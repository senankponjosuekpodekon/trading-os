'use client';
import { useEffect, useState } from 'react';

const ENGINE_WS = process.env.NEXT_PUBLIC_ENGINE_WS_URL || 'ws://localhost:8000';

export type LivePrices = Record<string, number>;


export function useLivePrices() {
  const [prices, setPrices]     = useState<LivePrices>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let stopped    = false;
    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket;

    function connect() {
      if (stopped) return;
      try {
        ws = new WebSocket(`${ENGINE_WS}/ws/prices`);
        ws.onopen  = () => { setConnected(true); retryDelay = 3000; };
        ws.onclose = () => {
          setConnected(false);
          if (stopped) return;
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        };
        ws.onerror   = () => ws.close();
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'prices') setPrices(prev => ({ ...prev, ...msg.data }));
          } catch {}
        };
      } catch {
        if (!stopped) {
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        }
      }
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);

  return { prices, connected };
}

export function useLiveSignals(onNewSignal?: (signals: any[]) => void) {
  const [signals, setSignals]   = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let stopped    = false;
    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket;

    function connect() {
      if (stopped) return;
      try {
        ws = new WebSocket(`${ENGINE_WS}/ws/signals`);
        ws.onopen  = () => { setConnected(true); retryDelay = 3000; };
        ws.onclose = () => {
          setConnected(false);
          if (stopped) return;
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        };
        ws.onerror   = () => ws.close();
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'signals') { setSignals(msg.data); onNewSignal?.(msg.data); }
          } catch {}
        };
      } catch {
        if (!stopped) {
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        }
      }
    }

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { signals, connected };
}
