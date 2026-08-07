'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { ShieldAlert, RefreshCw, Shield, ShieldCheck, ShieldX, AlertTriangle, Eye } from 'lucide-react';
import { useState } from 'react';

export default function AiDefensePage() {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [formData, setFormData] = useState({
    symbol: '',
    price_change_24h: 0,
    price_change_1h: 0,
    volume_24h: 0,
    liquidity: 0,
    liquidity_24h_ago: 0,
    age_hours: 0,
    social_score: 0,
    social_volume: 0,
    atr_pct: 0,
    vix: 0,
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-defense', formData],
    queryFn: async () => {
      if (!formData.symbol) return null;
      const res = await api.post('/ai/ml/ai-defense', formData);
      return res.data;
    },
    enabled: !!formData.symbol,
    staleTime: 1000 * 60 * 5,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormData({ ...formData, symbol: symbol.toUpperCase() });
  };

  const recConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    BLOCK: { color: 'text-red-400 bg-red-500/10 border-red-500/30', icon: <ShieldX className="w-5 h-5" />, label: 'BLOCK' },
    WARN: { color: 'text-orange-400 bg-orange-500/10 border-orange-500/30', icon: <AlertTriangle className="w-5 h-5" />, label: 'WARN' },
    MONITOR: { color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', icon: <Eye className="w-5 h-5" />, label: 'MONITOR' },
    CLEAR: { color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: <ShieldCheck className="w-5 h-5" />, label: 'CLEAR' },
  };

  const sevColor: Record<string, string> = {
    critical: 'text-red-400 bg-red-500/10 border-red-500/20',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    low: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  };

  return (
    <AppLayout title="AI Defense">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-red-400" />
          <div>
            <h1 className="text-xl font-bold text-white">AI Defense</h1>
            <p className="text-sm text-gray-400">Pump-dump detection, liquidity drain, social manipulation, flash crash</p>
          </div>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="flex items-end gap-3 p-4 bg-gray-900 border border-gray-800 rounded-xl">
          <div className="flex-1">
            <label className="text-xs text-gray-400 mb-1 block">Token Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. PEPE, DOGE, SHIB..."
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white"
            />
          </div>
          <button type="submit" className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition">
            Run Defense Check
          </button>
        </form>

        {/* Quick-fill buttons */}
        <div className="flex gap-2">
          {['PEPE', 'DOGE', 'SHIB', 'BONK', 'WIF'].map((s) => (
            <button
              key={s}
              onClick={() => { setSymbol(s); setFormData({ ...formData, symbol: s }); }}
              className="px-3 py-1 text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 rounded transition"
            >
              {s}
            </button>
          ))}
        </div>

        {isLoading && <div className="text-gray-400 text-center py-12">Running defense checks...</div>}
        {isError && <div className="text-red-400 text-center py-12">Defense check failed</div>}

        {data && (
          <div className="space-y-4">
            {/* Recommendation banner */}
            <div className={`p-6 rounded-xl border-2 ${recConfig[data.recommendation]?.color || recConfig.CLEAR.color}`}>
              <div className="flex items-center gap-3">
                {recConfig[data.recommendation]?.icon}
                <div>
                  <p className="text-2xl font-bold">{data.recommendation}</p>
                  <p className="text-sm opacity-80">
                    Defense Score: {data.defense_score}/100 · {data.alert_count} alerts
                    {data.critical_count > 0 && ` · ${data.critical_count} critical`}
                  </p>
                </div>
              </div>
            </div>

            {/* Alerts */}
            {data.alerts?.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Alerts</h2>
                {data.alerts.map((alert: any, i: number) => (
                  <div key={i} className={`p-4 rounded-lg border ${sevColor[alert.severity] || sevColor.low}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium text-sm">{alert.alert_type.replace(/_/g, ' ').toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs uppercase opacity-70">{alert.severity}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-black/30 uppercase">{alert.action}</span>
                      </div>
                    </div>
                    <p className="text-sm opacity-90">{alert.message}</p>
                    {alert.data && Object.keys(alert.data).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(alert.data).map(([k, v]: [string, any]) => (
                          <span key={k} className="text-xs px-2 py-1 bg-black/20 rounded">
                            {k}: {typeof v === 'number' ? v.toFixed(2) : String(v)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {data.alert_count === 0 && (
              <div className="text-center py-8 text-emerald-400">
                <ShieldCheck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No threats detected — token appears safe</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
