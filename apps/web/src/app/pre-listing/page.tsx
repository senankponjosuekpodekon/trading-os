'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Star, RefreshCw, Rocket, AlertTriangle, ExternalLink, Search, Shield } from 'lucide-react';
import { useState } from 'react';

export default function PreListingPage() {
  const queryClient = useQueryClient();
  const [minScore, setMinScore] = useState(40);
  const [limit, setLimit] = useState(15);
  const [selectedPool, setSelectedPool] = useState<any | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pre-listing', minScore, limit],
    queryFn: async () => {
      const res = await api.get('/ai/alpha/pre-listing/discover', {
        params: { min_score: minScore, limit },
      });
      return res.data;
    },
    staleTime: 1000 * 60 * 10,
  });

  const { data: newPools } = useQuery({
    queryKey: ['dex-new-pools'],
    queryFn: async () => (await api.get('/dex/new-pools')).data,
    staleTime: 1000 * 60 * 10,
  });

  const { data: riskCheck, isLoading: riskLoading, refetch: refetchRisk } = useQuery({
    queryKey: ['dex-risk-check', selectedPool?.chain, selectedPool?.token_address],
    queryFn: async () =>
      (await api.get(`/dex/risk-check/${selectedPool.chain}/${selectedPool.token_address}`)).data,
    enabled: !!selectedPool?.chain && !!selectedPool?.token_address,
    staleTime: 1000 * 60 * 5,
  });

  const handleRefresh = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['pre-listing'] });
  };

  const projects = data?.projects || [];

  const scoreColor = (score: number) => {
    if (score >= 70) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (score >= 55) return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    if (score >= 40) return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
    return 'text-red-400 bg-red-500/10 border-red-500/20';
  };

  const verdictText = (score: number) => {
    if (score >= 70) return 'STRONG BUY';
    if (score >= 55) return 'CAUTIOUS BUY';
    if (score >= 40) return 'WATCH';
    if (score >= 25) return 'HIGH RISK';
    return 'AVOID';
  };

  return (
    <AppLayout title="Pre-Listing">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Rocket className="w-6 h-6 text-purple-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Pre-Listing Alpha</h1>
              <p className="text-sm text-gray-400">IDO, IEO, ICO & presale discovery with asymmetric scoring</p>
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
          <Search className="w-4 h-4 text-gray-500" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">Min Score</label>
            <input
              type="number"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-20 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-white"
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

        {isLoading && <div className="text-gray-400 text-center py-12">Scanning pre-listing opportunities...</div>}
        {isError && <div className="text-red-400 text-center py-12">Failed to load pre-listing data</div>}

        {data && (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-white">{data.scanned_count || 0}</p>
              <p className="text-xs text-gray-500">Projects Scanned</p>
            </div>
            <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-emerald-400">{data.high_score_count || 0}</p>
              <p className="text-xs text-gray-500">High Score (70+)</p>
            </div>
            <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg text-center">
              <p className="text-2xl font-bold text-red-400">{data.critical_risk_count || 0}</p>
              <p className="text-xs text-gray-500">Critical Risks</p>
            </div>
          </div>
        )}

        {/* DEX new pools */}
        {newPools && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Rocket className="w-4 h-4 text-purple-400" /> DEX New Pools
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(newPools.pools || newPools || []).slice(0, 6).map((pool: any, i: number) => (
                <button
                  key={i}
                  onClick={() => setSelectedPool({ chain: pool.chain || 'bsc', token_address: pool.token_address || pool.address })}
                  className={`text-left p-3 rounded-lg border transition ${
                    selectedPool?.token_address === (pool.token_address || pool.address)
                      ? 'bg-purple-500/10 border-purple-500/30'
                      : 'bg-gray-800/30 border-gray-700 hover:border-purple-500/30'
                  }`}
                >
                  <p className="text-white text-sm font-medium truncate">{pool.symbol || pool.name || 'Unknown'}</p>
                  <p className="text-xs text-gray-500">{pool.chain || 'bsc'} · {pool.token_address || pool.address}</p>
                  {pool.liquidity !== undefined && <p className="text-xs text-gray-400 mt-1">Liquidity ${(pool.liquidity / 1000).toFixed(0)}K</p>}
                </button>
              ))}
              {(newPools.pools || newPools || []).length === 0 && <p className="text-gray-500 text-sm">No new pools found.</p>}
            </div>

            {selectedPool && (
              <div className="mt-4 p-3 bg-gray-800/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Shield className="w-4 h-4" /> Risk Check
                  </h4>
                  <button onClick={() => refetchRisk()} className="text-xs text-blue-400 hover:text-blue-300">Refresh</button>
                </div>
                {riskLoading && <p className="text-gray-500 text-xs">Checking token…</p>}
                {riskCheck && (
                  <div className="space-y-1 text-xs">
                    <p className={riskCheck.is_honeypot ? 'text-red-400' : 'text-emerald-400'}>
                      Honeypot: {riskCheck.is_honeypot ? 'YES' : 'No'}
                    </p>
                    <p className={riskCheck.mintable ? 'text-red-400' : 'text-emerald-400'}>
                      Mintable: {riskCheck.mintable ? 'YES' : 'No'}
                    </p>
                    {riskCheck.owner_renounced !== undefined && (
                      <p className={riskCheck.owner_renounced ? 'text-emerald-400' : 'text-yellow-400'}>
                        Owner renounced: {riskCheck.owner_renounced ? 'Yes' : 'No'}
                      </p>
                    )}
                    {riskCheck.liquidity_locked_pct !== undefined && (
                      <p className="text-gray-400">Liquidity locked: {Number(riskCheck.liquidity_locked_pct).toFixed(1)}%</p>
                    )}
                    {riskCheck.risk_score !== undefined && (
                      <p className="text-gray-400">Risk score: {riskCheck.risk_score}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Projects list */}
        <div className="space-y-3">
          {projects.map((p: any, i: number) => (
            <div key={i} className="p-4 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{p.symbol}</span>
                    <span className="text-sm text-gray-400">{p.name}</span>
                    {p.listing_type && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        {p.listing_type}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    {p.platform && <span>Launchpad: {p.platform}</span>}
                    {p.chain && <span>Chain: {p.chain}</span>}
                    {p.source && <span>Source: {p.source}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`px-3 py-1.5 rounded-md text-lg font-bold border ${scoreColor(p.asymmetric_score)}`}>
                    {p.asymmetric_score}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{verdictText(p.asymmetric_score)}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 text-xs mb-3">
                {p.funding_pct !== undefined && (
                  <div>
                    <p className="text-gray-500">Funding</p>
                    <p className="text-gray-300">{p.funding_pct.toFixed(0)}%</p>
                  </div>
                )}
                {p.liquidity !== undefined && p.liquidity > 0 && (
                  <div>
                    <p className="text-gray-500">Liquidity</p>
                    <p className="text-gray-300">${(p.liquidity / 1000).toFixed(0)}K</p>
                  </div>
                )}
                {p.volume_24h !== undefined && p.volume_24h > 0 && (
                  <div>
                    <p className="text-gray-500">Volume 24h</p>
                    <p className="text-gray-300">${(p.volume_24h / 1000).toFixed(0)}K</p>
                  </div>
                )}
                {p.price_change_24h !== undefined && (
                  <div>
                    <p className="text-gray-500">24h Change</p>
                    <p className={p.price_change_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {p.price_change_24h >= 0 ? '+' : ''}{p.price_change_24h.toFixed(1)}%
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {p.opportunity_flags?.map((flag: string, j: number) => (
                  <span key={j} className="text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/10">
                    ✓ {flag}
                  </span>
                ))}
                {p.risk_flags?.map((flag: string, j: number) => (
                  <span key={j} className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400/80 border border-red-500/10 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {flag}
                  </span>
                ))}
              </div>

              {p.url && (
                <a href={p.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-2">
                  <ExternalLink className="w-3 h-3" /> View on DEX
                </a>
              )}
            </div>
          ))}
          {!isLoading && projects.length === 0 && (
            <div className="text-center py-12 text-gray-500">No pre-listing opportunities found with current filters</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
