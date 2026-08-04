'use client';
import { create } from 'zustand';
import { User } from '@/types';
import { api } from '@/lib/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string, totpToken?: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  init: () => void;
}

function storeUser(user: User) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('trading_os_user', JSON.stringify(user));
}

function clearStorage() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('trading_os_user');
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,

  init: () => {
    if (typeof window === 'undefined') return;
    const userRaw = localStorage.getItem('trading_os_user');
    if (userRaw) {
      try {
        set({ user: JSON.parse(userRaw) });
      } catch {}
    }
  },

  login: async (email, password, totpToken) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/login', { email, password, totpToken });
    storeUser(data.user);
    set({ user: data.user, isLoading: false });
  },

  register: async (email, password, name) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/register', { email, password, name });
    storeUser(data.user);
    set({ user: data.user, isLoading: false });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {}
    clearStorage();
    set({ user: null });
    window.location.href = '/auth/login';
  },
}));
