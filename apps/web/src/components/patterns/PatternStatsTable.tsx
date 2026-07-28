'use client';

import { PatternStats } from '@/types';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface PatternStatsTableProps {
  patterns: Record<string, PatternStats>;
}

export function PatternStatsTable({ patterns }: PatternStatsTableProps) {
  const entries = Object.entries(patterns).sort((a, b) => b[1].winRate - a[1].winRate);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-950">
      <table className="w-full text-sm text-gray-300">
        <thead className="bg-gray-900 text-gray-400">
          <tr>
            <th className="px-4 py-3 text-left">Pattern</th>
            <th className="px-4 py-3 text-right">Trades</th>
            <th className="px-4 py-3 text-right">Win rate</th>
            <th className="px-4 py-3 text-right">P&L total</th>
            <th className="px-4 py-3 text-right">Avg confluence</th>
            <th className="px-4 py-3 text-right">Expected %</th>
            <th className="px-4 py-3 text-right">Realized %</th>
            <th className="px-4 py-3 text-right">Durée moy.</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, s]) => (
            <tr key={name} className="border-t border-gray-800 hover:bg-gray-900/50">
              <td className="px-4 py-3 font-medium text-white">{name}</td>
              <td className="px-4 py-3 text-right">{s.trades}</td>
              <td className="px-4 py-3 text-right">
                <span className={`inline-flex items-center gap-1 ${s.winRate >= 55 ? 'text-green-400' : s.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {s.winRate >= 55 ? <TrendingUp size={14} /> : s.winRate < 45 ? <TrendingDown size={14} /> : <BarChart3 size={14} />}
                  {s.winRate}%
                </span>
              </td>
              <td className={`px-4 py-3 text-right ${s.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(2)}
              </td>
              <td className="px-4 py-3 text-right">{s.avgConfluence != null ? s.avgConfluence.toFixed(2) : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgExpectedPnl != null ? `${s.avgExpectedPnl.toFixed(2)}%` : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgRealizedPnl != null ? `${s.avgRealizedPnl.toFixed(2)}%` : '—'}</td>
              <td className="px-4 py-3 text-right">{s.avgDuration != null ? `${Math.round(s.avgDuration)} bars` : '—'}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                Aucune statistique de pattern disponible.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
