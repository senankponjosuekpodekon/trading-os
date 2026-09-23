'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BellRing, Download, Users } from 'lucide-react';

interface WaitlistEntry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  opinion: string | null;
  contribution: string | null;
  objectives: string | null;
  contactedAt: string | null;
  createdAt: string;
}

export default function AdminWaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [notifyResult, setNotifyResult] = useState<string | null>(null);

  const fetchEntries = () => {
    api.get('/admin/waitlist')
      .then((res) => setEntries(res.data))
      .catch(() => setError('Impossible de charger la waitlist'))
      .finally(() => setLoading(false));
  };

  useEffect(fetchEntries, []);

  const notifyAll = async () => {
    setNotifying(true);
    setNotifyResult(null);
    try {
      const res = await api.post('/admin/waitlist/notify');
      setNotifyResult(`${res.data.notified}/${res.data.total} notifié(s)`);
      fetchEntries();
    } catch {
      setError('Impossible d\'envoyer les notifications');
    } finally {
      setNotifying(false);
    }
  };

  const exportCsv = () => {
    const header = 'name;email;phone;opinion;contribution;objectives;contacted_at;created_at';
    const rows = entries.map((e) =>
      [e.name, e.email, e.phone, e.opinion, e.contribution, e.objectives, e.contactedAt, e.createdAt]
        .map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`)
        .join(';'),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pending = entries.filter((e) => !e.contactedAt).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Waitlist maintenance</h1>
          <span className="text-xs text-gray-500">{entries.length} inscrit(s) · {pending} à notifier</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs disabled:opacity-40 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={notifyAll}
            disabled={notifying || pending === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40 transition-colors"
          >
            <BellRing className="w-3.5 h-3.5" />
            {notifying ? 'Envoi…' : `Notifier les ${pending} en attente`}
          </button>
        </div>
      </div>

      {notifyResult && <p className="text-emerald-400 text-sm mb-4">{notifyResult}</p>}
      {loading && <p className="text-gray-500">Chargement…</p>}
      {error && <p className="text-red-400">{error}</p>}

      {!loading && entries.length === 0 && (
        <p className="text-gray-500 text-sm">Aucune inscription pour le moment.</p>
      )}

      <div className="space-y-3">
        {entries.map((e) => (
          <div key={e.id} className="p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-white font-medium">{e.name}</p>
                <p className="text-xs text-gray-500">
                  {e.email}
                  {e.phone ? ` · ${e.phone}` : ''}
                  {' · '}
                  {new Date(e.createdAt).toLocaleString('fr-FR')}
                </p>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  e.contactedAt
                    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                    : 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                }`}
              >
                {e.contactedAt ? 'Contacté' : 'En attente'}
              </span>
            </div>
            {(e.opinion || e.contribution || e.objectives) && (
              <div className="mt-3 grid gap-2 text-xs text-gray-400">
                {e.opinion && <p><span className="text-gray-500">Avis :</span> {e.opinion}</p>}
                {e.contribution && <p><span className="text-gray-500">Apport :</span> {e.contribution}</p>}
                {e.objectives && <p><span className="text-gray-500">Objectifs :</span> {e.objectives}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
