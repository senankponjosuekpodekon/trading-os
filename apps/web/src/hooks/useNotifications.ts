'use client';
import { useEffect, useState, useRef } from 'react';
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

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread]               = useState(0);
  const token                             = useAuthStore(s => s.token);
  const esRef                             = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token) return;

    let retryDelay = 3000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = async () => {
      if (stopped) return;

      try {
        const res = await fetch(`${API_URL}/notifications/sse-token`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to get SSE token');
        const { sseToken } = await res.json();

        const es = new EventSource(`${API_URL}/notifications/stream?sse_token=${sseToken}`);
        esRef.current = es;

        es.onopen = () => { retryDelay = 3000; };

        const handleNotif = (data: string) => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'heartbeat') return;
            const n: AppNotification = { ...parsed, read: false };
            setNotifications(prev => [n, ...prev].slice(0, 50));
            setUnread(u => u + 1);
          } catch {}
        };

        es.onmessage = (e) => handleNotif(e.data);
        es.addEventListener('signal', (e: any) => handleNotif(e.data));

        es.onerror = () => {
          es.close();
          if (stopped) return;
          retryDelay = Math.min(retryDelay * 1.5, 60_000);
          retryTimer = setTimeout(connect, retryDelay);
        };
      } catch {
        if (stopped) return;
        retryDelay = Math.min(retryDelay * 1.5, 60_000);
        retryTimer = setTimeout(connect, retryDelay);
      }
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
    };
  }, [token]);

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
  };

  return { notifications, unread, markAllRead };
}
