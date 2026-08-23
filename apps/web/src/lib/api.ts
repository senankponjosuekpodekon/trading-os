import { logger } from '@/lib/logger';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ApiError {
  status: number;
  message: string;
  code?: string;
}

interface RetryRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

let isRefreshing = false;
let refreshSubscribers: Array<() => void> = [];

function onRefreshed() {
  refreshSubscribers.forEach((cb, i) => {
    setTimeout(cb, i * 100);
  });
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: () => void) {
  refreshSubscribers.push(cb);
}

function clearUserStorage() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('trading_os_user');
}

async function doRefresh() {
  await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true });
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as RetryRequestConfig | undefined;
    const status = err.response?.status;

    if (status === 401 && typeof window !== 'undefined' && original && !original._retry) {
      original._retry = true;

      if (!isRefreshing) {
        isRefreshing = true;
        try {
          await doRefresh();
          isRefreshing = false;
          onRefreshed();
          return api(original);
        } catch {
          isRefreshing = false;
          clearUserStorage();
          try { window.location.href = '/auth/login'; } catch {}
          return Promise.reject(err);
        }
      }

      return new Promise<AxiosResponse>((resolve) => {
        addRefreshSubscriber(() => {
          resolve(api(original));
        });
      });
    }

    if (status && status >= 500) {
            logger.error('[API] server error', status, err.message);
    }

    return Promise.reject(err);
  },
);

export function handleApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const data = (error.response?.data ?? {}) as { message?: string; error?: string; code?: string };
    const message = data.message ?? data.error ?? error.message ?? 'Erreur réseau';
    return {
      status: error.response?.status ?? 0,
      message,
      code: data.code ?? error.code,
    };
  }
  if (error instanceof Error) {
    return { status: 0, message: error.message, code: 'UNKNOWN' };
  }
  return { status: 0, message: 'Erreur inconnue', code: 'UNKNOWN' };
}
