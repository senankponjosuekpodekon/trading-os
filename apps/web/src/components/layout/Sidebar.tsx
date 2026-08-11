'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Briefcase, BookOpen, Layers,
  Settings, LogOut, Zap, FlaskConical, LineChart, Brain, Globe, Activity, Beaker, MessageSquare,
  ShieldAlert, Trophy, Search, Cpu, Calendar, Database, SlidersHorizontal, DatabaseBackup, BarChart3, Eye,
  Radio, Key, Send, Newspaper,
  Gem, Scale, Youtube, Rocket, Users,
  ChevronDown, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { clsx } from 'clsx';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

interface NavGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

const groups: NavGroup[] = [
  {
    title: 'Trading',
    icon: TrendingUp,
    items: [
      { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
      { href: '/scanner',    label: 'Scanner',    icon: Search },
      { href: '/signals',    label: 'Signaux',    icon: TrendingUp },
      { href: '/chart',      label: 'Graphique',  icon: LineChart },
    ],
  },
  {
    title: 'Portfolio',
    icon: Briefcase,
    items: [
      { href: '/portfolio',   label: 'Portfolio',   icon: Briefcase },
      { href: '/risk',        label: 'Risk',        icon: ShieldAlert },
      { href: '/performance', label: 'Performance', icon: Trophy },
      { href: '/journal',     label: 'Journal',     icon: BookOpen },
    ],
  },
  {
    title: 'Analysis',
    icon: BarChart3,
    items: [
      { href: '/patterns',            label: 'Patterns',    icon: BarChart3 },
      { href: '/features',            label: 'Features',    icon: SlidersHorizontal },
      { href: '/backtest',            label: 'Backtest',    icon: FlaskConical },
      { href: '/scientific-backtest', label: 'Scientific',  icon: BarChart3 },
      { href: '/lab',                 label: 'Lab',         icon: Beaker },
      { href: '/phase-b',             label: 'Phase B',     icon: Layers },
    ],
  },
  {
    title: 'AI & Insights',
    icon: Brain,
    items: [
      { href: '/daily-pulse',  label: 'Daily Pulse',   icon: Newspaper },
      { href: '/sentiment',    label: 'Sentiment',     icon: Youtube },
      { href: '/hidden-gems',  label: 'Hidden Gems',   icon: Gem },
      { href: '/pre-listing',  label: 'Pre-Listing',   icon: Rocket },
      { href: '/ai-defense',   label: 'AI Defense',    icon: ShieldAlert },
      { href: '/rebalancing',  label: 'Rebalancing',   icon: Scale },
      { href: '/copilot',      label: 'Copilot',       icon: MessageSquare },
      { href: '/ai',           label: 'Assistant IA',  icon: Brain },
      { href: '/memory',       label: 'Mémoire',       icon: DatabaseBackup },
    ],
  },
  {
    title: 'Markets',
    icon: Globe,
    items: [
      { href: '/brvm',              label: 'BRVM',        icon: Globe },
      { href: '/synthetic',         label: 'Synthetic',   icon: Cpu },
      { href: '/deriv',             label: 'Deriv V75',   icon: Activity },
      { href: '/onchain',           label: 'On-chain',    icon: Database },
      { href: '/macro-rotation',    label: 'Rotation',    icon: TrendingUp },
      { href: '/economic-calendar', label: 'Calendrier',  icon: Calendar },
    ],
  },
  {
    title: 'System',
    icon: Settings,
    items: [
      { href: '/observability',          label: 'Observability', icon: Eye,        adminOnly: true },
      { href: '/admin',                  label: 'Admin',         icon: ShieldAlert, adminOnly: true },
      { href: '/admin/users',            label: 'Utilisateurs',  icon: Users,       adminOnly: true },
      { href: '/admin/ops',              label: 'Ops Système',   icon: Activity,    adminOnly: true },
      { href: '/channels',               label: 'Canaux',        icon: Radio },
      { href: '/settings/exchanges',     label: 'Exchanges',     icon: Key },
      { href: '/settings/distribution',  label: 'Distribution',  icon: Send },
      { href: '/settings/llm',           label: 'LLM Config',    icon: Cpu },
      { href: '/settings',               label: 'Paramètres',    icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const logout = useAuthStore((s) => s.logout);
  const user   = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const initialOpen = groups
    .map(g => g.title)
    .filter(title =>
      groups.find(g => g.title === title)!.items.some(
        item => pathname.startsWith(item.href) && (item.href !== '/' || pathname === item.href)
      )
    );
  const [openGroups, setOpenGroups] = useState<string[]>(initialOpen.length ? initialOpen : ['Trading']);

  function toggleGroup(title: string) {
    setOpenGroups(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  }

  function isItemActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="w-64 h-screen sticky top-0 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
      <div className="p-6 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-emerald-400" />
          <span className="text-lg font-bold text-white">Trading OS</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">AI Investment System</p>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {groups.map(group => {
          const visibleItems = group.items.filter(item => !item.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;

          const isOpen = openGroups.includes(group.title);
          const hasActive = visibleItems.some(item => isItemActive(item.href));
          const GroupIcon = group.icon;

          return (
            <div key={group.title} className="mb-1">
              <button
                onClick={() => toggleGroup(group.title)}
                className={clsx(
                  'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors',
                  hasActive
                    ? 'text-emerald-400'
                    : 'text-gray-500 hover:text-gray-300',
                )}
              >
                <GroupIcon className="w-4 h-4" />
                <span className="flex-1 text-left">{group.title}</span>
                <ChevronDown
                  className={clsx(
                    'w-3.5 h-3.5 transition-transform',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>

              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      className={clsx(
                        'flex items-center gap-3 pl-9 pr-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        isItemActive(href)
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
