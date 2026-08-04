'use client';
import { useEffect, useState } from 'react';

const API_WS = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

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
        ws = new WebSocket(`${API_WS}/ws/prices`);
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
