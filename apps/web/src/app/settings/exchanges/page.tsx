'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RefreshCw, AlertCircle, CheckCircle2, XCircle, Key, ShieldCheck, Zap } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface ExchangeConnection {
  id: string;
  exchange: string;
  label: string;
  permissions: string[];
  isActive: boolean;
  lastValidAt: string | null;
  lastError: string | null;
  createdAt: string;
  apiKeyMasked: string;
}

const EXCHANGES = [
  { value: 'BINANCE', label: 'Binance', icon: '🟡', markets: 'Crypto, Forex, Matières premières' },
  { value: 'DERIV', label: 'Deriv', icon: '🔵', markets: 'Synthetic, Forex, Matières premières' },
  { value: 'OANDA', label: 'OANDA', icon: '🟣', markets: 'Forex, CFDs, Métaux, Indices' },
  { value: 'MT5', label: 'MetaTrader 5', icon: '🟠', markets: 'Forex via Exness, IC Markets, Pepperstone, FBS...' },
  { value: 'BRVM', label: 'BRVM', icon: '🟢', markets: 'Actions BRVM (mode manuel)' },
  { value: 'BYBIT', label: 'Bybit', icon: '⚪', markets: 'Crypto (bientôt)' },
  { value: 'OKX', label: 'OKX', icon: '⚫', markets: 'Crypto (bientôt)' },
];

export default function ExchangeConnectionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ exchange: 'BINANCE', label: '', apiKey: '', apiSecret: '' });
  const [formError, setFormError] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: connections, isLoading, error, refetch } = useQuery<ExchangeConnection[]>({
    queryKey: ['exchange-connections'],
    queryFn: async () => (await api.get('/exchange-connections')).data,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/exchange-connections', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exchange-connections'] });
      setShowForm(false);
      setForm({ exchange: 'BINANCE', label: '', apiKey: '', apiSecret: '' });
      toast('Vos clés API sont chiffrées et stockées en sécurité.', { title: 'Connexion créée', type: 'success' });
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message || 'Erreur lors de la création');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/exchange-connections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exchange-connections'] });
      toast('Connexion supprimée.', { title: 'Connexion supprimée', type: 'info' });
    },
  });

  const validate = useMutation({
    mutationFn: (id: string) => api.post(`/execution/validate/${id}`),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['exchange-connections'] });
      toast(
        data.valid ? 'La connexion à l\'exchange fonctionne.' : 'Vérifiez vos clés API.',
        { title: data.valid ? 'Clés valides' : 'Clés invalides', type: data.valid ? 'success' : 'error' },
      );
    },
    onError: () => toast('Validation échouée.', { title: 'Validation échouée', type: 'error' }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (form.apiKey.length < 8 || form.apiSecret.length < 8) {
      setFormError('Les clés API doivent faire au moins 8 caractères.');
      return;
    }
    create.mutate(form);
  };

  return (
    <AppLayout title="Connexions Exchange">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">Connexions Exchange</h2>
            <p className="text-gray-500 text-sm mt-0.5">Gérez vos clés API pour l&rsquo;exécution d&rsquo;ordres automatiques</p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            {showForm ? 'Annuler' : 'Connecter un exchange'}
          </button>
        </div>

        {/* Security notice */}
        <div className="flex items-start gap-3 p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-emerald-300 font-medium">Vos clés sont chiffrées (AES-256-GCM)</p>
            <p className="text-gray-400 mt-1">
              Les clés API sont stockées chiffrées en base de données. N&rsquo;utilisez que des clés <strong>sans droit de retrait</strong>.
              Les permissions de retrait sont automatiquement bloquées.
            </p>
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="text-white font-semibold">Nouvelle connexion</h3>
            {formError && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />{formError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Exchange *</label>
                <select
                  value={form.exchange}
                  onChange={e => setForm(v => ({ ...v, exchange: e.target.value, apiKey: e.target.value === 'BRVM' ? 'brvm-manual' : '', apiSecret: e.target.value === 'BRVM' ? 'brvm-manual' : '' }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                >
                  {EXCHANGES.map(ex => (
                    <option key={ex.value} value={ex.value}>{ex.icon} {ex.label}</option>
                  ))}
                </select>
                {(() => {
                  const ex = EXCHANGES.find(e => e.value === form.exchange);
                  return ex ? <p className="text-xs text-gray-500 mt-1">{ex.markets}</p> : null;
                })()}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nom (label) *</label>
                <input
                  required
                  value={form.label}
                  onChange={e => setForm(v => ({ ...v, label: e.target.value }))}
                  placeholder={form.exchange === 'BRVM' ? 'Mon compte broker BRVM' : 'Mon compte Binance'}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            {form.exchange !== 'BRVM' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    {form.exchange === 'OANDA' ? 'API Token *' : form.exchange === 'MT5' ? 'Login (N° de compte) *' : 'API Key *'}
                  </label>
                  <input
                    required
                    type={form.exchange === 'MT5' ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={e => setForm(v => ({ ...v, apiKey: e.target.value }))}
                    placeholder={form.exchange === 'OANDA' ? 'Token OANDA (Bearer)' : form.exchange === 'MT5' ? 'Ex: 5032567890' : '••••••••••••••••'}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    {form.exchange === 'OANDA' ? 'Account ID *' : form.exchange === 'MT5' ? 'Mot de passe *' : 'API Secret *'}
                  </label>
                  <input
                    required
                    type={form.exchange === 'OANDA' ? 'text' : 'password'}
                    value={form.apiSecret}
                    onChange={e => setForm(v => ({ ...v, apiSecret: e.target.value }))}
                    placeholder={form.exchange === 'OANDA' ? 'Ex: 001-001-123456-001' : form.exchange === 'MT5' ? '••••••••' : '••••••••••••••••'}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            ) : (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm text-yellow-400">
                <strong>Mode manuel BRVM :</strong> Aucune clé API requise. Les ordres génèrent un ticket à transmettre à votre broker (SGCI, Coris, BOA, Ecobank). Règlement T+3.
              </div>
            )}
            {form.exchange === 'MT5' && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400">
                <strong>MetaTrader 5 :</strong> Nécessite le bridge Python MT5 démarré sur un VPS avec MT5 Terminal.
                Supporte Exness, IC Markets, Pepperstone, FBS, RoboForex, Alpari et tout broker MT5.
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {form.exchange !== 'BRVM' ? (
                <><ShieldCheck className="w-3.5 h-3.5" />Assurez-vous que les permissions de retrait sont désactivées sur votre clé API.</>
              ) : (
                <><ShieldCheck className="w-3.5 h-3.5" />Aucune clé API requise pour le mode manuel BRVM.</>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={create.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                {create.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
                {create.isPending ? 'Création...' : 'Connecter'}
              </button>
            </div>
          </form>
        )}

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" /><span>Chargement...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm flex-1">Impossible de charger les connexions.</span>
            <button onClick={() => refetch()} className="text-xs flex items-center gap-1 hover:text-red-300">
              <RefreshCw className="w-3.5 h-3.5" />Réessayer
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {(!connections || connections.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
                <Key className="w-10 h-10 mb-3" />
                <p className="font-medium">Aucune connexion</p>
                <p className="text-sm mt-1">Connectez votre premier exchange pour activer l&rsquo;exécution d&rsquo;ordres</p>
              </div>
            )}
            {connections?.map(c => {
              const ex = EXCHANGES.find(e => e.value === c.exchange);
              return (
                <div key={c.id} className={`bg-gray-900 border rounded-xl p-5 ${c.isActive ? 'border-gray-800' : 'border-gray-800 opacity-60'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{ex?.icon ?? '🔌'}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-semibold">{c.label}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                            {c.exchange}
                          </span>
                          {c.isActive ? (
                            <span className="flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />Actif
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              <XCircle className="w-3 h-3" />Inactif
                            </span>
                          )}
                        </div>
                        <p className="text-gray-500 text-xs mt-1 font-mono">{c.apiKeyMasked}</p>
                        {c.permissions.length > 0 && (
                          <div className="flex gap-1.5 mt-2">
                            {c.permissions.map(p => (
                              <span key={p} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.lastError && (
                          <p className="text-xs text-red-400 mt-2">⚠ {c.lastError}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => validate.mutate(c.id)}
                        disabled={validate.isPending}
                        title="Tester la connexion"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-700 hover:border-emerald-500/40 text-gray-300 hover:text-white rounded-lg transition-colors"
                      >
                        <Zap className="w-3.5 h-3.5" />Tester
                      </button>
                      <button
                        onClick={() => { if (confirm(`Supprimer "${c.label}" ?`)) remove.mutate(c.id); }}
                        disabled={remove.isPending}
                        title="Supprimer"
                        className="p-1.5 text-gray-600 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
