'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Portfolio } from '@/types';
import { Briefcase, Plus, Wallet } from 'lucide-react';

const DEFAULT_TYPES: { key: 'PAPER' | 'LIVE'; label: string }[] = [
  { key: 'PAPER', label: 'Paper trading' },
  { key: 'LIVE', label: 'Live trading' },
];

export default function PortfoliosPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'PAPER' as 'PAPER' | 'LIVE', initialCapital: '10000' });

  const { data: portfolios = [], isLoading } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const create = useMutation({
    mutationFn: (data: { name: string; type: 'PAPER' | 'LIVE'; initialCapital: number }) =>
      api.post('/portfolios', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios'] });
      setShowForm(false);
      setForm({ name: '', type: 'PAPER', initialCapital: '10000' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const capital = parseFloat(form.initialCapital);
    if (!form.name.trim() || Number.isNaN(capital) || capital <= 0) return;
    create.mutate({ name: form.name.trim(), type: form.type, initialCapital: capital });
  };

  return (
    <AppLayout title="Portfolios">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-emerald-400" />Mes portfolios
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Gérez plusieurs comptes de trading (paper et live).</p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />{showForm ? 'Annuler' : 'Nouveau portfolio'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Nom</label>
              <input
                value={form.name}
                onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
                placeholder="ex: Swing aggressive"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(v => ({ ...v, type: e.target.value as 'PAPER' | 'LIVE' }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                {DEFAULT_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Capital initial ($)</label>
              <input
                type="number"
                step="any"
                value={form.initialCapital}
                onChange={e => setForm(v => ({ ...v, initialCapital: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              disabled={create.isPending}
              className="w-full md:w-auto px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {create.isPending ? 'Création...' : 'Créer'}
            </button>
          </form>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
            <div className="col-span-4">Nom</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-3">Capital initial</div>
            <div className="col-span-3">Capital actuel</div>
          </div>

          {isLoading && (
            <div className="px-4 py-10 text-center text-gray-600 text-sm">Chargement...</div>
          )}

          {!isLoading && portfolios.length === 0 && (
            <div className="px-4 py-12 text-center text-gray-500 text-sm">
              Aucun portfolio. Créez-en un pour commencer.
            </div>
          )}

          {portfolios.map(p => (
            <div
              key={p.id}
              className="grid grid-cols-12 gap-4 px-4 py-4 border-b border-gray-800 last:border-0 items-center text-sm"
            >
              <div className="col-span-4 text-white font-medium flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />{p.name}
              </div>
              <div className="col-span-2">
                <span className={`text-[10px] px-2 py-0.5 rounded border ${
                  p.type === 'LIVE' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                }`}>
                  {p.type}
                </span>
              </div>
              <div className="col-span-3 text-gray-300 font-mono">${parseFloat(p.initialCapital).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
              <div className="col-span-3 text-gray-300 font-mono">${parseFloat(p.currentCapital).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
