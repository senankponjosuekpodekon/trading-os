'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Settings, Cpu } from 'lucide-react';

interface CronConfig {
  name: string;
  enabled: boolean;
  description: string;
}

export default function AdminOpsPage() {
  const [crons, setCrons] = useState<CronConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchCrons = () => {
    api.get('/admin/ops/crons')
      .then(res => setCrons(res.data))
      .catch(() => setError('Impossible de charger les crons'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCrons();
  }, []);

  const toggleCron = async (name: string, enabled: boolean) => {
    setSaving(name);
    try {
      await api.patch('/admin/ops/crons', { name, enabled });
      setCrons(prev => prev.map(c => c.name === name ? { ...c, enabled } : c));
    } catch {
      setError('Impossible de mettre à jour le cron');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Cpu className="w-6 h-6 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">Gestion des crons</h1>
      </div>

      {loading && <p className="text-gray-500">Chargement…</p>}
      {error && <p className="text-red-400">{error}</p>}

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Cron</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">État</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {crons.map(cron => (
              <tr key={cron.name} className="hover:bg-gray-900/50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-300">{cron.name}</td>
                <td className="px-4 py-3 text-gray-400">{cron.description}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleCron(cron.name, !cron.enabled)}
                    disabled={saving === cron.name}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      cron.enabled ? 'bg-emerald-500' : 'bg-gray-700'
                    } ${saving === cron.name ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        cron.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className={`ml-2 text-xs ${cron.enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {cron.enabled ? 'Activé' : 'Désactivé'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
