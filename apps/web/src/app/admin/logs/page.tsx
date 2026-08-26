'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { FileText, RefreshCw, ShieldAlert, Search, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, any>;
}

interface LogResponse {
  file: string;
  size: number;
  lastModified: string;
  limit: number;
  count: number;
  entries: LogEntry[];
}

const levelIcon = (level: string) => {
  if (level === 'error') return <XCircle className="w-4 h-4 text-red-400" />;
  if (level === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (level === 'log') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  return <Info className="w-4 h-4 text-blue-400" />;
};

const levelClass = (level: string) => {
  if (level === 'error') return 'bg-red-500/10 text-red-400 border-red-500/30';
  if (level === 'warn') return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  if (level === 'log') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
  return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
};

export default function AdminLogsPage() {
  const user = useAuthStore((s) => s.user);
  const [file, setFile] = useState('app');
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');

  const { data, isLoading, refetch, isFetching } = useQuery<LogResponse>({
    queryKey: ['admin-logs', file, limit, search, level],
    queryFn: async () => {
      const params = new URLSearchParams({ file, limit: String(limit) });
      if (search) params.set('search', search);
      if (level) params.set('level', level);
      const { data } = await api.get(`/admin/logs?${params.toString()}`);
      return data;
    },
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
    refetchInterval: 5000,
  });

  if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return (
      <AppLayout title="Accès refusé">
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white">Accès refusé</h2>
            <p className="text-gray-400 mt-2">Vous devez être administrateur pour accéder aux logs.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Logs système">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6" /> Logs système
          </h1>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> Rafraîchir
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fichier</label>
              <select
                value={file}
                onChange={(e) => setFile(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none"
              >
                <option value="app">app.log</option>
                <option value="error">error.log</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre de lignes</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Niveau</label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none"
              >
                <option value="">Tous</option>
                <option value="log">log</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="email, userId, message..."
                  className="w-full bg-gray-800 text-white text-sm rounded-lg pl-9 pr-3 py-2 border border-gray-700 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>

          {data && (
            <div className="flex flex-wrap gap-4 text-xs text-gray-400 border-t border-gray-800 pt-3">
              <span>Fichier: <span className="text-gray-300 font-mono">{data.file}</span></span>
              <span>Taille: <span className="text-gray-300">{data.size.toLocaleString()} octets</span></span>
              <span>Entrées affichées: <span className="text-gray-300">{data.count}</span></span>
              <span>Modifié: <span className="text-gray-300">{new Date(data.lastModified).toLocaleString()}</span></span>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-5 h-5 animate-spin" /> Chargement des logs...
            </div>
          ) : data?.entries?.length ? (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 z-10">
                  <tr className="border-b border-gray-800 text-gray-400 text-left">
                    <th className="px-4 py-3 w-28">Niveau</th>
                    <th className="px-4 py-3 w-44">Timestamp</th>
                    <th className="px-4 py-3">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border ${levelClass(entry.level)}`}>
                          {levelIcon(entry.level)} {entry.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 align-top whitespace-nowrap">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-gray-200 font-medium">{entry.message}</p>
                        {entry.meta && Object.keys(entry.meta).length > 0 && (
                          <pre className="mt-1.5 text-xs text-gray-500 overflow-x-auto max-w-2xl">
                            {JSON.stringify(entry.meta, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">Aucune entrée trouvée.</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
