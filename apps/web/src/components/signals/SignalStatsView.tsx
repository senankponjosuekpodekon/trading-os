'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SignalStats {
  total: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  winRate: number;
  profitFactor: number;
  avgPnl: number;
  avgMae: number;
  avgMfe: number;
}

export function SignalStatsView() {
  const [stats, setStats] = useState<SignalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/signals/execution-stats')
      .then(res => setStats(res.data))
      .catch(() => setError('Impossible de charger les stats'))
      .finally(() => setLoading(false));
  }, []);

  const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );

  return (
    <div>
      {loading && <p className="text-gray-500">Chargement…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total" value={stats.total.toString()} />
          <StatCard label="Wins" value={stats.wins.toString()} sub={`${(stats.winRate * 100).toFixed(1)}%`} />
          <StatCard label="Losses" value={stats.losses.toString()} />
          <StatCard label="Expirés" value={stats.expired.toString()} />
          <StatCard label="Win Rate" value={`${(stats.winRate * 100).toFixed(1)}%`} />
          <StatCard label="Profit Factor" value={stats.profitFactor.toFixed(2)} />
          <StatCard label="PnL moyen" value={`${stats.avgPnl.toFixed(2)}%`} />
          <StatCard label="MAE moyen" value={`${stats.avgMae.toFixed(2)}%`} sub="Maximum Adverse Excursion" />
          <StatCard label="MFE moyen" value={`${stats.avgMfe.toFixed(2)}%`} sub="Maximum Favorable Excursion" />
        </div>
      )}
    </div>
  );
}
