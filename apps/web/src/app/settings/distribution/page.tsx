'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, RefreshCw, AlertCircle, CheckCircle2, MessageCircle, Globe, Mail, ShieldCheck, Info } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface NotificationPreference {
  id: string;
  telegramChatId: string | null;
  telegramEnabled: boolean;
  discordWebhookUrl: string | null;
  discordEnabled: boolean;
  emailEnabled: boolean;
  minConfidence: number;
}

export default function DistributionSettingsPage() {
  const [form, setForm] = useState<Partial<NotificationPreference>>({});
  const [formError, setFormError] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: pref, isLoading, error, refetch } = useQuery<NotificationPreference>({
    queryKey: ['notification-preferences'],
    queryFn: async () => (await api.get('/notifications/preferences')).data,
  });

  const current = { ...pref, ...form };

  const save = useMutation({
    mutationFn: (data: any) => api.patch('/notifications/preferences', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-preferences'] });
      setForm({});
      toast('Préférences sauvegardées.', { title: 'Sauvegardé', type: 'success' });
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message || 'Erreur lors de la sauvegarde.');
    },
  });

  const testTelegram = useMutation({
    mutationFn: () => api.post('/notifications/preferences/test-telegram'),
    onSuccess: (res: any) => toast(res.data?.message || 'Test envoyé.', { title: 'Telegram', type: 'success' }),
    onError: (err: any) => toast(err?.response?.data?.message || 'Échec du test.', { title: 'Telegram', type: 'error' }),
  });

  const testDiscord = useMutation({
    mutationFn: () => api.post('/notifications/preferences/test-discord'),
    onSuccess: (res: any) => toast(res.data?.message || 'Test envoyé.', { title: 'Discord', type: 'success' }),
    onError: (err: any) => toast(err?.response?.data?.message || 'Échec du test.', { title: 'Discord', type: 'error' }),
  });

  const handleSave = () => {
    setFormError('');
    const payload: any = {};
    if (form.telegramChatId !== undefined) payload.telegramChatId = form.telegramChatId;
    if (form.telegramEnabled !== undefined) payload.telegramEnabled = form.telegramEnabled;
    if (form.discordWebhookUrl !== undefined) payload.discordWebhookUrl = form.discordWebhookUrl;
    if (form.discordEnabled !== undefined) payload.discordEnabled = form.discordEnabled;
    if (form.emailEnabled !== undefined) payload.emailEnabled = form.emailEnabled;
    if (form.minConfidence !== undefined) payload.minConfidence = form.minConfidence;
    save.mutate(payload);
  };

  const hasChanges = Object.keys(form).length > 0;

  return (
    <AppLayout title="Distribution de signaux">
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h2 className="text-white font-semibold text-lg">Distribution de signaux</h2>
          <p className="text-gray-500 text-sm mt-0.5">Configurez où recevoir vos signaux de trading en temps réel</p>
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-blue-300 font-medium">Comment ça marche ?</p>
            <p className="text-gray-400 mt-1">
              Quand un signal est généré (confidence ≥ seuil), il est automatiquement envoyé sur vos canaux configurés.
              Vous pouvez activer plusieurs canaux simultanément.
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
            <span className="text-sm flex-1">Impossible de charger les préférences.</span>
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

        {/* Telegram section */}
        {pref && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-cyan-400" />
                <h3 className="text-white font-semibold">Telegram</h3>
                {current.telegramEnabled && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Actif
                  </span>
                )}
              </div>
              <Toggle
                checked={current.telegramEnabled ?? false}
                onChange={(v) => setForm(f => ({ ...f, telegramEnabled: v }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Chat ID Telegram</label>
              <input
                type="text"
                value={current.telegramChatId ?? ''}
                onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                placeholder="@votre_channel ou -1001234567890"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-cyan-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Pour un channel: <code className="text-gray-400">@nom_channel</code>. Pour un groupe: ID numérique (ex: <code className="text-gray-400">-1001234567890</code>).
                Le bot doit être administrateur du channel/groupe.
              </p>
            </div>
            <button
              onClick={() => testTelegram.mutate()}
              disabled={testTelegram.isPending || !current.telegramChatId}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {testTelegram.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Envoyer un test
            </button>
          </div>
        )}

        {/* Discord section */}
        {pref && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-violet-400" />
                <h3 className="text-white font-semibold">Discord</h3>
                {current.discordEnabled && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Actif
                  </span>
                )}
              </div>
              <Toggle
                checked={current.discordEnabled ?? false}
                onChange={(v) => setForm(f => ({ ...f, discordEnabled: v }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">URL Webhook Discord</label>
              <input
                type="text"
                value={current.discordWebhookUrl ?? ''}
                onChange={e => setForm(f => ({ ...f, discordWebhookUrl: e.target.value }))}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-violet-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Créez un webhook dans votre serveur Discord: Paramètres → Intégrations → Webhooks → Nouveau webhook → Copier l'URL.
              </p>
            </div>
            <button
              onClick={() => testDiscord.mutate()}
              disabled={testDiscord.isPending || !current.discordWebhookUrl}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 disabled:opacity-50 rounded-lg transition-colors"
            >
              {testDiscord.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Envoyer un test
            </button>
          </div>
        )}

        {/* Email section */}
        {pref && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-400" />
                <h3 className="text-white font-semibold">Email</h3>
                {current.emailEnabled && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />Actif
                  </span>
                )}
              </div>
              <Toggle
                checked={current.emailEnabled ?? true}
                onChange={(v) => setForm(f => ({ ...f, emailEnabled: v }))}
              />
            </div>
            <p className="text-xs text-gray-500">
              Les signaux importants (confidence ≥ seuil) sont envoyés par email à votre adresse enregistrée.
            </p>
          </div>
        )}

        {/* Confidence threshold */}
        {pref && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-white font-semibold mb-1">Seuil de confiance minimum</h3>
              <p className="text-xs text-gray-500 mb-3">
                Seuls les signaux avec une confidence ≥ ce seuil seront distribués.
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={current.minConfidence ?? 60}
                  onChange={e => setForm(f => ({ ...f, minConfidence: parseInt(e.target.value) }))}
                  className="flex-1 accent-emerald-500"
                />
                <span className="text-white font-mono text-lg font-bold w-12 text-right">
                  {current.minConfidence ?? 60}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        {pref && (
          <div className="flex items-center justify-between sticky bottom-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="w-3.5 h-3.5" />
              {hasChanges ? 'Modifications non sauvegardées' : 'Tous les changements sont sauvegardés'}
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
