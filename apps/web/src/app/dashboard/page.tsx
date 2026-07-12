'use client';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Briefcase, Activity, ArrowUpRight, ArrowDownRight, Zap, BookOpen, Brain, BarChart2, Globe, Cpu } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { Portfolio, Signal, PortfolioSummary } from '@/types';
import { useLivePrices } from '@/hooks/useLivePrices';
import Link from 'next/link';

function StatCard({ label, value, sub, trend, icon }: { label: string; value: string | React.ReactNode; sub?: string; trend?: 'up' | 'down' | 'neutral'; icon?: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">{label}</p>
        {icon && <span className="text-gray-600">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && (
        <div className={`flex items-center gap-1 mt-1 text-xs ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-gray-500'}`}>
          {trend === 'up' && <ArrowUpRight className="w-3 h-3" />}
          {trend === 'down' && <ArrowDownRight className="w-3 h-3" />}
          {sub}
        </div>
      )}
    </div>
  );
}

const LIVE_SYMBOLS = [
  { key: 'BTCUSDT',  label: 'BTC' },
  { key: 'ETHUSDT',  label: 'ETH' },
  { key: 'SOLUSDT',  label: 'SOL' },
  { key: 'BNBUSDT',  label: 'BNB' },
  { key: 'AVAXUSDT', label: 'AVAX' },
  { key: 'XRPUSDT',  label: 'XRP' },
  { key: 'EURUSDT',  label: 'EUR/USD' },
  { key: 'PAXGUSDT', label: 'Gold' },
];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { prices, connected } = useLivePrices();

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const portfolio = portfolios?.[0];

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['positions-summary', portfolio?.id],
    queryFn: async () => (await api.get(`/positions/summary?portfolioId=${portfolio!.id}`)).data,
    enabled: !!portfolio?.id,
  });

  const { data: signals } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn: async () => (await api.get('/signals?limit=5')).data.data,
    refetchInterval: 60_000,
  });

  const capital = portfolio ? parseFloat(portfolio.currentCapital) : 0;
  const initial = portfolio ? parseFloat(portfolio.initialCapital) : 0;
  const pnl     = summary?.totalPnl ?? (capital - initial);
  const pnlPct  = initial > 0 ? ((pnl / initial) * 100).toFixed(2) : '0.00';
  const winRate  = summary?.winRate ?? 0;
  const activeSignals = signals?.length ?? 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';

  return (
    <AppLayout title="Dashboard">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">{greeting}, {user?.name?.split(' ')[0]} 👋</h2>
            <p className="text-gray-400 text-sm mt-0.5">{new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          <Link href="/signals" className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors">
            <Zap className="w-4 h-4" />Scanner les marchés
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {!portfolio
            ? [0,1,2,3].map(i => <SkeletonCard key={i} />)
            : <>
              <StatCard
                label="Capital disponible"
                value={`$${capital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}`}
                sub={`${pnl >= 0 ? '+' : ''}${pnlPct}% vs capital initial`}
                trend={pnl >= 0 ? 'up' : 'down'}
                icon={<Briefcase className="w-4 h-4" />}
              />
              <StatCard
                label="P&L total"
                value={<span className={pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>}
                sub={`${summary?.closed ?? 0} trade(s) clôturé(s)`}
                trend={pnl >= 0 ? 'up' : 'down'}
                icon={pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              />
              <StatCard
                label="Positions ouvertes"
                value={String(summary?.open ?? 0)}
                sub={`Win rate : ${winRate > 0 ? winRate.toFixed(1) + '%' : '—'}`}
                trend="neutral"
                icon={<Activity className="w-4 h-4" />}
              />
              <StatCard
                label="Signaux actifs"
                value={String(activeSignals)}
                sub={activeSignals > 0 ? 'Voir les signaux →' : 'Lancer un scan'}
                trend={activeSignals > 0 ? 'up' : 'neutral'}
                icon={<Zap className="w-4 h-4" />}
              />
            </>
          }
        </div>

        {/* Raccourcis rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/signals',  label: 'Scanner',    desc: 'Lancer un scan',          icon: <Zap className="w-4 h-4" />,      color: 'text-emerald-400' },
            { href: '/backtest', label: 'Backtest',   desc: 'Tester une stratégie',    icon: <BarChart2 className="w-4 h-4" />, color: 'text-blue-400' },
            { href: '/brvm',     label: 'BRVM',       desc: 'Marché africain',          icon: <Globe className="w-4 h-4" />,    color: 'text-yellow-400' },
            { href: '/deriv',    label: 'Deriv V75',  desc: 'Scalp synthétiques',      icon: <Cpu className="w-4 h-4" />,      color: 'text-violet-400' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 flex items-center gap-3 transition-colors group">
              <span className={`${item.color} group-hover:scale-110 transition-transform`}>{item.icon}</span>
              <div>
                <p className="text-white text-sm font-medium">{item.label}</p>
                <p className="text-gray-500 text-xs">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Prix live */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {LIVE_SYMBOLS.map(({ key, label }) => {
            const price = prices[key];
            return (
              <div key={key} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-base font-mono font-bold text-white">
                    {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </p>
                </div>
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-700'}`} />
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Derniers signaux */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white">Derniers signaux</h3>
              </div>
              <Link href="/signals" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Voir tout →</Link>
            </div>
            {!signals || signals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-28 text-gray-600">
                <Activity className="w-7 h-7 mb-2" />
                <p className="text-sm">Aucun signal — lancez un scan</p>
              </div>
            ) : (
              <div className="space-y-2">
                {signals.slice(0, 4).map(s => {
                  const regime = s.metadata?.regime;
                  const fvg    = s.metadata?.smc?.fvg;
                  const ob     = s.metadata?.smc?.ob;
                  return (
                    <div key={s.id} className="py-2 border-b border-gray-800 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${s.signal === 'BUY' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>{s.signal}</span>
                          <span className="text-white text-sm font-medium">{s.asset?.symbol ?? '—'}</span>
                          <span className="text-gray-600 text-xs">{s.timeframe}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{Math.round(s.confidence)}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {regime?.regime && (
                          <span className={`text-[10px] px-1.5 py-0 rounded ${
                            regime.regime === 'TRENDING_BULL' ? 'bg-emerald-400/10 text-emerald-400' :
                            regime.regime === 'TRENDING_BEAR' ? 'bg-red-400/10 text-red-400' :
                            'bg-gray-700 text-gray-500'
                          }`}>{regime.regime.replace('_', ' ')}</span>
                        )}
                        {fvg?.near_bullish_fvg && <span className="text-[10px] px-1.5 py-0 rounded bg-cyan-400/10 text-cyan-400">FVG</span>}
                        {fvg?.near_bearish_fvg && <span className="text-[10px] px-1.5 py-0 rounded bg-rose-400/10 text-rose-400">FVG</span>}
                        {ob?.near_bullish_ob  && <span className="text-[10px] px-1.5 py-0 rounded bg-teal-400/10 text-teal-400">OB</span>}
                        {ob?.near_bearish_ob  && <span className="text-[10px] px-1.5 py-0 rounded bg-pink-400/10 text-pink-400">OB</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Portfolio recap */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-400" />
                <h3 className="font-semibold text-white">{portfolio?.name ?? 'Portfolio'}</h3>
                <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{portfolio?.type}</span>
              </div>
              <Link href="/portfolio" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Gérer →</Link>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Capital initial', value: `$${initial.toLocaleString()}` },
                { label: 'Capital actuel',  value: `$${capital.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}` },
                { label: 'P&L réalisé',     value: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, color: pnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: 'Win rate',         value: winRate > 0 ? `${winRate.toFixed(1)}%` : '—' },
                { label: 'Positions ouvertes', value: String(summary?.open ?? 0) },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">{row.label}</span>
                  <span className={`font-medium ${(row as any).color ?? 'text-white'}`}>{row.value}</span>
                </div>
              ))}
            </div>
            <Link href="/journal" className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              <BookOpen className="w-3.5 h-3.5" />Ouvrir le journal de trading
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
