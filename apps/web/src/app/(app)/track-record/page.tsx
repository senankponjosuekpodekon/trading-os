'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { Trophy, Target, TrendingUp, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';

const SOURCE_LABELS: Record<string, string> = {
  'engine:moonshot': '🚀 Engine · Moonshot',
  'engine:early_alpha': '⭐ Engine · Early Alpha',
  'engine:gem': '💎 Engine · Gem',
  'engine:regime': '📊 Engine · Régime',
};

function sourceLabel(s: string) {
  return SOURCE_LABELS[s] ?? (s.startsWith('manual:') ? `👤 ${s.slice(7)}` : s);
}

const pctColor = (v: number | null) =>
  v == null ? 'text-gray-500' : v >= 0 ? 'text-emerald-400' : 'text-red-400';

export default function TrackRecordPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ symbol: '', source: 'manual:', entryPrice: '', coingeckoId: '', tokenAddress: '', notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['track-record'],
    queryFn: async () => (await api.get('/track-record')).data,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const addCall = useMutation({
    mutationFn: async () => (await api.post('/track-record', {
      symbol: form.symbol,
      source: form.source,
      entryPrice: form.entryPrice ? Number(form.entryPrice) : null,
      coingeckoId: form.coingeckoId || null,
      tokenAddress: form.tokenAddress || null,
      notes: form.notes || null,
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['track-record'] }); setShowForm(false); setForm({ symbol: '', source: 'manual:', entryPrice: '', coingeckoId: '', tokenAddress: '', notes: '' }); },
  });

  const removeCall = useMutation({
    mutationFn: async (id: string) => api.delete(`/track-record/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['track-record'] }),
  });

  if (isLoading) return <PageSkeleton />;

  const calls: any[] = data?.calls ?? [];
  const kpis: any[] = data?.kpis ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" /> Track Record
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Chaque call annoncé est mesuré en continu — entry, peak, perf, hit rate par source.
            C&apos;est ce qui prouve (ou non) la valeur des détections.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg"
        >
          <Plus className="w-4 h-4" /> Call externe
        </button>
      </div>

      {/* KPIs par source */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((k: any) => (
            <div key={k.source} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400">{sourceLabel(k.source)}</p>
              <div className="flex items-baseline gap-3 mt-2">
                <span className="text-2xl font-bold text-white">{k.hitRate != null ? `${k.hitRate}%` : '—'}</span>
                <span className="text-xs text-gray-500">hit rate</span>
              </div>
              <div className="mt-2 text-xs space-y-1">
                <p className="text-gray-400">{k.count} calls · {k.open} ouverts</p>
                <p className={pctColor(k.avgPerfPct)}>perf moy. {k.avgPerfPct != null ? `${k.avgPerfPct > 0 ? '+' : ''}${k.avgPerfPct}%` : '—'}</p>
                {k.best && <p className="text-gray-500">best: {k.best.symbol} <span className="text-emerald-400">+{k.best.perfPct}%</span></p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire ajout call externe */}
      {showForm && (
        <div className="bg-gray-900 border border-emerald-800/50 rounded-xl p-4 space-y-3">
          <p className="text-sm text-white font-medium">Suivre un call externe (coach, analyste…)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <input placeholder="Symbol (ex: LDO, VIRTUAL)" value={form.symbol}
              onChange={e => setForm({ ...form, symbol: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
            <input placeholder="Source (ex: manual:ifeanyi)" value={form.source}
              onChange={e => setForm({ ...form, source: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
            <input placeholder="Prix entrée (auto si vide)" value={form.entryPrice}
              onChange={e => setForm({ ...form, entryPrice: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
            <input placeholder="CoinGecko id (optionnel)" value={form.coingeckoId}
              onChange={e => setForm({ ...form, coingeckoId: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
            <input placeholder="Token address (optionnel)" value={form.tokenAddress}
              onChange={e => setForm({ ...form, tokenAddress: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
            <input placeholder="Notes" value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              className="px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-white" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => addCall.mutate()} disabled={!form.symbol || addCall.isPending}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm rounded">
              Enregistrer et suivre
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-1.5 text-gray-400 text-sm">Annuler</button>
          </div>
          <p className="text-[11px] text-gray-500">Le prix est résolu via CoinGecko (id) → DexScreener (adresse) → Binance (symbol). Refresh auto toutes les 15 min.</p>
        </div>
      )}

      {/* Table des calls */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-800">
              <th className="p-3">Source</th>
              <th className="p-3">Actif</th>
              <th className="p-3">Entrée</th>
              <th className="p-3">Dernier</th>
              <th className="p-3">Perf</th>
              <th className="p-3">Multiple</th>
              <th className="p-3">Peak</th>
              <th className="p-3">Jours</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-gray-500">
                Aucun call tracké — les détections engine (moonshot, early-alpha ≥80) s&apos;enregistrent automatiquement ici.
              </td></tr>
            )}
            {calls.map((c: any) => (
              <tr key={c.id} className="border-b border-gray-800/50">
                <td className="p-3 text-gray-400 whitespace-nowrap">{sourceLabel(c.source)}</td>
                <td className="p-3">
                  <span className="text-white font-medium">{c.symbol}</span>
                  {c.chain && <span className="text-gray-600 ml-1.5">{c.chain}</span>}
                </td>
                <td className="p-3 text-gray-300">${c.entryPrice}</td>
                <td className="p-3 text-gray-300">{c.lastPrice != null ? `$${c.lastPrice}` : '—'}</td>
                <td className={`p-3 font-bold ${pctColor(c.perfPct)}`}>
                  {c.perfPct != null ? `${c.perfPct > 0 ? '+' : ''}${c.perfPct}%` : '—'}
                </td>
                <td className={`p-3 font-medium ${c.multiple != null && c.multiple >= 2 ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {c.multiple != null ? `${c.multiple}x` : '—'}
                </td>
                <td className={`p-3 ${pctColor(c.peakPct)}`}>
                  {c.peakPct != null ? `+${c.peakPct}%` : '—'}
                </td>
                <td className="p-3 text-gray-400">{c.daysHeld}j</td>
                <td className="p-3">
                  <button onClick={() => removeCall.mutate(c.id)} className="text-gray-600 hover:text-red-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
        <Target className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Le track-record mesure ce que le système annonce réellement : quand une détection moonshot ou early-alpha déclenche
          une alerte, elle est enregistrée ici avec son prix d&apos;entrée puis suivie toutes les 15 min.
          Comparez avec les calls externes (coachs, analystes) ajoutés manuellement — le hit rate et le multiple réalisé
          sont la preuve objective, pas les promesses.
        </p>
      </div>
    </div>
  );
}
