'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, RefreshCw, AlertCircle, Users, Radio, Lock, Globe, Bell, BellOff, Search } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface SignalChannel {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  visibility: string;
  isActive: boolean;
  subscriberCount: number;
  createdAt: string;
  owner?: { id: string; name: string };
}

type Tab = 'discover' | 'owned' | 'subscribed';

export default function SignalChannelsPage() {
  const [tab, setTab] = useState<Tab>('discover');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visibility: 'PUBLIC' });
  const [search, setSearch] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();

  const discoverQuery = useQuery<{ data: SignalChannel[]; total: number }>({
    queryKey: ['channels-discover'],
    queryFn: async () => (await api.get('/signal-channels/public')).data,
    enabled: tab === 'discover',
  });

  const ownedQuery = useQuery<SignalChannel[]>({
    queryKey: ['channels-owned'],
    queryFn: async () => (await api.get('/signal-channels/owned')).data,
    enabled: tab === 'owned',
  });

  const subscribedQuery = useQuery<SignalChannel[]>({
    queryKey: ['channels-subscribed'],
    queryFn: async () => (await api.get('/signal-channels/subscribed')).data,
    enabled: tab === 'subscribed',
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/signal-channels', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-owned'] });
      qc.invalidateQueries({ queryKey: ['channels-subscribed'] });
      setShowForm(false);
      setForm({ name: '', description: '', visibility: 'PUBLIC' });
      toast('Votre canal de signaux est en ligne.', { title: 'Canal créé', type: 'success' });
    },
    onError: (err: any) => toast(err?.response?.data?.message || 'Erreur.', { title: 'Erreur', type: 'error' }),
  });

  const subscribe = useMutation({
    mutationFn: (id: string) => api.post(`/signal-channels/${id}/subscribe`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-subscribed'] });
      qc.invalidateQueries({ queryKey: ['channels-discover'] });
      toast('Vous recevrez les signaux de ce canal.', { title: 'Abonné', type: 'success' });
    },
  });

  const unsubscribe = useMutation({
    mutationFn: (id: string) => api.delete(`/signal-channels/${id}/subscribe`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-subscribed'] });
      qc.invalidateQueries({ queryKey: ['channels-discover'] });
      toast('Désabonné du canal.', { title: 'Désabonné', type: 'info' });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/signal-channels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels-owned'] });
      toast('Canal supprimé.', { title: 'Canal supprimé', type: 'info' });
    },
  });

  const channels = tab === 'discover' ? discoverQuery.data?.data : tab === 'owned' ? ownedQuery.data : subscribedQuery.data;
  const isLoading = tab === 'discover' ? discoverQuery.isLoading : tab === 'owned' ? ownedQuery.isLoading : subscribedQuery.isLoading;
  const error = tab === 'discover' ? discoverQuery.error : tab === 'owned' ? ownedQuery.error : subscribedQuery.error;

  const subscribedIds = new Set(subscribedQuery.data?.map(c => c.id) ?? []);
  const ownedIds = new Set(ownedQuery.data?.map(c => c.id) ?? []);

  const filtered = (channels ?? []).filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase())
  );

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'discover', label: 'Découvrir', icon: Search },
    { key: 'owned', label: 'Mes canaux', icon: Radio },
    { key: 'subscribed', label: 'Mes abonnements', icon: Bell },
  ];

  return (
    <AppLayout title="Canaux de signaux">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">Canaux de signaux</h2>
            <p className="text-gray-500 text-sm mt-0.5">Découvrez et abonnez-vous aux canaux de traders</p>
          </div>
          {tab === 'owned' && (
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />{showForm ? 'Annuler' : 'Créer un canal'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* Create form */}
        {showForm && tab === 'owned' && (
          <form
            onSubmit={e => { e.preventDefault(); create.mutate(form); }}
            className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-white font-semibold">Créer un canal</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Nom *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
                  placeholder="Signaux Crypto Swing"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Visibilité</label>
                <select
                  value={form.visibility}
                  onChange={e => setForm(v => ({ ...v, visibility: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="PUBLIC">Public — visible par tous</option>
                  <option value="PRIVATE">Privé — sur invitation</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(v => ({ ...v, description: e.target.value }))}
                placeholder="Décrivez votre stratégie et le type de signaux..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={create.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                {create.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
                {create.isPending ? 'Création...' : 'Créer le canal'}
              </button>
            </div>
          </form>
        )}

        {/* Search */}
        {tab === 'discover' && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un canal..."
              className="w-full pl-10 pr-4 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm flex-1">Impossible de charger les canaux.</span>
          </div>
        )}

        {/* Channel list */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
            <RefreshCw className="w-4 h-4 animate-spin" /><span>Chargement...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
                <Radio className="w-10 h-10 mb-3" />
                <p className="font-medium">Aucun canal</p>
                <p className="text-sm mt-1">
                  {tab === 'discover' ? 'Aucun canal public trouvé.' : tab === 'owned' ? 'Créez votre premier canal.' : 'Abonnez-vous à des canaux.'}
                </p>
              </div>
            )}
            {filtered.map(c => {
              const isOwned = ownedIds.has(c.id);
              const isSubscribed = subscribedIds.has(c.id);
              return (
                <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {c.visibility === 'PRIVATE' ? (
                        <Lock className="w-4 h-4 text-gray-500" />
                      ) : (
                        <Globe className="w-4 h-4 text-emerald-400" />
                      )}
                      <h3 className="text-white font-semibold">{c.name}</h3>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Users className="w-3.5 h-3.5" />
                      {c.subscriberCount}
                    </div>
                  </div>
                  {c.description && <p className="text-gray-400 text-sm mb-3 line-clamp-2">{c.description}</p>}
                  {c.owner && <p className="text-xs text-gray-600 mb-3">par {c.owner.name}</p>}
                  <div className="flex items-center gap-2">
                    {isOwned ? (
                      <button
                        onClick={() => { if (confirm(`Supprimer "${c.name}" ?`)) remove.mutate(c.id); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />Supprimer
                      </button>
                    ) : isSubscribed ? (
                      <button
                        onClick={() => unsubscribe.mutate(c.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors"
                      >
                        <BellOff className="w-3.5 h-3.5" />Se désabonner
                      </button>
                    ) : (
                      <button
                        onClick={() => subscribe.mutate(c.id)}
                        disabled={subscribe.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-white font-medium rounded-lg transition-colors"
                      >
                        <Bell className="w-3.5 h-3.5" />S&rsquo;abonner
                      </button>
                    )}
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
