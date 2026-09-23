'use client';
import { useState } from 'react';
import { Wrench, RefreshCw, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

const inputCls =
  'w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors';

export default function MaintenancePage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', opinion: '', contribution: '', objectives: '' });
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    try {
      await api.post('/waitlist', form);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Wrench className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Maintenance en cours</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Trading OS est momentanément en maintenance. Laisse tes coordonnées
            et on te prévient dès que le service est de retour.
          </p>
        </div>

        {status === 'done' ? (
          <div className="bg-gray-900 border border-emerald-500/30 rounded-xl p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
            <p className="text-white font-semibold mb-1">C&apos;est noté !</p>
            <p className="text-gray-400 text-sm">Tu recevras un email dès que la plateforme sera de retour.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Nom complet *</label>
                <input required value={form.name} onChange={set('name')} className={inputCls} placeholder="Jean Dupont" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Téléphone</label>
                <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+225 …" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Email *</label>
              <input required type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="vous@exemple.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Ce que tu penses de la solution</label>
              <textarea value={form.opinion} onChange={set('opinion')} rows={2} className={inputCls} placeholder="Ton avis, tes attentes…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Ce que tu pourrais apporter</label>
              <textarea value={form.contribution} onChange={set('contribution')} rows={2} className={inputCls} placeholder="Compétences, capital, feedback…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Tes objectifs</label>
              <textarea value={form.objectives} onChange={set('objectives')} rows={2} className={inputCls} placeholder="Ce que tu veux accomplir avec Trading OS…" />
            </div>

            {status === 'error' && (
              <p className="text-red-400 text-sm">Erreur lors de l&apos;envoi — réessaie dans un instant.</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={status === 'saving'}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {status === 'saving' ? 'Envoi…' : 'Me prévenir au retour'}
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
