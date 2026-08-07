'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Scale, RefreshCw, TrendingDown, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react';
import { useState } from 'react';

export default function RebalancingPage() {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState('moderate');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['rebalancing', profile],
    queryFn: async () => {
      const res = await api.post('/ai/ml/rebalance', {
        positions: [],
        profile,
      });
      return res.data;
    },
    staleTime: 1000 * 60 * 10,
  });

  const handleRefresh = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['rebalancing'] });
  };

  const actionConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    reduce: { color: 'text-red-400', icon: <TrendingDown className="w-4 h-4" /> },
    increase: { color: 'text-emerald-400', icon: <TrendingUp className="w-4 h-4" /> },
    exit: { color: 'text-red-500', icon: <AlertCircle className="w-4 h-4" /> },
    enter: { color: 'text-blue-400', icon: <ArrowRight className="w-4 h-4" /> },
  };

  const priorityColor: Record<string, string> = {
    high: 'border-l-red-500',
    medium: 'border-l-yellow-500',
    low: 'border-l-gray-600',
  };

  return (
    <AppLayout title="Rebalancing">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Portfolio Rebalancing</h1>
              <p className="text-sm text-gray-400">Optimize allocation based on risk profile</p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Profile selector */}
        <div className="flex gap-2">
          {['conservative', 'moderate', 'aggressive'].map((p) => (
            <button
              key={p}
              onClick={() => setProfile(p)}
              className={`px-4 py-2 text-sm rounded-lg transition capitalize ${
                profile === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {isLoading && <div className="text-gray-400 text-center py-12">Computing rebalancing suggestions...</div>}
        {isError && <div className="text-red-400 text-center py-12">Failed to load rebalancing data</div>}

        {data && (
          <>
            <div className="text-sm text-gray-400">{data.summary}</div>

            {/* Target vs Current allocation */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Target Allocation ({profile})</h3>
                <div className="space-y-2">
                  {Object.entries(data.target_allocation || {}).map(([cluster, pct]: [string, any]) => (
                    <div key={cluster} className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{cluster.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500" style={{ width: `${pct * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-300 w-10 text-right">{(pct * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">Current Allocation</h3>
                <div className="space-y-2">
                  {Object.entries(data.current_allocation || {}).map(([cluster, pct]: [string, any]) => (
                    <div key={cluster} className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{cluster.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-300 w-10 text-right">{(pct * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                  {Object.keys(data.current_allocation || {}).length === 0 && (
                    <p className="text-xs text-gray-500">No open positions</p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Suggested Actions</h3>
              {data.actions?.length > 0 ? (
                data.actions.map((action: any, i: number) => {
                  const cfg = actionConfig[action.action] || actionConfig.reduce;
                  return (
                    <div
                      key={i}
                      className={`p-4 bg-gray-900 border border-gray-800 border-l-4 ${priorityColor[action.priority] || priorityColor.low} rounded-xl`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={cfg.color}>{cfg.icon}</span>
                          <span className="font-medium text-sm text-white uppercase">{action.action}</span>
                          <span className="text-sm text-gray-400">
                            {action.symbol !== '*' ? action.symbol : `All ${action.cluster}`}
                          </span>
                        </div>
                        <span className={`text-xs uppercase px-2 py-0.5 rounded ${
                          action.priority === 'high' ? 'bg-red-500/10 text-red-400' :
                          action.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {action.priority}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">{action.reason}</p>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>Current: {(action.current_weight * 100).toFixed(1)}%</span>
                        <span>Target: {(action.target_weight * 100).toFixed(1)}%</span>
                        <span className={action.deviation > 0 ? 'text-red-400' : 'text-emerald-400'}>
                          Deviation: {action.deviation > 0 ? '+' : ''}{(action.deviation * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-emerald-400">
                  <p>Portfolio is well-balanced — no actions needed</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
