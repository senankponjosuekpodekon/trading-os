'use client';
import { useEffect, useRef } from 'react';
import { useTradingStore } from '@/store/trading.store';

const ENGINE_WS = process.env.NEXT_PUBLIC_ENGINE_WS_URL || 'ws://localhost:8000';

/**
 * Composant racine à placer UNE SEULE FOIS dans le layout.
 * - Ouvre UN seul WebSocket /ws/prices partagé → alimente le store global
 * - Lance un fetch initial des signaux au montage
 * - Rafraîchit les signaux toutes les 30s (au lieu que chaque page le fasse)
 */
export function TradingStoreProvider({ children }: { children: React.ReactNode }) {
  const setPrice      = useTradingStore(s => s.setPrice);
  const setWsConnected= useTradingStore(s => s.setWsConnected);
  const setSignals    = useTradingStore(s => s.setSignals);
  const fetchSignals  = useTradingStore(s => s.fetchSignals);
  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket prix ──────────────────────────────────────────────────────
  useEffect(() => {
    let stopped    = false;
    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (stopped) return;
      try {
        const ws = new WebSocket(`${ENGINE_WS}/ws/prices`);
        wsRef.current = ws;
        ws.onopen  = () => { setWsConnected(true); retryDelay = 3000; };
        ws.onclose = () => {
          setWsConnected(false);
          if (stopped) return;
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        };
        ws.onerror   = () => ws.close();
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'prices')  setPrice(msg.data);
            if (msg.type === 'signals') setSignals(msg.data);
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
      wsRef.current?.close();
    };
  }, [setPrice, setWsConnected, setSignals]);

  // ── Polling signaux REST (fallback si WS ne les push pas) ───────────────
  useEffect(() => {
    fetchSignals(); // fetch initial
    const interval = setInterval(() => fetchSignals(), 30_000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  return <>{children}</>;
}
