'use client';
import { create } from 'zustand';
import { User } from '@/types';
import { api } from '@/lib/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  init: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: false,

  init: () => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('trading_os_token');
    const userRaw = localStorage.getItem('trading_os_user');
    if (token && userRaw) {
      set({ token, user: JSON.parse(userRaw) });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('trading_os_token', data.access_token);
    localStorage.setItem('trading_os_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.access_token, isLoading: false });
  },

  register: async (email, password, name) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/register', { email, password, name });
    localStorage.setItem('trading_os_token', data.access_token);
    localStorage.setItem('trading_os_user', JSON.stringify(data.user));
    set({ user: data.user, token: data.access_token, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('trading_os_token');
    localStorage.removeItem('trading_os_user');
    set({ user: null, token: null });
    window.location.href = '/auth/login';
  },
}));
