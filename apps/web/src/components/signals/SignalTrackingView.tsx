'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { SignalTrackingSheet } from '@/components/signals/SignalTrackingSheet';

interface TrackingSignal {
  id: string;
  signal: string;
  confidence: number;
  entryPrice: string | null;
  stopLoss: string | null;
  takeProfit1: string | null;
  takeProfit2: string | null;
  executionStatus: string;
  finalPnlPct: string | null;
  createdAt: string;
  asset: { symbol: string };
  executionEvents: { id: string }[];
}

const statusLabel: Record<string, string> = {
  PENDING: 'En attente',
  ACTIVE: 'Actif',
  CLOSED_WIN: 'Clos en gain',
  CLOSED_LOSS: 'Clos en perte',
  CLOSED_BREAKEVEN: 'Clos neutre',
  EXPIRED: 'Expiré',
};

const statusColor: Record<string, string> = {
  PENDING: 'text-yellow-400',
  ACTIVE: 'text-blue-400',
  CLOSED_WIN: 'text-emerald-400',
  CLOSED_LOSS: 'text-red-400',
  CLOSED_BREAKEVEN: 'text-gray-400',
  EXPIRED: 'text-gray-500',
};

export function SignalTrackingView() {
  const [signals, setSignals] = useState<TrackingSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TrackingSignal | null>(null);

  useEffect(() => {
    api.get('/signals/tracking?limit=50')
      .then(res => setSignals(res.data.data))
      .catch(() => setError('Impossible de charger le suivi'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {loading && <p className="text-gray-500">Chargement…</p>}
      {error && <p className="text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Symbole</th>
              <th className="px-4 py-3 text-left">Signal</th>
              <th className="px-4 py-3 text-left">Conf</th>
              <th className="px-4 py-3 text-left">Entrée</th>
              <th className="px-4 py-3 text-left">SL</th>
              <th className="px-4 py-3 text-left">TP1</th>
              <th className="px-4 py-3 text-left">Statut</th>
              <th className="px-4 py-3 text-left">PnL</th>
              <th className="px-4 py-3 text-left">Events</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {signals.map(s => (
              <tr key={s.id} className="hover:bg-gray-900/50 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{s.asset.symbol}</td>
                <td className="px-4 py-3">
                  <span className={`flex items-center gap-1 ${s.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.signal === 'BUY' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {s.signal}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{s.confidence}%</td>
                <td className="px-4 py-3 text-gray-300 font-mono">{s.entryPrice ?? '—'}</td>
                <td className="px-4 py-3 text-gray-300 font-mono">{s.stopLoss ?? '—'}</td>
                <td className="px-4 py-3 text-gray-300 font-mono">{s.takeProfit1 ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={statusColor[s.executionStatus] ?? 'text-gray-400'}>
                    {statusLabel[s.executionStatus] ?? s.executionStatus}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {s.finalPnlPct ? (
                    <span className={parseFloat(s.finalPnlPct) >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {parseFloat(s.finalPnlPct) >= 0 ? '+' : ''}{parseFloat(s.finalPnlPct).toFixed(2)}%
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-400">{s.executionEvents.length}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setSelected(s)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Voir timeline
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {signals.length === 0 && !loading && !error && (
          <p className="p-6 text-center text-gray-500">Aucun signal suivi pour le moment.</p>
        )}
      </div>

      {selected && (
        <SignalTrackingSheet
          signalId={selected.id}
          symbol={selected.asset.symbol}
          signal={selected.signal}
          createdAt={selected.createdAt}
          confidence={selected.confidence}
          entryPrice={selected.entryPrice}
          stopLoss={selected.stopLoss}
          takeProfit1={selected.takeProfit1}
          takeProfit2={selected.takeProfit2}
          executionStatus={selected.executionStatus}
          finalPnlPct={selected.finalPnlPct}
          open={!!selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
