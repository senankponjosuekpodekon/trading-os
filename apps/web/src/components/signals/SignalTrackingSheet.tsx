'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { X, History, Copy, Check } from 'lucide-react';

interface ExecutionEvent {
  id: string;
  type: string;
  price: string;
  sizePct: string;
  candleTime: string;
  resolvedBy: string;
}

interface SignalTrackingSheetProps {
  signalId: string;
  symbol: string;
  signal: string;
  createdAt?: string | null;
  confidence?: number | null;
  entryPrice?: string | number | null;
  stopLoss?: string | number | null;
  takeProfit1?: string | number | null;
  takeProfit2?: string | number | null;
  executionStatus?: string | null;
  finalPnlPct?: string | number | null;
  open: boolean;
  onClose: () => void;
}

const typeLabel: Record<string, string> = {
  ENTRY_HIT: 'Entrée atteinte',
  SL_HIT: 'Stop-loss touché',
  TP1_HIT: 'TP1 atteint',
  TP2_HIT: 'TP2 atteint',
  TP3_HIT: 'TP3 atteint',
  EXPIRED: 'Signal expiré',
  MANUAL_CLOSE: 'Clôture manuelle',
};

const statusLabel: Record<string, string> = {
  PENDING: 'En attente',
  ACTIVE: 'Actif',
  CLOSED_WIN: 'Clos en gain',
  CLOSED_LOSS: 'Clos en perte',
  CLOSED_BREAKEVEN: 'Clos neutre',
  EXPIRED: 'Expiré',
};

const fmt = (v?: string | number | null) =>
  v == null ? '—' : `$${parseFloat(String(v)).toFixed(2)}`;

export function SignalTrackingSheet({
  signalId, symbol, signal, createdAt, confidence,
  entryPrice, stopLoss, takeProfit1, takeProfit2,
  executionStatus, finalPnlPct, open, onClose,
}: SignalTrackingSheetProps) {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get(`/signals/${signalId}/execution`)
      .then(res => setEvents(res.data))
      .catch(() => setError('Impossible de charger le suivi'))
      .finally(() => setLoading(false));
  }, [open, signalId]);

  if (!open) return null;

  const generatedAt = createdAt ? new Date(createdAt).toLocaleString('fr-FR') : null;

  const buildCopyText = () => {
    const lines = [
      `Signal ${signal} — ${symbol}`,
      generatedAt ? `Généré le ${generatedAt}` : null,
      confidence != null ? `Confiance ${Math.round(Number(confidence))}%` : null,
      `Entry ${fmt(entryPrice)} · SL ${fmt(stopLoss)} · TP1 ${fmt(takeProfit1)} · TP2 ${fmt(takeProfit2)}`,
      executionStatus ? `Statut : ${statusLabel[executionStatus] ?? executionStatus}` : null,
      finalPnlPct != null ? `PnL final : ${Number(finalPnlPct).toFixed(2)}%` : null,
      '',
      'Suivi :',
      ...events.map(ev =>
        `- ${new Date(ev.candleTime).toLocaleString('fr-FR')} · ${typeLabel[ev.type] ?? ev.type} @ $${parseFloat(ev.price).toFixed(2)} (${parseFloat(ev.sizePct)}%)`
      ),
      events.length === 0 ? '- Aucun événement' : null,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API indisponible (http) → fallback
      const ta = document.createElement('textarea');
      ta.value = buildCopyText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-gray-900 border-l border-gray-800 shadow-xl p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Suivi du signal</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              title="Copier le résumé"
            >
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="mb-6 p-4 rounded-xl border border-gray-800 bg-gray-950">
          <p className="text-sm text-gray-500">Actif</p>
          <p className="text-white font-bold text-lg">{symbol}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-sm font-bold ${signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
              {signal}
            </span>
            <span className="text-xs text-gray-500">{events.length} événement(s)</span>
          </div>
          {generatedAt && (
            <p className="text-xs text-gray-500 mt-2">Généré le {generatedAt}</p>
          )}
          {confidence != null && (
            <p className="text-xs text-gray-500 mt-1">Confiance {Math.round(Number(confidence))}%</p>
          )}
          {(entryPrice != null || stopLoss != null || takeProfit1 != null) && (
            <p className="text-xs text-gray-400 mt-2">
              Entry {fmt(entryPrice)} · SL {fmt(stopLoss)} · TP1 {fmt(takeProfit1)} · TP2 {fmt(takeProfit2)}
            </p>
          )}
          {executionStatus && (
            <p className="text-xs text-gray-500 mt-1">
              Statut : {statusLabel[executionStatus] ?? executionStatus}
              {finalPnlPct != null && ` · PnL ${Number(finalPnlPct).toFixed(2)}%`}
            </p>
          )}
        </div>

        {loading && <p className="text-sm text-gray-500">Chargement…</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="space-y-3">
          {events.map(ev => (
            <div key={ev.id} className="p-3 rounded-lg border border-gray-800 bg-gray-900/50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{typeLabel[ev.type] ?? ev.type}</span>
                <span className="text-xs text-gray-500">{new Date(ev.candleTime).toLocaleString('fr-FR')}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                <span>Prix ${parseFloat(ev.price).toFixed(2)}</span>
                <span>Taille {parseFloat(ev.sizePct)}%</span>
                <span className="text-gray-600">{ev.resolvedBy}</span>
              </div>
            </div>
          ))}
          {!loading && events.length === 0 && !error && (
            <p className="text-sm text-gray-500">Aucun événement de suivi pour le moment.</p>
          )}
        </div>
      </div>
    </div>
  );
}
