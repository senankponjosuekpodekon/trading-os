'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Users, Search, UserCog, Shield, ShieldCheck, ShieldAlert, Ban, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  timezone: string;
  createdAt: string;
  _count: { portfolios: number; strategies: number };
}

const roleIcon = (role: string) => {
  switch (role) {
    case 'SUPER_ADMIN': return <ShieldAlert className="w-4 h-4 text-red-400" />;
    case 'ADMIN': return <ShieldCheck className="w-4 h-4 text-orange-400" />;
    case 'INVESTOR': return <Shield className="w-4 h-4 text-blue-400" />;
    default: return <UserCog className="w-4 h-4 text-gray-400" />;
  }
};

const roleColor = (role: string) => {
  switch (role) {
    case 'SUPER_ADMIN': return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'ADMIN': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'INVESTOR': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
};

export default function AdminUsersPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, search],
    queryFn: async () => {
      const { data } = await api.get('/admin/users', { params: { page, limit: 20, search } });
      return data;
    },
    enabled: user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN',
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; role?: string; isActive?: boolean }) => {
      const { data } = await api.patch(`/admin/users/${id}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
    return (
      <AppLayout title="Accès refusé">
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white">Accès refusé</h2>
            <p className="text-gray-400 mt-2">Vous devez être administrateur pour accéder à cette page.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Gestion des utilisateurs">
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Gestion des utilisateurs</h1>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Rechercher par email ou nom..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-800 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* Users table */}
        {isLoading ? (
          <div className="text-gray-400 text-sm">Chargement...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-3 pr-4">Utilisateur</th>
                  <th className="pb-3 pr-4">Rôle</th>
                  <th className="pb-3 pr-4">Statut</th>
                  <th className="pb-3 pr-4">Portefeuilles</th>
                  <th className="pb-3 pr-4">Stratégies</th>
                  <th className="pb-3 pr-4">Créé le</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.data?.map((u: AdminUser) => (
                  <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-white">{u.name}</div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${roleColor(u.role)}`}>
                        {roleIcon(u.role)}
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Actif
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-400">
                          <Ban className="w-3 h-3" /> Inactif
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-400">{u._count.portfolios}</td>
                    <td className="py-3 pr-4 text-gray-400">{u._count.strategies}</td>
                    <td className="py-3 pr-4 text-gray-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="py-3">
                      <select
                        value={u.role}
                        onChange={(e) => updateMutation.mutate({ id: u.id, role: e.target.value })}
                        className="bg-gray-900 border border-gray-800 rounded text-xs px-2 py-1 text-white"
                        disabled={u.id === user?.id}
                      >
                        <option value="TRADER">TRADER</option>
                        <option value="INVESTOR">INVESTOR</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                      </select>
                      <button
                        onClick={() => updateMutation.mutate({ id: u.id, isActive: !u.isActive })}
                        className="ml-2 text-xs px-2 py-1 rounded border border-gray-700 hover:bg-gray-800 text-gray-400"
                        disabled={u.id === user?.id}
                      >
                        {u.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-gray-800 text-sm text-gray-400 disabled:opacity-30"
            >
              Précédent
            </button>
            <span className="text-sm text-gray-500">
              Page {data.meta.page} / {data.meta.totalPages} ({data.meta.total} utilisateurs)
            </span>
            <button
              onClick={() => setPage(p => Math.min(data.meta.totalPages, p + 1))}
              disabled={page === data.meta.totalPages}
              className="px-3 py-1 rounded border border-gray-800 text-sm text-gray-400 disabled:opacity-30"
            >
              Suivant
            </button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
