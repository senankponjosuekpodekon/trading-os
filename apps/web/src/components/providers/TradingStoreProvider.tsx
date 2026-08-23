'use client';
import { useEffect, useRef } from 'react';
import { useTradingStore } from '@/store/trading.store';
import { useToast } from '@/hooks/useToast';

const API_WS = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

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
  const signalsError  = useTradingStore(s => s.signalsError);
  const wsRef = useRef<WebSocket | null>(null);
  const wsWarnedRef = useRef(false);
  const lastSignalsErrorRef = useRef<string | null>(null);
  const { toast } = useToast();

  // ── WebSocket prix ──────────────────────────────────────────────────────
  useEffect(() => {
    let stopped    = false;
    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (stopped) return;
      try {
        const ws = new WebSocket(`${API_WS}/ws/prices`);
        wsRef.current = ws;
        ws.onopen  = () => {
          setWsConnected(true);
          retryDelay = 3000;
          wsWarnedRef.current = false;
        };
        ws.onclose = () => {
          setWsConnected(false);
          if (!wsWarnedRef.current) {
            wsWarnedRef.current = true;
            toast('Reconnexion automatique en cours…', {
              title: 'Perte du flux temps réel',
              type: 'warning',
            });
          }
          if (stopped) return;
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        };
        ws.onerror   = () => {
          if (!wsWarnedRef.current) {
            wsWarnedRef.current = true;
            toast('Impossible de joindre le serveur temps réel. Vérifiez que l’API tourne et que NEXT_PUBLIC_WS_URL est correct.', {
              title: 'WebSocket erreur',
              type: 'error',
            });
          }
          ws.close();
        };
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
  }, [setPrice, setWsConnected, setSignals, toast]);

  // ── Polling signaux REST (fallback si WS ne les push pas) ───────────────
  useEffect(() => {
    fetchSignals(); // fetch initial
    const interval = setInterval(() => fetchSignals(), 30_000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  // Surfacer les erreurs de récupération des signaux
  useEffect(() => {
    if (!signalsError) {
      lastSignalsErrorRef.current = null;
      return;
    }
    if (lastSignalsErrorRef.current === signalsError) return;
    lastSignalsErrorRef.current = signalsError;
    toast(signalsError, {
      title: 'Signaux indisponibles',
      type: 'error',
    });
  }, [signalsError, toast]);

  return <>{children}</>;
}
