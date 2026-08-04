'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { useNotifications } from '@/hooks/useNotifications';
import { useToast } from '@/hooks/useToast';
import { api } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav } from './BottomNav';

const TYPE_TOAST_TYPE: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  SIGNAL:   'success',
  POSITION: 'info',
  ALERT:    'warning',
  SYSTEM:   'info',
};

export function AppLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const { user, init } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { notifications } = useNotifications();
  const lastShownRef = useRef<string | null>(null);
  const initialized = useRef(false);
  const prefetched = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    init();
    setReady(true);
  }, [init]);

  useEffect(() => {
    if (!user || prefetched.current) return;
    prefetched.current = true;
    const abort = new AbortController();
    qc.prefetchQuery({
      queryKey: ['portfolios'],
      queryFn: async () => (await api.get('/portfolios', { signal: abort.signal })).data,
      staleTime: 60_000,
    });
    qc.prefetchQuery({
      queryKey: ['signals'],
      queryFn: async () => (await api.get('/signals?limit=5', { signal: abort.signal })).data.data,
      staleTime: 60_000,
    });
    return () => abort.abort();
  }, [user, qc]);

  useEffect(() => {
    if (notifications.length === 0) return;
    const latest = notifications[0];
    if (latest.id === lastShownRef.current) return;
    lastShownRef.current = latest.id;
    let message = latest.message;
    if (latest.type === 'SIGNAL') {
      const lines: string[] = [latest.message];
      const data = latest.data ?? {};
      if (data.expectedMove) {
        const em = latest.data.expectedMove;
        const movePart = em.move_pct != null ? `±${em.move_pct.toFixed(2)}%` : null;
        const regimePart = em.volatility_regime ? `${em.volatility_regime} vol` : null;
        const horizonPart = em.horizon ? `${em.horizon} barres` : null;
        const extras = [movePart, horizonPart, regimePart].filter(Boolean).join(' · ');
        if (extras) {
          lines.push(extras);
        }
      }
      if (data.mlConfidence != null) {
        lines.push(`ML confidence ${data.mlConfidence.toFixed(1)}%`);
      }
      if (data.mlRegime) {
        lines.push(`ML regime ${data.mlRegime}`);
      }
      message = lines.join('\n');
    }
    toast(message, { title: latest.title, type: TYPE_TOAST_TYPE[latest.type] ?? 'info' });
  }, [notifications, toast]);

  useEffect(() => {
    if (!ready) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem('trading_os_user') : null;
    if (!stored) router.replace('/auth/login');
  }, [ready, router]);

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
