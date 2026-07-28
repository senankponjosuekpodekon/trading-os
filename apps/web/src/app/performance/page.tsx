'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Portfolio, PortfolioSummary, Position } from '@/types';
import {
  Trophy, TrendingUp, TrendingDown, BarChart3, Calendar, Target,
  Activity, ArrowUpRight, ArrowDownRight, Brain, ChevronUp, ChevronDown,
  Download, FileText,
} from 'lucide-react';
import { downloadCsv } from '@/lib/export';
import { downloadPerformancePDF } from '@/lib/pdf';

const MiniEquityChart = dynamic(
  () => import('@/components/backtest/MiniEquityChart').then(mod => mod.MiniEquityChart),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);

export default function PerformancePage() {
  const [selectedId, setSelectedId] = useState<string>('ALL');

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['positions-summary', selectedId],
    queryFn: async () => (await api.get(`/positions/summary?portfolioId=${selectedId}`)).data,
    enabled: !!portfolios,
  });

  const exportPositions = () => {
    if (!summary?.positions) return;
    downloadCsv(
      `performance-${selectedId}-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { header: 'Symbole', accessor: p => p.asset?.symbol ?? '—' },
        { header: 'Direction', accessor: p => p.direction },
        { header: 'Statut', accessor: p => p.status },
        { header: 'Entry', accessor: p => p.entryPrice },
        { header: 'Exit', accessor: p => p.exitPrice ?? '—' },
        { header: 'P&L', accessor: p => p.pnl ?? '—' },
        { header: 'P&L %', accessor: p => p.pnlPercent ?? '—' },
        { header: 'Ouvert', accessor: p => p.openedAt ? new Date(p.openedAt).toISOString() : '—' },
        { header: 'Clôturé', accessor: p => p.closedAt ? new Date(p.closedAt).toISOString() : '—' },
      ],
      summary.positions,
    );
  };

  const exportPdf = async () => {
    if (!stats || !summary?.positions) return;
    await downloadPerformancePDF(
      {
        closedCount: stats.closedCount,
        winRate: summary.winRate,
        totalPnl: stats.totalPnl,
        profitFactor: stats.profitFactor === Infinity ? 'Infinity' : stats.profitFactor,
        avgWin: stats.avgWin,
        avgLoss: stats.avgLoss,
        expectancy: stats.expectancy,
        maxDrawdown: stats.maxDrawdown,
      },
      summary.positions,
      `rapport-performance-${selectedId}-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
  };

  const stats = useMemo(() => {
    if (!summary) return null;
    const closed = (summary.positions ?? []).filter(p => p.status === 'CLOSED');
    const wins = closed.filter(p => parseFloat(p.pnl ?? '0') > 0);
    const losses = closed.filter(p => parseFloat(p.pnl ?? '0') <= 0);

    const totalPnl = closed.reduce((sum, p) => sum + parseFloat(p.pnl ?? '0'), 0);
    const grossProfit = wins.reduce((sum, p) => sum + parseFloat(p.pnl ?? '0'), 0);
    const grossLoss = Math.abs(losses.reduce((sum, p) => sum + parseFloat(p.pnl ?? '0'), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const expectancy = closed.length > 0
      ? ((wins.length / closed.length) * avgWin) - ((losses.length / closed.length) * avgLoss)
      : 0;

    const sorted = [...closed].sort((a, b) => new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime());
    const equity: number[] = [];
    let running = 0;
    sorted.forEach(p => {
      running += parseFloat(p.pnl ?? '0');
      equity.push(running);
    });

    const best = closed.length > 0 ? closed.reduce((max, p) => parseFloat(p.pnl ?? '0') > parseFloat(max.pnl ?? '0') ? p : max, closed[0]) : null;
    const worst = closed.length > 0 ? closed.reduce((min, p) => parseFloat(p.pnl ?? '0') < parseFloat(min.pnl ?? '0') ? p : min, closed[0]) : null;

    let maxDrawdown = 0;
    let peak = 0;
    equity.forEach(v => {
      if (v > peak) peak = v;
      const dd = peak - v;
      if (dd > maxDrawdown) maxDrawdown = dd;
    });

    return {
      closedCount: closed.length,
      winRate: summary.winRate,
      totalPnl,
      profitFactor,
      avgWin,
      avgLoss,
      expectancy,
      equity,
      maxDrawdown,
      best,
      worst,
    };
  }, [summary]);

  return (
    <AppLayout title="Performance">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-emerald-400" />Performance
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Métriques, courbe de capital et meilleurs setups</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportPositions}
              disabled={!summary?.positions?.length}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50 transition-colors"
            >
              <Download className="w-4 h-4" />CSV
            </button>
            <button
              onClick={exportPdf}
              disabled={!summary?.positions?.length}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50 transition-colors"
            >
              <FileText className="w-4 h-4" />PDF
            </button>
            <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">Tous les portfolios</option>
            {portfolios?.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
            ))}
          </select>
          </div>
        </div>

        {!stats ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Trades clôturés" value={String(stats.closedCount)} sub={`${stats.winRate.toFixed(1)}% win rate`} trend={stats.winRate >= 50 ? 'up' : 'down'} icon={<Target className="w-4 h-4" />} />
              <MetricCard label="P&L total" value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`} sub="réalisé" trend={stats.totalPnl >= 0 ? 'up' : 'down'} icon={stats.totalPnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />} />
              <MetricCard label="Profit Factor" value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} sub={stats.profitFactor >= 1.5 ? 'Solide' : stats.profitFactor >= 1 ? 'OK' : 'Négatif'} trend={stats.profitFactor >= 1.5 ? 'up' : 'down'} icon={<BarChart3 className="w-4 h-4" />} />
              <MetricCard label="Expectancy" value={`$${stats.expectancy.toFixed(2)}`} sub="gain moyen par trade" trend={stats.expectancy >= 0 ? 'up' : 'down'} icon={<Activity className="w-4 h-4" />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />Courbe de capital
                </h3>
                {stats.equity.length > 1 ? (
                  <MiniEquityChart curve={stats.equity} />
                ) : (
                  <div className="text-center py-10 text-gray-600 text-sm">Pas assez de trades pour tracer la courbe</div>
                )}
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Max drawdown</span>
                  <span className="text-red-400 font-mono">-${stats.maxDrawdown.toFixed(2)}</span>
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />Statistiques
                </h3>
                <StatRow label="Gain moyen" value={`+$${stats.avgWin.toFixed(2)}`} positive />
                <StatRow label="Perte moyenne" value={`-$${stats.avgLoss.toFixed(2)}`} positive={false} />
                <StatRow label="Ratio G/P" value={stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss).toFixed(2) : '—'} positive={stats.avgWin / stats.avgLoss >= 1} />
                <StatRow label="Trades gagnants" value={`${(summary?.winRate ?? 0).toFixed(1)}%`} positive={(summary?.winRate ?? 0) >= 50} />
              </div>
            </div>

            {(stats.best || stats.worst) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stats.best && (
                  <TradeCard title="Meilleur trade" position={stats.best} positive />
                )}
                {stats.worst && (
                  <TradeCard title="Pire trade" position={stats.worst} positive={false} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function MetricCard({ label, value, sub, trend, icon }: { label: string; value: string; sub: string; trend: 'up' | 'down'; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">{label}</p>
        <span className={trend === 'up' ? 'text-emerald-400' : 'text-red-400'}>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <div className={`flex items-center gap-1 mt-1 text-xs ${trend === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
        {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {sub}
      </div>
    </div>
  );
}

function StatRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-mono font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
    </div>
  );
}

function TradeCard({ title, position, positive }: { title: string; position: Position; positive: boolean }) {
  const pnl = parseFloat(position.pnl ?? '0');
  const pnlPct = parseFloat(position.pnlPercent ?? '0');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [review, setReview] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  const handleReview = async () => {
    if (reviewOpen) {
      setReviewOpen(false);
      return;
    }
    setReviewLoading(true);
    try {
      const { data } = await api.post(`/ai/review/position/${position.id}`, {});
      setReview(typeof data.review === 'string' ? data.review : JSON.stringify(data, null, 2));
    } catch {
      setReview('Impossible de générer la review IA pour le moment.');
    }
    setReviewLoading(false);
    setReviewOpen(true);
  };

  return (
    <div className={`bg-gray-900 border rounded-xl p-5 ${positive ? 'border-emerald-500/20' : 'border-red-500/20'}`}>
      <h4 className={`text-sm font-medium mb-3 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{title}</h4>
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-semibold">{position.asset?.symbol ?? '—'}</span>
        <span className={`text-lg font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
        </span>
      </div>
      <div className="text-xs text-gray-500 space-y-1 mb-4">
        <p>Direction : <span className="text-gray-300">{position.direction}</span></p>
        <p>Entry : <span className="text-gray-300">${parseFloat(position.entryPrice).toLocaleString()}</span></p>
        <p>Exit : <span className="text-gray-300">${position.exitPrice ? parseFloat(position.exitPrice).toLocaleString() : '—'}</span></p>
        <p>P&L % : <span className={pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pnlPct.toFixed(2)}%</span></p>
      </div>
      <button
        onClick={handleReview}
        disabled={reviewLoading}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-50 transition-colors font-medium"
      >
        <Brain className="w-3 h-3" />
        {reviewLoading ? 'Analyse IA...' : reviewOpen ? 'Masquer l\'IA' : 'Review IA'}
        {reviewOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {reviewOpen && (
        <div className="mt-3 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3 h-3 text-violet-400" />
            <span className="text-xs font-medium text-violet-400">Analyse post-trade</span>
          </div>
          <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">{review}</p>
        </div>
      )}
    </div>
  );
}
