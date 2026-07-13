'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav } from './BottomNav';

export function AppLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const { user, init } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const initialized = useRef(false);
  const prefetched = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    init();
    setReady(true);
  }, []);

  useEffect(() => {
    if (!user || prefetched.current) return;
    prefetched.current = true;
    qc.prefetchQuery({ queryKey: ['portfolios'],  queryFn: async () => (await api.get('/portfolios')).data,        staleTime: 60_000 });
    qc.prefetchQuery({ queryKey: ['signals'],     queryFn: async () => (await api.get('/signals?limit=5')).data.data, staleTime: 60_000 });
  }, [user, qc]);

  useEffect(() => {
    if (!ready) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem('trading_os_token') : null;
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
