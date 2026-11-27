'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, XCircle, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface Mt5Position {
  ticket: number;
  symbol: string;
  type: number;          // 0=BUY 1=SELL
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  profit: number;
  magic: number;
}

export default function Mt5PositionsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmAll, setConfirmAll] = useState(false);

  const { data: positions, isLoading, error, refetch } = useQuery<Mt5Position[]>({
    queryKey: ['mt5-positions'],
    queryFn: async () => (await api.get('/execution/mt5/positions')).data,
    refetchInterval: 15000,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mt5-positions'] });

  const closeSym = useMutation({
    mutationFn: (symbol: string) => api.post('/execution/mt5/close', { symbol }),
    onSuccess: () => { toast('Position(s) fermée(s).', { type: 'success' }); invalidate(); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Erreur fermeture', { type: 'error' }),
  });

  const closeAll = useMutation({
    mutationFn: () => api.post('/execution/mt5/close-all'),
    onSuccess: () => { toast('Toutes les positions fermées.', { type: 'warning' }); setConfirmAll(false); invalidate(); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Erreur close-all', { type: 'error' }),
  });

  const modify = useMutation({
    mutationFn: (d: { symbol: string; sl?: number; tp?: number }) => api.post('/execution/mt5/modify', d),
    onSuccess: () => { toast('SL/TP modifiés.', { type: 'success' }); invalidate(); },
    onError: (e: any) => toast(e?.response?.data?.message || 'Erreur modification', { type: 'error' }),
  });

  const handleModify = (p: Mt5Position) => {
    const sl = window.prompt(`Nouveau SL pour ${p.symbol} (actuel ${p.sl || '—'}) — vide = inchangé`, '');
    const tp = window.prompt(`Nouveau TP pour ${p.symbol} (actuel ${p.tp || '—'}) — vide = inchangé`, '');
    const body: any = { symbol: p.symbol };
    if (sl) body.sl = parseFloat(sl);
    if (tp) body.tp = parseFloat(tp);
    if (body.sl == null && body.tp == null) return;
    modify.mutate(body);
  };

  if (error) return null; // pas de connexion MT5 → panneau masqué

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-orange-400" />
          <h3 className="text-white font-semibold">Positions MT5 (compte bridge)</h3>
          <span className="text-xs text-gray-500">raffraîchi toutes les 15s</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="text-gray-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
          {!!positions?.length && (
            <button
              onClick={() => (confirmAll ? closeAll.mutate() : setConfirmAll(true))}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium ${confirmAll ? 'bg-red-500 text-white' : 'border border-red-500/40 text-red-400 hover:bg-red-500/10'}`}
            >
              {confirmAll ? 'Confirmer TOUT FERMER' : 'Tout fermer'}
            </button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Chargement…</p>}

      {!isLoading && !positions?.length && (
        <p className="text-gray-500 text-sm">Aucune position ouverte sur le compte MT5.</p>
      )}

      {!!positions?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="text-left py-2">Symbole</th><th>Sens</th><th>Vol</th>
                <th className="text-right">Entrée</th><th className="text-right">SL</th>
                <th className="text-right">TP</th><th className="text-right">P&L</th><th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.ticket} className="border-b border-gray-800/50">
                  <td className="py-2 text-white font-medium">{p.symbol}</td>
                  <td className={p.type === 0 ? 'text-emerald-400' : 'text-red-400'}>{p.type === 0 ? 'BUY' : 'SELL'}</td>
                  <td className="text-gray-300">{p.volume}</td>
                  <td className="text-right text-gray-300">{p.price_open}</td>
                  <td className="text-right text-gray-400">{p.sl || '—'}</td>
                  <td className="text-right text-gray-400">{p.tp || '—'}</td>
                  <td className={`text-right font-medium ${p.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {p.profit >= 0 ? '+' : ''}{p.profit?.toFixed(2)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => handleModify(p)} className="text-xs text-cyan-400 hover:text-cyan-300 mr-2">SL/TP</button>
                    <button onClick={() => closeSym.mutate(p.symbol)} disabled={closeSym.isPending}
                      className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" />Fermer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
