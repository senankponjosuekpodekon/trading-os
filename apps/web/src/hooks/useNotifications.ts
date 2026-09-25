'use client';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';

export interface AppNotification {
  id:        string;
  type:      'SIGNAL' | 'POSITION' | 'ALERT' | 'SYSTEM';
  title:     string;
  message:   string;
  data?:     any;
  createdAt: string;
  read:      boolean;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_URL  = `${API_BASE}/api`;

// Connexion SSE partagée au niveau module : survit aux remounts de AppLayout
// (un par navigation) au lieu de reconnecter à chaque changement de page.
let es: EventSource | null = null;
let esUserId: string | null = null;
let connecting = false;
let retryDelay = 3000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<(n: AppNotification) => void>();

function broadcast(data: string) {
  try {
    const parsed = JSON.parse(data);
    if (parsed.type === 'heartbeat') return;
    const n: AppNotification = { ...parsed, read: false };
    subscribers.forEach((cb) => cb(n));
  } catch {}
}

function scheduleRetry(userId: string) {
  if (retryTimer) return;
  retryDelay = Math.min(retryDelay * 1.5, 60_000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureConnection(userId);
  }, retryDelay);
}

async function ensureConnection(userId: string) {
  if (esUserId !== userId) {
    es?.close();
    es = null;
    esUserId = userId;
  }
  if (es || connecting) return;
  connecting = true;

  try {
    const res = await fetch(`${API_URL}/notifications/sse-token`, {
      credentials: 'include',
    });
    if (res.status === 401) return;
    if (!res.ok) throw new Error('Failed to get SSE token');
    const { sseToken } = await res.json();

    es = new EventSource(`${API_URL}/notifications/stream?sse_token=${sseToken}`);
    es.onopen = () => { retryDelay = 3000; };
    es.onmessage = (e) => broadcast(e.data);
    es.addEventListener('signal', (e: any) => broadcast(e.data));
    es.onerror = () => {
      es?.close();
      es = null;
      scheduleRetry(userId);
    };

    // Reconnexion proactive toutes les 4 min (le token SSE expire en 5 min)
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        es?.close();
        es = null;
        void ensureConnection(userId);
      }, 4 * 60 * 1000);
    }
  } catch {
    scheduleRetry(userId);
  } finally {
    connecting = false;
  }
}

// Réinitialise le singleton — usage réservé aux tests
export function __resetNotificationsConnection() {
  es?.close();
  es = null;
  esUserId = null;
  connecting = false;
  retryDelay = 3000;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  subscribers.clear();
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread]               = useState(0);
  const user                              = useAuthStore(s => s.user);

  useEffect(() => {
    if (!user) return;
    const uid = user.id;

    // Hydratation : notifs persistées en DB — visibles après restart/redeploy
    fetch(`${API_URL}/notifications`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: AppNotification[]) => {
        setNotifications(rows.slice(0, 50));
        setUnread(rows.filter(n => !n.read).length);
      })
      .catch(() => {});

    const cb = (n: AppNotification) => {
      setNotifications(prev => [n, ...prev].slice(0, 50));
      setUnread(u => u + 1);
    };
    subscribers.add(cb);
    void ensureConnection(uid);

    // On ne ferme PAS la connexion au unmount : elle est partagée et survit
    // aux navigations. Elle meurt avec le module (logout = hard reload).
    return () => { subscribers.delete(cb); };
  }, [user]);

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
    fetch(`${API_URL}/notifications/read-all`, {
      method: 'PATCH',
      credentials: 'include',
    }).catch(() => {});
  };

  return { notifications, unread, markAllRead };
}
