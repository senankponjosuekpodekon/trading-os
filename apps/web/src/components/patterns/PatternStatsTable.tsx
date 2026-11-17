'use client';

import { PatternStats } from '@/types';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface PatternStatsTableProps {
  patterns: Record<string, PatternStats>;
}

export function PatternStatsTable({ patterns }: PatternStatsTableProps) {
  // Tri : winRate décroissant, null (pas d'outcome résolu) en dernier
  const entries = Object.entries(patterns).sort((a, b) => (b[1].winRate ?? -1) - (a[1].winRate ?? -1));

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950">
      <table className="w-full text-sm text-gray-300">
        <thead className="bg-gray-900 text-gray-400">
          <tr>
            <th className="px-4 py-3 text-left">Pattern</th>
            <th className="px-4 py-3 text-right" title="Outcomes résolus / total logs">Résolus</th>
            <th className="px-4 py-3 text-right">W/L</th>
            <th className="px-4 py-3 text-right">Win rate</th>
            <th className="px-4 py-3 text-right">Espérance (R)</th>
            <th className="px-4 py-3 text-right">Realized %</th>
            <th className="px-4 py-3 text-right">Avg confluence</th>
            <th className="px-4 py-3 text-right">Expected %</th>
            <th className="px-4 py-3 text-right">Realized %</th>
            <th className="px-4 py-3 text-right">Durée moy.</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, s]) => {
            const lowSample = (s.resolved ?? 0) < 20;
            return (
            <tr key={name} className={`border-t border-gray-800 hover:bg-gray-900/50 ${lowSample ? 'opacity-45' : ''}`}
                title={lowSample ? 'Échantillon résolu < 20 — statistiques non fiables' : undefined}>
              <td className="px-4 py-3 font-medium text-white">
                {name}
                {lowSample && <span className="ml-2 text-[10px] font-normal text-amber-400">n faible</span>}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs">
                <span className="text-gray-200">{s.resolved ?? 0}</span>
                <span className="text-gray-600">/{s.trades}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs">
                <span className="text-emerald-400">{s.wins}</span>
                <span className="text-gray-500"> / </span>
                <span className="text-red-400">{s.losses}</span>
              </td>
              <td className="px-4 py-3 text-right">
                {s.winRate == null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                <span className={`inline-flex items-center gap-1 ${s.winRate >= 55 ? 'text-green-400' : s.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {s.winRate >= 55 ? <TrendingUp size={14} /> : s.winRate < 45 ? <TrendingDown size={14} /> : <BarChart3 size={14} />}
                  {s.winRate}%
                </span>
                )}
              </td>
              <td className={`px-4 py-3 text-right font-mono ${s.avgR != null ? (s.avgR >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500'}`}>
                {s.avgR != null ? `${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R` : '—'}
              </td>
              <td className="px-4 py-3 text-right">{s.avgRealizedPnl != null ? `${s.avgRealizedPnl >= 0 ? '+' : ''}${s.avgRealizedPnl.toFixed(2)}%` : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgConfluence != null ? s.avgConfluence.toFixed(2) : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgExpectedPnl != null ? `${s.avgExpectedPnl.toFixed(2)}%` : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgDuration != null ? `${Math.round(s.avgDuration)} bars` : '—'}</td>
            </tr>
          );
          })}
          {entries.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-6 text-center text-gray-500">
                Aucune statistique de pattern disponible.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
