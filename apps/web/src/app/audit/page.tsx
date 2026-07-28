'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Shield, ChevronLeft, ChevronRight } from 'lucide-react';

interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  details: Record<string, any> | null;
  createdAt: string;
}

interface AuditResponse {
  data: AuditEntry[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data: result, isLoading } = useQuery<AuditResponse>({
    queryKey: ['audit', page],
    queryFn: async () => (await api.get(`/audit?page=${page}&limit=20`)).data,
  });

  const entries = result?.data ?? [];
  const meta = result?.meta;

  return (
    <AppLayout title="Audit trail">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />Audit trail
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Historique des actions sensibles sur votre compte.</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
            <div className="col-span-2">Date</div>
            <div className="col-span-2">Action</div>
            <div className="col-span-2">Ressource</div>
            <div className="col-span-6">Détails</div>
          </div>

          {isLoading && (
            <div className="px-4 py-10 text-center text-gray-600 text-sm">Chargement...</div>
          )}

          {!isLoading && entries.length === 0 && (
            <div className="px-4 py-12 text-center text-gray-500 text-sm">Aucune entrée d’audit.</div>
          )}

          {entries.map(entry => (
            <div
              key={entry.id}
              className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 last:border-0 items-center text-sm"
            >
              <div className="col-span-2 text-gray-400 text-xs">
                {new Date(entry.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
              </div>
              <div className="col-span-2">
                <span className="text-xs px-2 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300">
                  {entry.action}
                </span>
              </div>
              <div className="col-span-2 text-gray-300">{entry.resource}</div>
              <div className="col-span-6 text-gray-400 text-xs truncate font-mono">
                {entry.details ? JSON.stringify(entry.details) : '—'}
              </div>
            </div>
          ))}
        </div>

        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-emerald-500/40 disabled:opacity-50 text-sm"
            >
              <ChevronLeft className="w-4 h-4" />Précédent
            </button>
            <span className="text-sm text-gray-500">
              Page {meta.page} / {meta.totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
              disabled={page === meta.totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-gray-300 hover:border-emerald-500/40 disabled:opacity-50 text-sm"
            >
              Suivant<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
