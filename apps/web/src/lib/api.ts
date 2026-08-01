import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function getAccessToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('trading_os_token');
}

function setTokens(accessToken: string, refreshToken: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('trading_os_token', accessToken);
  localStorage.setItem('trading_os_refresh_token', refreshToken);
}

function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('trading_os_token');
  localStorage.removeItem('trading_os_refresh_token');
  localStorage.removeItem('trading_os_user');
}

async function doRefresh() {
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('trading_os_refresh_token') : null;
  const body = refreshToken ? { refresh_token: refreshToken } : {};
  const { data } = await axios.post(`${API_URL}/api/auth/refresh`, body, { withCredentials: true });
  if (data.access_token) setTokens(data.access_token, data.refresh_token);
  return data.access_token as string;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && typeof window !== 'undefined' && !original._retry) {
      original._retry = true;

      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const newToken = await doRefresh();
          isRefreshing = false;
          onRefreshed(newToken);
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        } catch {
          isRefreshing = false;
          clearTokens();
          window.location.href = '/auth/login';
          return Promise.reject(err);
        }
      }

      return new Promise((resolve) => {
        addRefreshSubscriber((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }
    return Promise.reject(err);
  },
);
