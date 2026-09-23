'use client';
import { usePathname } from 'next/navigation';
import { AppLayout } from '@/components/layout/AppLayout';

// Titre dérivé du pathname — les entrées les plus spécifiques avant les préfixes.
const TITLES: [string, string][] = [
  ['/settings/distribution', 'Distribution de signaux'],
  ['/settings/exchanges', 'Connexions Exchange'],
  ['/settings/llm', 'Configuration LLM'],
  ['/settings/markets', 'Marchés actifs'],
  ['/settings/2fa', '2FA'],
  ['/settings', 'Paramètres'],
  ['/admin/users', 'Gestion des utilisateurs'],
  ['/admin/logs', 'Logs système'],
  ['/admin/ops', 'Gestion des crons'],
  ['/admin/waitlist', 'Waitlist maintenance'],
  ['/admin', 'Admin Dashboard'],
  ['/signals', 'Signaux'],
  ['/scientific-backtest', 'Scientific Backtest'],
  ['/economic-calendar', 'Calendrier économique'],
  ['/macro-rotation', 'Macro Rotation'],
  ['/price-alerts', 'Alertes prix'],
  ['/hidden-gems', 'Hidden Gems'],
  ['/early-alpha', 'Early Alpha'],
  ['/pre-listing', 'Pre-Listing'],
  ['/daily-pulse', 'Daily Pulse'],
  ['/data-sources', 'Data Sources'],
  ['/observability', 'IO Observability'],
  ['/ai-defense', 'AI Defense'],
  ['/market-memory', 'Market Memory'],
  ['/memory', 'Market Memory'],
  ['/backtest', 'Backtest'],
  ['/sentiment', 'Sentiment'],
  ['/synthetic', 'Synthetic Markets'],
  ['/rebalancing', 'Rebalancing'],
  ['/performance', 'Performance'],
  ['/portfolio', 'Portfolio'],
  ['/portfolios', 'Portfolios'],
  ['/dashboard', 'Dashboard'],
  ['/channels', 'Canaux de signaux'],
  ['/onchain', 'On-chain'],
  ['/africa', 'African Markets'],
  ['/journal', 'Journal de trading'],
  ['/heatmap', 'Heatmap marchés'],
  ['/reports', 'Rapports quotidiens'],
  ['/patterns', 'Patterns & Feedback Loop'],
  ['/features', 'Feature Factory'],
  ['/phase-b', 'Phase B'],
  ['/billing', 'Abonnement'],
  ['/copilot', 'Trading Copilot'],
  ['/audit', 'Audit trail'],
  ['/deriv', 'Deriv Indices'],
  ['/brvm', 'BRVM'],
  ['/lab', 'Testeur Lab'],
  ['/risk', 'Risk Management'],
  ['/scanner', 'Scanner'],
  ['/ai', 'Assistant IA'],
];

function titleFor(pathname: string): string {
  const match = TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return match?.[1] ?? 'Trading OS';
}

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <AppLayout title={titleFor(pathname)}>{children}</AppLayout>;
}
