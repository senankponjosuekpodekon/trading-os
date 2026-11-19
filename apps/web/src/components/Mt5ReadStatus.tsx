'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const labels = {
  READY: 'Démo connectée et vérifiée',
  NOT_CONFIGURED: 'Connexion de lecture non configurée',
  NOT_READY: 'Compte, connexion ou lecture seule non vérifiés',
  UNAVAILABLE: 'Bridge indisponible',
  INVALID_RESPONSE: 'Réponse du bridge invalide',
  STALE_QUOTE: 'Cotation périmée ou horloge incohérente',
};

type Snapshot = {
  status: keyof typeof labels;
  checkedAt: string;
  mode: 'READ_ONLY';
  executionEnabled: false;
  account?: { balance: number; equity: number; marginFree: number; margin: number; currency: string };
  positionsCount?: number;
  quote?: { bid: number; ask: number; time: number };
  contract?: { contractSize: number; volumeMin: number; volumeStep: number };
};

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const d = value as Snapshot;
  if (!Object.prototype.hasOwnProperty.call(labels, d.status) || d.mode !== 'READ_ONLY'
    || d.executionEnabled !== false || typeof d.checkedAt !== 'string' || !Number.isFinite(Date.parse(d.checkedAt))) return false;
  return d.status !== 'READY' || (!!d.account && typeof d.account.currency === 'string'
    && [d.account.balance, d.account.equity, d.account.margin, d.account.marginFree, d.positionsCount,
      d.quote?.bid, d.quote?.ask, d.quote?.time, d.contract?.contractSize, d.contract?.volumeMin,
      d.contract?.volumeStep].every(v => typeof v === 'number' && Number.isFinite(v))
    && Number.isInteger(d.positionsCount) && Number(d.positionsCount) >= 0
    && Number.isFinite(new Date((d.quote?.time ?? NaN) * 1000).getTime()));
}

export function Mt5ReadStatus() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await api.get('/admin/ops/mt5', { signal: abort.signal });
        if (!validSnapshot(response.data)) throw new Error('invalid_snapshot');
        if (!abort.signal.aborted) {
          setSnapshot(response.data);
          setError(false);
        }
      } catch {
        if (!abort.signal.aborted) {
          setSnapshot(null);
          setError(true);
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 15000);
      }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);

  const ready = snapshot?.status === 'READY';
  return (
    <section aria-label="MT5 en lecture seule" className="mb-6 p-4 bg-gray-900 border border-gray-800 rounded-xl">
      <h2 className="text-lg font-semibold text-white">MT5 — supervision démo</h2>
      <p className="text-sm text-gray-400">Lecture seule. Aucun ordre autorisé. Routage d’exécution inchangé.</p>
      <p role="status" className={`mt-2 text-sm ${ready ? 'text-emerald-400' : 'text-amber-400'}`}>
        {error ? 'Impossible de vérifier MT5' : snapshot ? labels[snapshot.status] : 'Vérification MT5…'}
      </p>
      {ready && snapshot.account && snapshot.quote && snapshot.contract && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-300">
          <div><dt>Balance</dt><dd>{snapshot.account.balance.toFixed(2)} {snapshot.account.currency}</dd></div>
          <div><dt>Equity</dt><dd>{snapshot.account.equity.toFixed(2)} {snapshot.account.currency}</dd></div>
          <div><dt>Marge libre</dt><dd>{snapshot.account.marginFree.toFixed(2)} {snapshot.account.currency}</dd></div>
          <div><dt>Positions broker</dt><dd>{snapshot.positionsCount}</dd></div>
          <div><dt>EURUSD bid / ask</dt><dd>{snapshot.quote.bid} / {snapshot.quote.ask}</dd></div>
          <div><dt>Heure du tick (UTC)</dt><dd>{new Date(snapshot.quote.time * 1000).toISOString()}</dd></div>
          <div><dt>Unités par lot EURUSD</dt><dd>{snapshot.contract.contractSize}</dd></div>
          <div><dt>Minimum / pas (lots)</dt><dd>{snapshot.contract.volumeMin} / {snapshot.contract.volumeStep}</dd></div>
        </dl>
      )}
      {snapshot && <p className="mt-2 text-xs text-gray-500">Contrôle : {snapshot.checkedAt}</p>}
    </section>
  );
}
