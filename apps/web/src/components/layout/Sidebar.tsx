'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Briefcase, BookOpen,
  Settings, LogOut, Zap, FlaskConical, LineChart, Brain, Globe, Activity,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { clsx } from 'clsx';

const nav = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/signals',    label: 'Signaux',     icon: TrendingUp },
  { href: '/chart',      label: 'Graphique',   icon: LineChart },
  { href: '/portfolio',  label: 'Portfolio',   icon: Briefcase },
  { href: '/backtest',   label: 'Backtest',    icon: FlaskConical },
  { href: '/ai',         label: 'Assistant IA', icon: Brain },
  { href: '/brvm',       label: 'BRVM',         icon: Globe },
  { href: '/deriv',      label: 'Deriv V75',    icon: Activity },
  { href: '/journal',    label: 'Journal',     icon: BookOpen },
  { href: '/settings',   label: 'Paramètres',  icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const logout  = useAuthStore((s) => s.logout);

  return (
    <aside className="w-64 h-screen sticky top-0 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      <div className="p-6 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-emerald-400" />
          <span className="text-lg font-bold text-white">Trading OS</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">AI Investment System</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'text-gray-400 hover:text-white hover:bg-gray-800',
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800 shrink-0">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
