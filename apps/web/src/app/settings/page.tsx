'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings, Shield, Zap, ToggleLeft, ToggleRight, Trash2, RefreshCw, AlertCircle, ChevronDown, ChevronUp, UserCircle, Clock, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import Link from 'next/link';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { OnboardingModal, TraderProfile } from '@/components/onboarding/OnboardingModal';
import { useAuthStore } from '@/store/auth.store';
import { getBrowserTimezone } from '@/lib/timezone';

interface Strategy {
  id: string;
  name: string;
  description?: string;
  rules: Record<string, any>;
  isActive: boolean;
  isEnabledByUser: boolean;
  createdAt: string;
  userStrategy?: { isEnabled: boolean; customRules?: any } | null;
}

const DEFAULT_RULES = {
  ema_fast: 20,
  ema_slow: 50,
  ema_trend: 200,
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  min_confidence: 55,
  timeframes: ['1h', '4h'],
};

function RulesBadges({ rules }: { rules: Record<string, any> }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {Object.entries(rules).slice(0, 6).map(([k, v]) => (
        <span key={k} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">
          {k}: <span className="text-gray-200">{Array.isArray(v) ? v.join(',') : String(v)}</span>
        </span>
      ))}
    </div>
  );
}

const LS_PROFILE = 'trading_profile';
const PROFILES = [
  { key: 'conservative', label: 'Conservateur', desc: 'Risque réduit, R/R modérés, capital protégé.' },
  { key: 'moderate',     label: 'Modéré',      desc: 'Équilibre risque/rendement standard.' },
  { key: 'aggressive',   label: 'Agressif',    desc: 'Risque élevé, R/R étendus, croissance rapide.' },
];

export default function SettingsPage() {
  const [showForm, setShowForm] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', rules: JSON.stringify(DEFAULT_RULES, null, 2) });
  const [formError, setFormError] = useState('');
  const [profile, setProfile] = useState<string>(() => {
    if (typeof window === 'undefined') return 'moderate';
    return localStorage.getItem(LS_PROFILE) ?? 'moderate';
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const user = useAuthStore(s => s.user);
  const [timezone, setTimezone] = useState<string>(user?.timezone ?? getBrowserTimezone());

  const saveTimezone = useMutation({
    mutationFn: (tz: string) => api.patch('/users/me', { timezone: tz }),
    onSuccess: () => {
      // Update local store
      const stored = localStorage.getItem('trading_os_user');
      if (stored) {
        const u = JSON.parse(stored);
        u.timezone = timezone;
        localStorage.setItem('trading_os_user', JSON.stringify(u));
      }
    },
  });

  const saveProfile = (p: string) => {
    setProfile(p);
    localStorage.setItem(LS_PROFILE, p);
  };

  const { data: strategies, isLoading, error, refetch } = useQuery<Strategy[]>({
    queryKey: ['strategies'],
    queryFn: async () => (await api.get('/strategies')).data,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/strategies', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['strategies'] }); setShowForm(false); setForm({ name: '', description: '', rules: JSON.stringify(DEFAULT_RULES, null, 2) }); },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.patch(`/strategies/${id}/toggle`, { isEnabled }),
    onMutate: async ({ id, isEnabled }) => {
      await qc.cancelQueries({ queryKey: ['strategies'] });
      const previous = qc.getQueryData<Strategy[]>(['strategies']);
      if (previous) {
        qc.setQueryData(['strategies'], previous.map(s =>
          s.id === id ? { ...s, isEnabledByUser: isEnabled } : s,
        ));
      }
      return { previous };
    },
    onError: (_err: any, _vars, context) => {
      if (context?.previous) qc.setQueryData(['strategies'], context.previous);
      const msg = _err?.response?.data?.message || 'Erreur lors du basculement de la stratégie.';
      toast(msg, { type: 'error', title: 'Stratégie' });
    },
    onSuccess: (_data, vars) => {
      toast(
        vars.isEnabled
          ? 'Stratégie activée — vous recevrez les signaux de cette stratégie.'
          : 'Stratégie désactivée — vous ne recevrez plus de signaux de cette stratégie.',
        { type: vars.isEnabled ? 'success' : 'warning', title: 'Stratégie' },
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/strategies/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['strategies'] });
      const previous = qc.getQueryData<Strategy[]>(['strategies']);
      if (previous) {
        qc.setQueryData(['strategies'], previous.filter(s => s.id !== id));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['strategies'], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['strategies'] }),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    try {
      const rules = JSON.parse(form.rules);
      create.mutate({ name: form.name, description: form.description, rules });
    } catch {
      setFormError('Les règles JSON sont invalides.');
    }
  };

  const activeCount = strategies?.filter(s => s.isEnabledByUser).length ?? 0;

  return (
    <AppLayout title="Paramètres">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">Paramètres</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings/2fa"
              className="flex items-center gap-2 px-4 py-2 border border-gray-700 hover:border-emerald-500/40 text-gray-300 hover:text-white rounded-lg text-sm transition-colors">
              <Shield className="w-4 h-4" />2FA
            </Link>
            {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
              <Link href="/settings/markets"
                className="flex items-center gap-2 px-4 py-2 border border-gray-700 hover:border-emerald-500/40 text-gray-300 hover:text-white rounded-lg text-sm transition-colors">
                <BarChart3 className="w-4 h-4" />Marchés
              </Link>
            )}
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors">
              <Plus className="w-4 h-4" />{showForm ? 'Annuler' : 'Nouvelle stratégie'}
            </button>
          </div>
        </div>

        {/* Timezone */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="text-white font-semibold">Fuseau horaire</h3>
          </div>
          <p className="text-gray-500 text-sm mb-3">Les heures des signaux affichées sur la plateforme seront converties dans votre fuseau.</p>
          <div className="flex items-center gap-3">
            <select
              value={timezone}
              onChange={e => { setTimezone(e.target.value); saveTimezone.mutate(e.target.value); }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            >
              {Intl.supportedValuesOf('timeZone').map((tz: string) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            {saveTimezone.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-500 animate-spin" />}
            {saveTimezone.isSuccess && <span className="text-xs text-emerald-400">Sauvegardé</span>}
          </div>
        </div>

        {/* Profil trader */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Profil trader</h3>
            <button
              onClick={() => setShowOnboarding(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
            >
              <UserCircle className="w-3.5 h-3.5" />Questionnaire
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PROFILES.map(p => (
              <button
                key={p.key}
                onClick={() => saveProfile(p.key)}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  profile === p.key
                    ? 'bg-emerald-500/10 border-emerald-500/40'
                    : 'bg-gray-800 border-gray-700 hover:border-gray-500'
                }`}>
                <div className="text-sm font-medium text-white">{p.label}</div>
                <div className="text-xs text-gray-400 mt-1">{p.desc}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Profil actuel : <span data-testid="current-profile" className="text-emerald-400 capitalize">{profile}</span>
          </p>
        </div>

        <OnboardingModal
          isOpen={showOnboarding}
          onClose={() => setShowOnboarding(false)}
          onSelectProfile={(p: TraderProfile) => saveProfile(p)}
        />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">Stratégies de trading</h2>
            <p className="text-gray-500 text-sm mt-0.5">{activeCount} stratégie(s) activée(s)</p>
          </div>
        </div>

        {/* Erreurs */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm flex-1">Impossible de charger les stratégies.</span>
            <button onClick={() => refetch()} className="text-xs flex items-center gap-1 hover:text-red-300">
              <RefreshCw className="w-3.5 h-3.5" />Réessayer
            </button>
          </div>
        )}

        {/* Formulaire création */}
        {showForm && (
          <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h3 className="text-white font-semibold">Créer une stratégie</h3>
            {formError && <p className="text-red-400 text-sm">{formError}</p>}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nom *</label>
                <input required value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
                  placeholder="EMA + RSI Trend"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))}
                  placeholder="Stratégie tendancielle sur EMA croisées"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Règles JSON *</label>
              <textarea rows={8} value={form.rules} onChange={e => setForm(v => ({ ...v, rules: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors resize-none" />
              <p className="text-gray-600 text-xs mt-1">Définissez les paramètres de la stratégie en JSON.</p>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={create.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                {create.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
                {create.isPending ? 'Création...' : 'Créer la stratégie'}
              </button>
            </div>
          </form>
        )}

        {/* Liste stratégies */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" /><span>Chargement...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {(!strategies || strategies.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
                <Settings className="w-10 h-10 mb-3" />
                <p className="font-medium">Aucune stratégie</p>
                <p className="text-sm mt-1">Créez votre première stratégie ci-dessus</p>
              </div>
            )}
            {strategies?.map(s => (
              <div key={s.id} className={`bg-gray-900 border rounded-xl p-5 transition-colors ${s.isEnabledByUser ? 'border-emerald-500/30' : 'border-gray-800'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-white font-semibold">{s.name}</h3>
                      {s.isActive
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">Système actif</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-400 border border-gray-600">Inactif</span>}
                      {s.isEnabledByUser && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400"><Zap className="w-3 h-3" />Activée</span>
                      )}
                    </div>
                    {s.description && <p className="text-gray-500 text-sm mt-1">{s.description}</p>}
                    {expandedId === s.id && <RulesBadges rules={s.rules} />}
                  </div>

                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="p-1.5 text-gray-500 hover:text-white transition-colors">
                      {expandedId === s.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => toggle.mutate({ id: s.id, isEnabled: !s.isEnabledByUser })}
                      disabled={toggle.isPending}
                      title={s.isEnabledByUser ? 'Désactiver' : 'Activer'}
                      className="transition-colors">
                      {s.isEnabledByUser
                        ? <ToggleRight className="w-7 h-7 text-emerald-400 hover:text-emerald-300" />
                        : <ToggleLeft className="w-7 h-7 text-gray-600 hover:text-gray-400" />}
                    </button>

                    <button
                      title="Supprimer"
                      onClick={() => { if (confirm(`Supprimer "${s.name}" ?`)) remove.mutate(s.id); }}
                      disabled={remove.isPending}
                      className="p-1.5 text-gray-600 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {expandedId === s.id && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Règles</p>
                    <pre className="text-xs text-gray-400 bg-gray-800 rounded-lg p-3 overflow-auto max-h-48 font-mono">
                      {JSON.stringify(s.rules, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
