'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/hooks/useToast';
import {
  BarChart3,
  ShieldAlert,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  AlertCircle,
  Zap,
} from 'lucide-react';

interface MarketConfig {
  marketType: string;
  isActive: boolean;
  warmupEnabled: boolean;
  scanInterval: number | null;
  maxStrategies: number | null;
  timeframes: string[] | null;
}

const marketLabels: Record<string, string> = {
  CRYPTO: 'Crypto',
  FOREX: 'Forex',
  SYNTHETIC: 'Synthetic',
  BRVM: 'BRVM',
  US_STOCK: 'Actions US',
  COMMODITY: 'Matières premières',
};

export default function MarketSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: markets, isLoading, error, refetch } = useQuery<MarketConfig[]>({
    queryKey: ['admin-markets'],
    queryFn: async () => (await api.get('/admin/markets')).data,
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
  });

  const update = useMutation({
    mutationFn: async ({ marketType, body }: { marketType: string; body: Partial<MarketConfig> }) => {
      const { data } = await api.put(`/admin/markets/${marketType}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-markets'] }),
    onError: () => toast('Impossible de mettre à jour la configuration.', { title: 'Erreur', type: 'error' }),
  });

  const toggle = (marketType: string, field: 'isActive' | 'warmupEnabled', value: boolean) => {
    update.mutate({ marketType, body: { [field]: value } });
  };

  if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return (
      <AppLayout title="Accès refusé">
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white">Accès refusé</h2>
            <p className="text-gray-400 mt-2">Vous devez être administrateur pour gérer les marchés.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Marchés actifs">
      <div className="space-y-6">
        <div>
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            Marchés actifs
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Activez ou désactivez les marchés scannés par le moteur et son warmup.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Chargement...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm flex-1">Impossible de charger les marchés.</span>
            <button onClick={() => refetch()} className="text-xs flex items-center gap-1 hover:text-red-300">
              <RefreshCw className="w-3.5 h-3.5" />Réessayer
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {markets?.map((m) => (
              <div
                key={m.marketType}
                className={`bg-gray-900 border rounded-xl p-5 ${m.isActive ? 'border-gray-800' : 'border-gray-800 opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold">{marketLabels[m.marketType] ?? m.marketType}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                        {m.marketType}
                      </span>
                      {m.isActive ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <ToggleRight className="w-3.5 h-3.5" />Actif
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <ToggleLeft className="w-3.5 h-3.5" />Inactif
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-xs mt-1">
                      Warmup {m.warmupEnabled ? 'activé' : 'désactivé'} · Intervalle{' '}
                      {m.scanInterval ?? 'défaut'}s · Max stratégies {m.maxStrategies ?? 'défaut'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 min-w-[140px]">
                    <button
                      onClick={() => toggle(m.marketType, 'isActive', !m.isActive)}
                      disabled={update.isPending}
                      className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        m.isActive
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-emerald-500/40'
                      }`}
                    >
                      {update.isPending && <RefreshCw className="w-3 h-3 animate-spin" />}
                      {m.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      {m.isActive ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      onClick={() => toggle(m.marketType, 'warmupEnabled', !m.warmupEnabled)}
                      disabled={update.isPending}
                      className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        m.warmupEnabled
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20'
                          : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-blue-500/40'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {m.warmupEnabled ? 'Warmup ON' : 'Warmup OFF'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
