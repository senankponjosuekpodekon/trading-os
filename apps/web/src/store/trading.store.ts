'use client';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { Signal } from '@/types';

// ── Types ──────────────────────────────────────────────────────────────────
export type LivePrices = Record<string, number>;

interface TradingState {
  // Prix live (WebSocket)
  prices:        LivePrices;
  wsConnected:   boolean;
  setPrice:      (updates: LivePrices) => void;
  setWsConnected:(v: boolean) => void;

  // Signaux (REST + WS)
  signals:        Signal[];
  signalsLoading: boolean;
  signalsError:   string | null;
  signalsFetchedAt: number | null;   // timestamp du dernier fetch
  fetchSignals:   (force?: boolean) => Promise<void>;
  setSignals:     (s: Signal[]) => void;
}

const SIGNALS_STALE_MS = 30_000; // re-fetch si données > 30s

export const useTradingStore = create<TradingState>((set, get) => ({
  // ── Prix live ──────────────────────────────────────────────────────────
  prices:        {},
  wsConnected:   false,
  setPrice:      (updates) => set(s => ({ prices: { ...s.prices, ...updates } })),
  setWsConnected:(v) => set({ wsConnected: v }),

  // ── Signaux ────────────────────────────────────────────────────────────
  signals:        [],
  signalsLoading: false,
  signalsError:   null,
  signalsFetchedAt: null,

  fetchSignals: async (force = false) => {
    const { signalsLoading, signalsFetchedAt } = get();
    const hasToken = typeof window !== 'undefined' ? !!localStorage.getItem('trading_os_token') : false;
    const now = Date.now();
    // Éviter les fetches simultanés ou trop fréquents
    if (signalsLoading) return;
    if (!hasToken) return;
    if (!force && signalsFetchedAt && now - signalsFetchedAt < SIGNALS_STALE_MS) return;

    set({ signalsLoading: true, signalsError: null });
    try {
      const { data } = await api.get('/signals?limit=200');
      const list: Signal[] = data?.data ?? data ?? [];
      set({ signals: list, signalsLoading: false, signalsFetchedAt: Date.now() });
    } catch (err: any) {
      set({ signalsLoading: false, signalsError: err?.message ?? 'Erreur fetch signaux' });
    }
  },

  setSignals: (signals) => set({ signals, signalsFetchedAt: Date.now() }),
}));
