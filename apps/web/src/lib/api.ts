import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && typeof window !== 'undefined' && !original._retry) {
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

      return new Promise((resolve) => {
        addRefreshSubscriber(() => {
          resolve(api(original));
        });
      });
    }
    return Promise.reject(err);
  },
);
