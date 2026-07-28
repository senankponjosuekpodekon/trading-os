'use client';
import { create } from 'zustand';

type Mode = 'beginner' | 'professional';

interface ModeState {
  mode: Mode;
  toggle: () => void;
  setMode: (mode: Mode) => void;
}

const STORAGE_KEY = 'trading_os_mode';

function getStoredMode(): Mode {
  if (typeof window === 'undefined') return 'professional';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'beginner' ? 'beginner' : 'professional';
}

function setStoredMode(mode: Mode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

export const useModeStore = create<ModeState>((set, get) => ({
  mode: getStoredMode(),
  toggle: () => {
    const next = get().mode === 'beginner' ? 'professional' : 'beginner';
    setStoredMode(next);
    set({ mode: next });
  },
  setMode: (mode) => {
    setStoredMode(mode);
    set({ mode });
  },
}));
