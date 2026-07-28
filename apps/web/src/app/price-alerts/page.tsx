'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Bell, Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react';

interface PriceAlert {
  id: string;
  assetSymbol: string;
  direction: 'above' | 'below';
  targetPrice: number;
  triggered: boolean;
  createdAt: string;
}

export default function PriceAlertsPage() {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'above' | 'below'>('above');
  const [target, setTarget] = useState('');

  const { data: alerts = [], isLoading } = useQuery<PriceAlert[]>({
    queryKey: ['price-alerts'],
    queryFn: async () => (await api.get('/price-alerts')).data,
  });

  const create = useMutation({
    mutationFn: (dto: { assetSymbol: string; direction: 'above' | 'below'; targetPrice: number }) =>
      api.post('/price-alerts', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-alerts'] });
      setSymbol('');
      setTarget('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/price-alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(target);
    if (!symbol.trim() || !price || price <= 0) return;
    create.mutate({ assetSymbol: symbol.trim().toUpperCase(), direction, targetPrice: price });
  };

  return (
    <AppLayout title="Alertes prix">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-400" />Alertes prix
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Recevez une notification quand un actif atteint un prix cible.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col md:flex-row gap-4 items-end"
        >
          <div className="flex-1 w-full">
            <label className="block text-xs font-medium text-gray-400 mb-1">Symbole</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="ex: BTC/USDT"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div className="w-full md:w-40">
            <label className="block text-xs font-medium text-gray-400 mb-1">Condition</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as 'above' | 'below')}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="above">Au-dessus de</option>
              <option value="below">En-dessous de</option>
            </select>
          </div>
          <div className="w-full md:w-40">
            <label className="block text-xs font-medium text-gray-400 mb-1">Prix cible</label>
            <input
              type="number"
              step="any"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="70000"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={create.isPending || !symbol || !target}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />Créer
          </button>
        </form>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
            <div className="col-span-3">Symbole</div>
            <div className="col-span-3">Condition</div>
            <div className="col-span-3">Prix cible</div>
            <div className="col-span-2">Statut</div>
            <div className="col-span-1"></div>
          </div>

          {isLoading && (
            <div className="px-4 py-10 text-center text-gray-600 text-sm">Chargement...</div>
          )}

          {!isLoading && alerts.length === 0 && (
            <div className="px-4 py-12 text-center text-gray-500 text-sm">
              Aucune alerte configurée.
            </div>
          )}

          {alerts.map(alert => (
            <div
              key={alert.id}
              className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 last:border-0 items-center text-sm"
            >
              <div className="col-span-3 text-white font-medium">{alert.assetSymbol}</div>
              <div className="col-span-3 flex items-center gap-1.5 text-gray-300">
                {alert.direction === 'above' ? (
                  <>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />Au-dessus de
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-3.5 h-3.5 text-red-400" />En-dessous de
                  </>
                )}
              </div>
              <div className="col-span-3 text-gray-300 font-mono">${Number(alert.targetPrice).toLocaleString()}</div>
              <div className="col-span-2">
                {alert.triggered ? (
                  <span className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                    Déclenchée
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-400">
                    En attente
                  </span>
                )}
              </div>
              <div className="col-span-1 text-right">
                <button
                  onClick={() => remove.mutate(alert.id)}
                  disabled={remove.isPending}
                  className="text-gray-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                  aria-label="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
