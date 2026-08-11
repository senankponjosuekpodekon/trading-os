'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingUp, Briefcase, MessageSquare, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

const nav = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/signals',   label: 'Signaux',  icon: TrendingUp },
  { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { href: '/copilot',   label: 'Copilot',   icon: MessageSquare },
  { href: '/admin',     label: 'Admin',     icon: ShieldAlert },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-800">
      <div className="flex items-center justify-around h-16">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex flex-col items-center justify-center gap-0.5 w-full h-full text-[10px] font-medium transition-colors',
              pathname.startsWith(href)
                ? 'text-emerald-400'
                : 'text-gray-500 hover:text-gray-300',
            )}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
