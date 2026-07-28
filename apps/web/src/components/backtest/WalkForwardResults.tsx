'use client';
import { useMemo } from 'react';

interface WalkTrade {
  pnl: number;
  pnl_pct: number;
  win: boolean;
}

interface WalkForwardResultsProps {
  trades: WalkTrade[];
  cycles?: number;
}

export function WalkForwardResults({ trades, cycles = 5 }: WalkForwardResultsProps) {
  const results = useMemo(() => {
    if (trades.length < cycles * 2) return [];
    const size = Math.floor(trades.length / cycles);
    return Array.from({ length: cycles }).map((_, i) => {
      const slice = trades.slice(i * size, (i + 1) * size);
      const total = slice.reduce((s, t) => s + t.pnl, 0);
      const wins = slice.filter(t => t.win).length;
      return {
        cycle: i + 1,
        trades: slice.length,
        pnl: total,
        pnl_pct: slice.reduce((s, t) => s + t.pnl_pct, 0),
        winRate: (wins / slice.length) * 100,
      };
    });
  }, [trades, cycles]);

  if (results.length === 0) return null;

  const maxPnl = Math.max(...results.map(r => Math.abs(r.pnl)), 1);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Walk-forward — cycles train/test ({cycles} folds)</p>
      <div className="space-y-3">
        {results.map(r => {
          const width = `${(Math.abs(r.pnl) / maxPnl) * 100}%`;
          return (
            <div key={r.cycle} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400 font-medium">Cycle {r.cycle}</span>
                <span className={`font-mono font-semibold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(0)} ({r.pnl_pct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${r.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width }}
                  />
                </div>
                <span className="text-[10px] text-gray-500 w-16 text-right">{r.trades} trades · {r.winRate.toFixed(0)}% WR</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
