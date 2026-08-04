'use client';
import { create } from 'zustand';
import { User } from '@/types';
import { api } from '@/lib/api';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string, totpToken?: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  init: () => void;
}

function storeUser(data: { access_token: string; refresh_token: string; user: User }) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('trading_os_user', JSON.stringify(data.user));
  localStorage.setItem('trading_os_token', data.access_token);
  localStorage.setItem('trading_os_refresh_token', data.refresh_token);
}

function clearStorage() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('trading_os_token');
  localStorage.removeItem('trading_os_refresh_token');
  localStorage.removeItem('trading_os_user');
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  refreshToken: null,
  isLoading: false,

  init: () => {
    if (typeof window === 'undefined') return;
    const userRaw = localStorage.getItem('trading_os_user');
    const token = localStorage.getItem('trading_os_token');
    const refreshToken = localStorage.getItem('trading_os_refresh_token');
    if (userRaw) {
      try {
        set({ user: JSON.parse(userRaw), token, refreshToken });
      } catch {}
    }
  },

  login: async (email, password, totpToken) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/login', { email, password, totpToken });
    storeUser(data);
    set({ user: data.user, token: data.access_token, refreshToken: data.refresh_token, isLoading: false });
  },

  register: async (email, password, name) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/register', { email, password, name });
    storeUser(data);
    set({ user: data.user, token: data.access_token, refreshToken: data.refresh_token, isLoading: false });
  },

  logout: async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {}
    clearStorage();
    set({ user: null, token: null, refreshToken: null });
    window.location.href = '/auth/login';
  },
}));
