'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav } from './BottomNav';

export function AppLayout({ children, title }: { children: React.ReactNode; title: string }) {
  const { user, init } = useAuthStore();
  const router = useRouter();
  const initialized = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    init();
    setReady(true);
  }, []);

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
    <div className="flex min-h-screen bg-gray-950">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden pb-16 md:pb-0">
        <Topbar title={title} />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
