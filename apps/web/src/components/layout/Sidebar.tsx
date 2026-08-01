'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Briefcase, BookOpen, Layers,
  Settings, LogOut, Zap, FlaskConical, LineChart, Brain, Globe, Activity, Beaker, MessageSquare,
  ShieldAlert, Trophy, Search, Cpu, Calendar, Database, SlidersHorizontal, DatabaseBackup, BarChart3, Eye,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { clsx } from 'clsx';

const nav = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/scanner',   label: 'Scanner',    icon: Search },
  { href: '/signals',    label: 'Signaux',     icon: TrendingUp },
  { href: '/chart',      label: 'Graphique',   icon: LineChart },
  { href: '/portfolio',  label: 'Portfolio',   icon: Briefcase },
  { href: '/risk',       label: 'Risk',        icon: ShieldAlert },
  { href: '/performance', label: 'Performance', icon: Trophy },
  { href: '/backtest',   label: 'Backtest',    icon: FlaskConical },
  { href: '/patterns',  label: 'Patterns',      icon: BarChart3 },
  { href: '/features',   label: 'Features',   icon: SlidersHorizontal },
  { href: '/phase-b',    label: 'Phase B',    icon: Layers },
  { href: '/lab',        label: 'Lab',         icon: Beaker },
  { href: '/copilot',    label: 'Copilot',     icon: MessageSquare },
  { href: '/ai',         label: 'Assistant IA', icon: Brain },
  { href: '/memory',     label: 'Mémoire',     icon: DatabaseBackup },
  { href: '/brvm',       label: 'BRVM',         icon: Globe },
  { href: '/synthetic',   label: 'Synthetic',    icon: Cpu },
  { href: '/deriv',      label: 'Deriv V75',    icon: Activity },
  { href: '/onchain',    label: 'On-chain',    icon: Database },
  { href: '/observability', label: 'Observability', icon: Eye },
  { href: '/economic-calendar', label: 'Calendrier', icon: Calendar },
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
