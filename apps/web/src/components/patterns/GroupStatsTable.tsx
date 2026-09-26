'use client';

import { ExecutionStats } from '@/types';

/** Table générique win-rate par groupe (stratégie, timeframe, ...). */
export function GroupStatsTable({ groups }: { groups: Record<string, ExecutionStats> }) {
  const rows = Object.entries(groups).filter(([, s]) => s.total > 0);
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-6 text-sm text-gray-500">
        Aucun signal clôturé dans ce groupe.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
            <th className="px-4 py-2.5 font-medium">Groupe</th>
            <th className="px-4 py-2.5 font-medium text-right">Trades</th>
            <th className="px-4 py-2.5 font-medium text-right">Win rate</th>
            <th className="px-4 py-2.5 font-medium text-right">Profit factor</th>
            <th className="px-4 py-2.5 font-medium text-right">PnL moyen</th>
            <th className="px-4 py-2.5 font-medium text-right">MAE/MFE moy.</th>
          </tr>
        </thead>
        <tbody>
          {rows
            .sort(([, a], [, b]) => b.winRate - a.winRate)
            .map(([name, s]) => (
              <tr key={name} className="border-b border-gray-800/50 last:border-0">
                <td className="px-4 py-2.5 text-gray-200 font-medium">{name}</td>
                <td className="px-4 py-2.5 text-right text-gray-400 font-mono">{s.total}</td>
                <td className={`px-4 py-2.5 text-right font-mono ${s.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(s.winRate * 100).toFixed(1)}%
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${s.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.profitFactor.toFixed(2)}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono ${s.avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {s.avgPnl >= 0 ? '+' : ''}{s.avgPnl.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-right text-gray-500 font-mono text-xs">
                  {s.avgMae.toFixed(1)} / {s.avgMfe.toFixed(1)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
