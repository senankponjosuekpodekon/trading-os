'use client';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Activity, Database, TrendingUp, Users, ShieldAlert, Cpu, Layers, BarChart3, RefreshCw } from 'lucide-react';

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl min-w-[100px]">
      <div className="text-gray-500">{icon}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

export default function AdminOpsPage() {
  const user = useAuthStore((s) => s.user);

  const { data: dbStats, isLoading: dbLoading } = useQuery({
    queryKey: ['admin-ops-db'],
    queryFn: async () => {
      const { data } = await api.get('/admin/ops/db-stats');
      return data;
    },
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    refetchInterval: 30000,
  });

  const { data: signals24h } = useQuery({
    queryKey: ['admin-ops-signals-24h'],
    queryFn: async () => {
      const { data } = await api.get('/admin/ops/signals-24h');
      return data;
    },
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    refetchInterval: 30000,
  });

  const { data: health } = useQuery({
    queryKey: ['admin-ops-health'],
    queryFn: async () => {
      const { data } = await api.get('/admin/ops/health');
      return data;
    },
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    refetchInterval: 15000,
  });

  if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return (
      <AppLayout title="Accès refusé">
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white">Accès refusé</h2>
            <p className="text-gray-400 mt-2">Vous devez être administrateur pour accéder à cette page.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Opérations système">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Opérations système</h1>
          <RefreshCw className="w-4 h-4 text-gray-500 ml-auto" />
        </div>

        {/* DB Stats */}
        <div>
          <h2 className="text-sm font-medium text-gray-400 mb-3">Base de données</h2>
          {dbLoading ? (
            <div className="text-gray-400 text-sm">Chargement...</div>
          ) : dbStats ? (
            <div className="flex flex-wrap gap-3">
              <StatCard label="Utilisateurs" value={dbStats.users} icon={<Users className="w-5 h-5" />} />
              <StatCard label="Actifs" value={dbStats.assets} icon={<Layers className="w-5 h-5" />} />
              <StatCard label="Stratégies" value={dbStats.strategies} icon={<Cpu className="w-5 h-5" />} />
              <StatCard label="Signaux" value={dbStats.signals} icon={<TrendingUp className="w-5 h-5" />} />
              <StatCard label="Positions" value={dbStats.positions} icon={<BarChart3 className="w-5 h-5" />} />
              <StatCard label="Signal Logs" value={dbStats.signalLogs} icon={<Database className="w-5 h-5" />} />
              <StatCard label="Features" value={dbStats.features} icon={<Cpu className="w-5 h-5" />} />
              <StatCard label="Portefeuilles" value={dbStats.portfolios} icon={<Layers className="w-5 h-5" />} />
            </div>
          ) : null}
        </div>

        {/* Signals 24h */}
        {signals24h && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-3">Signaux (24h)</h2>
            <div className="flex flex-wrap gap-3">
              <StatCard label="Total" value={signals24h.total} icon={<TrendingUp className="w-5 h-5" />} />
              {Object.entries(signals24h.byDirection || {}).map(([dir, count]) => (
                <StatCard key={dir} label={dir} value={count as number} icon={<TrendingUp className="w-5 h-5" />} />
              ))}
              {Object.entries(signals24h.byStatus || {}).map(([status, count]) => (
                <StatCard key={status} label={status} value={count as number} icon={<Activity className="w-5 h-5" />} />
              ))}
            </div>
          </div>
        )}

        {/* Cron Health */}
        {health && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-3">Crons & Santé système</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
              {Object.entries(health).map(([key, val]: [string, any]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">{key}</span>
                  <div className="flex items-center gap-2">
                    {val.lastStatus && (
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        val.lastStatus === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                        val.lastStatus === 'failed' ? 'bg-red-500/10 text-red-400' :
                        'bg-gray-500/10 text-gray-400'
                      }`}>
                        {val.lastStatus}
                      </span>
                    )}
                    {val.lastRun && (
                      <span className="text-xs text-gray-500">
                        {new Date(val.lastRun).toLocaleString()}
                      </span>
                    )}
                    {val.lastError && (
                      <span className="text-xs text-red-400">{val.lastError}</span>
                    )}
                  </div>
                </div>
              ))}
              {Object.keys(health).length === 0 && (
                <div className="text-gray-500 text-sm">Aucun cron enregistré</div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
