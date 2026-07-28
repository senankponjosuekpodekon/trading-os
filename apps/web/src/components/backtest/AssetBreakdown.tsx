'use client';

interface AssetBreakdownProps {
  breakdown: { [asset: string]: { trades: number; wins: number; pnl: number; win_rate: number } };
}

export function AssetBreakdown({ breakdown }: AssetBreakdownProps) {
  const assets = Object.entries(breakdown).sort((a, b) => b[1].pnl - a[1].pnl);
  if (assets.length === 0) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">Performance par actif</p>
      <div className="space-y-3">
        {assets.map(([asset, stats]) => {
          const positive = stats.pnl >= 0;
          return (
            <div key={asset} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-300 font-medium">{asset}</span>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
