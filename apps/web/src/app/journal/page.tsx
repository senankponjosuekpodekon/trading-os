'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Star, AlertCircle, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { JournalEntry } from '@/types';

const EMOTIONS = ['😊 Confiant', '😰 Stressé', '😤 Frustré', '😌 Neutre', '🤑 Euphorique', '😱 Paniqué'];

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
      <AlertCircle className="w-5 h-5 shrink-0" />
      <span className="text-sm flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 text-xs hover:text-red-300 transition-colors">
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Réessayer
        </button>
      )}
    </div>
  );
}

function GradeStars({ grade }: { grade?: number | null }) {
  if (!grade) return <span className="text-gray-600 text-sm">—</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= grade ? 'text-yellow-400 fill-yellow-400' : 'text-gray-700'}`} />
      ))}
    </div>
  );
}

export default function JournalPage() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', emotion: '', grade: 3, tags: '' });
  const qc = useQueryClient();

  const { data: entries, isLoading, error: errorEntries, refetch } = useQuery<JournalEntry[]>({
    queryKey: ['journal'],
    queryFn: async () => (await api.get('/journal?limit=50')).data.data,
  });

  const { data: stats } = useQuery<{ total: number; avgGrade: number | null; emotions: Record<string, number> }>({
    queryKey: ['journal-stats'],
    queryFn: async () => (await api.get('/journal/stats')).data,
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/journal', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['journal-stats'] });
      setShowForm(false);
      setForm({ title: '', content: '', emotion: '', grade: 3, tags: '' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({
      title: form.title,
      content: form.content,
      emotion: form.emotion || undefined,
      grade: form.grade,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    });
  };

  const topEmotion = stats?.emotions
    ? Object.entries(stats.emotions).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  return (
    <AppLayout title="Journal de trading">
      <div className="space-y-5">

        {errorEntries && <ErrorBox message="Impossible de charger le journal." onRetry={() => refetch()} />}
        {create.isError && <ErrorBox message={(create.error as any)?.response?.data?.message ?? "Erreur lors de la sauvegarde."} />}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Entrées</p>
            <p className="text-2xl font-bold text-white">{stats?.total ?? 0}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Note moyenne</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-2xl font-bold text-white">{stats?.avgGrade ? stats.avgGrade.toFixed(1) : '—'}</p>
              {stats?.avgGrade && <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">Émotion dominante</p>
            <p className="text-lg font-semibold text-white">{topEmotion ?? '—'}</p>
          </div>
        </div>

        {/* Bouton */}
        <div className="flex justify-end">
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors">
            <Plus className="w-4 h-4" />{showForm ? 'Annuler' : 'Nouvelle entrée'}
          </button>
        </div>

        {/* Formulaire */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Titre *</label>
              <input required value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))}
                placeholder="Ex: Setup EUR/USD 4H — Fakeout résistance"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Analyse & réflexions *</label>
              <textarea required rows={4} value={form.content} onChange={e => setForm(v => ({ ...v, content: e.target.value }))}
                placeholder="Qu'est-ce qui s'est passé ? Qu'aurais-je pu faire différemment ?"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors resize-none" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Émotion</label>
                <select value={form.emotion} onChange={e => setForm(v => ({ ...v, emotion: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500">
                  <option value="">Choisir...</option>
                  {EMOTIONS.map(em => <option key={em} value={em}>{em}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Note /5</label>
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3, 4, 5].map(i => (
                    <button key={i} type="button" onClick={() => setForm(v => ({ ...v, grade: i }))}>
                      <Star className={`w-6 h-6 transition-colors ${i <= form.grade ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Tags (virgules)</label>
                <input value={form.tags} onChange={e => setForm(v => ({ ...v, tags: e.target.value }))}
                  placeholder="fomo, patience, btc"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={create.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                {create.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
                {create.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
          </form>
        )}

        {/* Liste */}
        <div className="space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-600">
              <RefreshCw className="w-4 h-4 animate-spin" /><span>Chargement...</span>
            </div>
          )}
          {!isLoading && (!entries || entries.length === 0) && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
              <BookOpen className="w-10 h-10 mb-3" />
              <p className="font-medium">Aucune entrée</p>
              <p className="text-sm mt-1">Commencez à documenter votre trading ci-dessus</p>
            </div>
          )}
          {entries?.map(entry => (
            <div key={entry.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h3 className="text-white font-semibold text-sm">{entry.title}</h3>
                    {entry.emotion && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-300">{entry.emotion}</span>
                    )}
                    {entry.position?.asset?.symbol && (
                      <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">{entry.position.asset.symbol}</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed line-clamp-3">{entry.content}</p>
                  {entry.tags?.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {entry.tags.map(t => (
                        <span key={t} className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <GradeStars grade={entry.grade} />
                  <p className="text-xs text-gray-600">{new Date(entry.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
