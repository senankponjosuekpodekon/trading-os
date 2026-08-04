'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Zap, RefreshCw, AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/store/auth.store';

interface LlmConfig {
  ollamaEnabled: boolean;
  openaiEnabled: boolean;
  preferred: 'ollama' | 'openai';
}

export default function LlmConfigPage() {
  const [form, setForm] = useState<Partial<LlmConfig>>({});
  const [formError, setFormError] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();
  const user = useAuthStore(s => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data: config, isLoading, error, refetch } = useQuery<LlmConfig>({
    queryKey: ['llm-config'],
    queryFn: async () => (await api.get('/system/llm-config')).data,
    enabled: isSuperAdmin,
  });

  const current: LlmConfig = {
    ollamaEnabled: config?.ollamaEnabled ?? true,
    openaiEnabled: config?.openaiEnabled ?? true,
    preferred: config?.preferred ?? 'ollama',
    ...form,
  };

  const save = useMutation({
    mutationFn: (data: Partial<LlmConfig>) => api.patch('/system/llm-config', data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['llm-config'] });
      setForm({});
      toast('Configuration LLM mise à jour. Le moteur appliquera le changement dans ~15s.', { title: 'Sauvegardé', type: 'success' });
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message || 'Erreur lors de la sauvegarde.');
    },
  });

  const handleSave = () => {
    setFormError('');
    if (!current.ollamaEnabled && !current.openaiEnabled) {
      setFormError('Au moins un provider doit être activé.');
      return;
    }
    save.mutate(form);
  };

  const hasChanges = Object.keys(form).length > 0;

  if (!isSuperAdmin) {
    return (
      <AppLayout title="Configuration LLM">
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <AlertCircle className="w-10 h-10 mb-3 text-gray-600" />
          <p className="font-medium">Accès restreint</p>
          <p className="text-sm mt-1">Seuls les super-administrateurs peuvent configurer les providers LLM.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Configuration LLM">
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h2 className="text-white font-semibold text-lg">Configuration des providers LLM</h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Contrôlez quels modèles IA sont utilisés et dans quel ordre. Les changements sont appliqués à chaud.
          </p>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="text-blue-300 font-medium">Comment ça marche ?</p>
            <p className="text-gray-400">
              Le moteur lit cette configuration toutes les 15 secondes. Si un provider est désactivé,
              il n'est jamais contacté — aucune charge CPU/RAM correspondante sur le VPS.
            </p>
            <p className="text-gray-400">
              Le provider <strong className="text-gray-300">préféré</strong> est essayé en premier.
              En cas d'échec, l'autre provider (s'il est activé) est utilisé comme fallback.
            </p>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" /><span>Chargement...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm flex-1">Impossible de charger la configuration.</span>
            <button onClick={() => refetch()} className="text-xs flex items-center gap-1 hover:text-red-300">
              <RefreshCw className="w-3.5 h-3.5" />Réessayer
            </button>
          </div>
        )}

        {formError && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />{formError}
          </div>
        )}

        {/* Ollama card */}
        {config && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-orange-400" />
                <h3 className="text-white font-semibold">Ollama (Local)</h3>
                {current.ollamaEnabled && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Actif
                  </span>
                )}
              </div>
              <Toggle
                checked={current.ollamaEnabled}
                onChange={(v) => setForm(f => ({ ...f, ollamaEnabled: v }))}
              />
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Modèle local tournant sur le VPS (llama3.2). Gratuit mais consomme ~190% CPU / 3GB RAM par requête.</p>
              <p className="text-gray-600">Désactiver si le VPS est sous forte charge pour libérer des ressources.</p>
            </div>
          </div>
        )}

        {/* OpenAI card */}
        {config && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <h3 className="text-white font-semibold">OpenAI (Cloud)</h3>
                {current.openaiEnabled && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Actif
                  </span>
                )}
              </div>
              <Toggle
                checked={current.openaiEnabled}
                onChange={(v) => setForm(f => ({ ...f, openaiEnabled: v }))}
              />
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p>GPT-4o via API. Rapide, haute qualité, mais payant (facturation par token).</p>
              <p className="text-gray-600">Les réponses sont mises en cache pour réduire les coûts (explain + review positions fermées).</p>
            </div>
          </div>
        )}

        {/* Preferred provider */}
        {config && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              <h3 className="text-white font-semibold">Provider préféré</h3>
            </div>
            <p className="text-xs text-gray-500">
              Le provider préféré est essayé en premier. L'autre sert de fallback en cas d'échec.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setForm(f => ({ ...f, preferred: 'ollama' }))}
                disabled={!current.ollamaEnabled}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
                  current.preferred === 'ollama'
                    ? 'bg-orange-500/20 border border-orange-500/40 text-orange-300'
                    : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <Cpu className="w-4 h-4" />Ollama d'abord
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, preferred: 'openai' }))}
                disabled={!current.openaiEnabled}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
                  current.preferred === 'openai'
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                    : 'bg-gray-800 border border-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-4 h-4" />OpenAI d'abord
              </button>
            </div>
          </div>
        )}

        {/* Save button */}
        {config && (
          <div className="flex items-center justify-between sticky bottom-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {hasChanges ? (
                <span className="text-yellow-400">Modifications non sauvegardées</span>
              ) : (
                <span>Tous les changements sont sauvegardés</span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={!hasChanges || save.isPending}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {save.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
              {save.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-gray-700'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  );
}
