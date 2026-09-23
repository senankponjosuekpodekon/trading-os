'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Gem, RefreshCw, TrendingUp, AlertTriangle, ExternalLink, Filter } from 'lucide-react';
import { useState } from 'react';

export default function HiddenGemsPage() {
  const queryClient = useQueryClient();
  const [minLiquidity, setMinLiquidity] = useState(50000);
  const [minVolume, setMinVolume] = useState(100000);
  const [limit, setLimit] = useState(10);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hidden-gems', minLiquidity, minVolume, limit],
    queryFn: async () => {
      const res = await api.get('/ai/ml/hidden-gems', {
        params: { min_liquidity: minLiquidity, min_volume: minVolume, limit },
      });
      return res.data;
    },
    staleTime: 1000 * 60 * 10,
  });

  const handleRefresh = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['hidden-gems'] });
  };

  const gems = data?.gems || [];

  const scoreColor = (score: number) => {
    if (score >= 70) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (score >= 50) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    if (score >= 30) return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gem className="w-6 h-6 text-purple-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Hidden Gems</h1>
              <p className="text-sm text-gray-400">Early alpha — undervalued tokens with momentum</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 p-4 bg-gray-900 border border-gray-800 rounded-xl">
          <Filter className="w-4 h-4 text-gray-500" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Min Liquidity</label>
            <input
              type="number"
              value={minLiquidity}
              onChange={(e) => setMinLiquidity(Number(e.target.value))}
              className="w-28 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Min Volume</label>
            <input
              type="number"
              value={minVolume}
              onChange={(e) => setMinVolume(Number(e.target.value))}
              className="w-28 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Limit</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-16 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white"
            />
          </div>
        </div>

        {isLoading && <div className="text-gray-400 text-center py-12">Scanning DEX for hidden gems...</div>}
        {isError && <div className="text-red-400 text-center py-12">Failed to load hidden gems</div>}

        {data && (
          <div className="text-sm text-gray-400">{data.summary}</div>
        )}

        {/* Gems grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gems.map((gem: any, i: number) => (
            <div key={i} className="p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{gem.symbol}</span>
                    <span className="text-xs text-gray-500">{gem.chain}</span>
                    {gem.narrative && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300">
                        {gem.narrative}
                      </span>
                    )}
                    {gem.moonshot && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-500/50 bg-yellow-500/10 text-yellow-300 font-semibold">
                        🚀 MOONSHOT
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{gem.name}</p>
                </div>
                <div className={`px-2 py-1 rounded-md text-sm font-bold border ${scoreColor(gem.gem_score)}`}>
                  {gem.gem_score}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div>
                  <p className="text-gray-500">Liquidity</p>
                  <p className="text-gray-300">${(gem.liquidity / 1000).toFixed(0)}K</p>
                </div>
                <div>
                  <p className="text-gray-500">Volume 24h</p>
                  <p className="text-gray-300">${(gem.volume_24h / 1000).toFixed(0)}K</p>
                </div>
                <div>
                  <p className="text-gray-500">24h Change</p>
                  <p className={gem.price_change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {gem.price_change_24h >= 0 ? '+' : ''}{gem.price_change_24h.toFixed(1)}%
                  </p>
                </div>
              </div>

              {gem.onchain?.available && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-3 pb-3 border-b border-gray-800">
                  {gem.onchain.holder_count > 0 && (
                    <span className="text-gray-400">
                      <span className="text-gray-500">Holders:</span> {gem.onchain.holder_count.toLocaleString()}
                    </span>
                  )}
                  {gem.onchain.top10_pct > 0 && (
                    <span className={gem.onchain.top10_pct > 50 ? 'text-red-400' : 'text-gray-400'}>
                      <span className="text-gray-500">Top10:</span> {gem.onchain.top10_pct}%
                    </span>
                  )}
                  {gem.onchain.lp_locked_pct > 0 && (
                    <span className={gem.onchain.lp_locked_pct >= 40 ? 'text-emerald-400' : 'text-orange-400'}>
                      <span className="text-gray-500">LP:</span> {gem.onchain.lp_locked_pct}% locked
                    </span>
                  )}
                  {gem.onchain.honeypot && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 font-semibold">
                      HONEYPOT
                    </span>
                  )}
                </div>
              )}

              {gem.trajectory?.snapshots >= 3 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-3 pb-3 border-b border-gray-800">
                  <span className="text-gray-500">Trajectoire {gem.trajectory.tracked_hours}h:</span>
                  {gem.trajectory.holder_growth_pct != null && (
                    <span className={gem.trajectory.holder_growth_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      holders {gem.trajectory.holder_growth_pct >= 0 ? '+' : ''}{gem.trajectory.holder_growth_pct.toFixed(0)}%
                    </span>
                  )}
                  {gem.trajectory.liquidity_growth_pct != null && (
                    <span className={gem.trajectory.liquidity_growth_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      liq {gem.trajectory.liquidity_growth_pct >= 0 ? '+' : ''}{gem.trajectory.liquidity_growth_pct.toFixed(0)}%
                    </span>
                  )}
                  {gem.trajectory.buy_ratio_avg != null && (
                    <span className="text-gray-400">
                      buys {(gem.trajectory.buy_ratio_avg * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              )}

              {gem.reasons?.length > 0 && (
                <div className="space-y-1 mb-2">
                  {gem.reasons.slice(0, 3).map((r: string, j: number) => (
                    <div key={j} className="flex items-start gap-1 text-xs text-emerald-400/80">
                      <TrendingUp className="w-3 h-3 mt-0.5 shrink-0" /> {r}
                    </div>
                  ))}
                </div>
              )}

              {gem.warnings?.length > 0 && (
                <div className="space-y-1 mb-2">
                  {gem.warnings.slice(0, 2).map((w: string, j: number) => (
                    <div key={j} className="flex items-start gap-1 text-xs text-orange-400/80">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
                    </div>
                  ))}
                </div>
              )}

              {gem.url && (
                <a href={gem.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2">
                  <ExternalLink className="w-3 h-3" /> View on DEX
                </a>
              )}
            </div>
          ))}
        </div>

        {!isLoading && gems.length === 0 && (
          <div className="text-center py-12 text-gray-500">No hidden gems found with current filters</div>
        )}
      </div>
    </>
  );
}
