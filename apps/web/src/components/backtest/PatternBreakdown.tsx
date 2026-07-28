'use client';

interface PatternStat {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  win_rate: number;
  avg_pnl_pct: number;
  avg_rr: number;
  avg_duration_bars: number;
  avg_confluence_score: number;
}

interface PatternBreakdownProps {
  breakdown: { [pattern: string]: PatternStat };
}

export function PatternBreakdown({ breakdown }: PatternBreakdownProps) {
  const patterns = Object.entries(breakdown).sort((a, b) => b[1].trades - a[1].trades);
  if (patterns.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Performance par pattern</p>
      <div className="space-y-3">
        {patterns.map(([pattern, stats]) => {
          const positive = stats.pnl >= 0;
          const confPct = Math.round((stats.avg_confluence_score ?? 0) * 100);
          return (
            <div key={pattern} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium capitalize">{pattern}</span>
                <span className={`font-mono font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.wins}/{stats.trades} — {stats.win_rate.toFixed(0)}% WR
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${positive ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, stats.win_rate)}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-500 w-16 text-right">
                  ${stats.pnl.toFixed(0)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                <span>avg RR {stats.avg_rr?.toFixed(2)}x</span>
                <span>avg PnL {stats.avg_pnl_pct?.toFixed(2)}%</span>
                <span>dur. {stats.avg_duration_bars?.toFixed(0)}b</span>
                <span>conf. {confPct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
