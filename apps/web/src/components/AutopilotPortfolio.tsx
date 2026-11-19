'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SignalTrackingSheet } from '@/components/signals/SignalTrackingSheet';

type Position = {
  id: string; signalId: string | null; symbol: string; status: string; direction: string;
  entryPrice: number | null; quantity: number | null; originalQuantity: number | null;
  stopLoss: number | null; takeProfit: number | null; takeProfit2: number | null; takeProfit3: number | null;
  realizedPnl: number | null; unrealizedPnl: number | null; mark: number | null; markAt: string | null;
  partialExitAt: string | null; partialExitPrice: number | null; partialPnl: number | null;
  secondPartialExitAt: string | null; secondPartialExitPrice: number | null; secondPartialPnl: number | null;
  openedAt: string; closedAt: string | null; exitPrice: number | null;
};
type Snapshot = {
  mode: 'PAPER'; readOnly: true; executionEnabled: false; checkedAt: string;
  worker: { enabled: boolean; lastAttemptAt: string | null; statusCounts: Record<string, number> };
  portfolio: null | {
    name: string; currency: string; initialCapital: number; currentCapital: number;
    realizedPnl: number; unrealizedPnl: number | null; equity: number | null; riskToStop: number | null;
    accountingDifference: number; positions: Position[]; closedPositions: Position[]; closedCount: number;
  };
  signals: Array<{
    id: string; symbol: string; direction: string; confidence: number; executionStatus: string; createdAt: string;
    events: Array<{ id: string; type: string; status: string; reason: string | null; attempts: number;
      createdAt: string; candleTime: string; processedAt: string | null; nextAttemptAt: string | null }>;
  }>;
};
const value = (n: number | null) => n === null || !Number.isFinite(n) ? 'Indisponible' : n.toLocaleString('fr-FR', { maximumFractionDigits: 8 });
const date = (s: string | null) => s ? new Date(s).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Aucune';

function validSnapshot(s: Snapshot): boolean {
  return !!s && s.mode === 'PAPER' && s.readOnly === true && s.executionEnabled === false
    && Math.abs(Date.now() - Date.parse(s.checkedAt)) < 90000
    && !!s.worker && typeof s.worker.enabled === 'boolean' && !!s.worker.statusCounts
    && Array.isArray(s.signals) && s.signals.every(signal => Array.isArray(signal.events))
    && (s.portfolio === null || (!!s.portfolio && Array.isArray(s.portfolio.positions)
      && Array.isArray(s.portfolio.closedPositions)
      && [s.portfolio.initialCapital, s.portfolio.currentCapital, s.portfolio.realizedPnl, s.portfolio.accountingDifference].every(Number.isFinite)));
}

export function AutopilotPortfolio() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<{ id: string; symbol: string; direction: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const { data } = await api.get<Snapshot>('/admin/ops/autopilot', { signal: abort.signal, timeout: 10000 });
        if (!validSnapshot(data)) throw new Error('invalid_snapshot');
        if (!abort.signal.aborted) { setSnapshot(data); setError(false); }
      } catch {
        if (!abort.signal.aborted) { setSnapshot(null); setError(true); }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 30000);
      }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, []);
  const pf = snapshot?.portfolio;
  const money = (n: number | null) => n === null ? 'Indisponible' : `${value(n)} ${pf?.currency ?? ''}`;
  const positionsTable = (positions: Position[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead><tr>{['Actif / signal', 'État / dates UTC', 'Quantité restante / initiale', 'Entrée / sortie', 'SL / TP1 / TP2 / TP3', 'Prix de référence', 'P&L réalisé / latent', 'Sorties partielles'].map(h => <th className="p-2 text-gray-400 font-normal" key={h}>{h}</th>)}</tr></thead>
        <tbody>{positions.map(p => <tr key={p.id} className="border-t border-gray-800 align-top">
          <td className="p-2">{p.symbol} {p.direction}{p.signalId && <button className="block text-indigo-400 underline" onClick={() => setSelected({ id: p.signalId!, symbol: p.symbol, direction: p.direction })}>Voir le signal</button>}</td>
          <td className="p-2">{p.status}<div>{date(p.openedAt)}</div>{p.closedAt && <div>Clôture : {date(p.closedAt)}</div>}</td>
          <td className="p-2">{value(p.quantity)} / {value(p.originalQuantity)}</td>
          <td className="p-2">{value(p.entryPrice)} / {p.exitPrice === null ? '—' : value(p.exitPrice)}</td>
          <td className="p-2">{[p.stopLoss, p.takeProfit, p.takeProfit2, p.takeProfit3].map(n => n === null ? '—' : value(n)).join(' / ')}</td>
          <td className="p-2">{p.mark === null ? 'Indisponible' : value(p.mark)}{p.markAt && <div>{date(p.markAt)}</div>}</td>
          <td className="p-2">{money(p.realizedPnl)} / {p.closedAt ? '—' : money(p.unrealizedPnl)}</td>
          <td className="p-2">{p.partialExitAt ? <div>TP1 : {date(p.partialExitAt)} · prix {value(p.partialExitPrice)} · {money(p.partialPnl)}</div> : 'Aucune'}{p.secondPartialExitAt && <div>TP2 : {date(p.secondPartialExitAt)} · prix {value(p.secondPartialExitPrice)} · {money(p.secondPartialPnl)}</div>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <section aria-label="Portefeuille AutoPilot système" className="bg-gray-900/60 border border-indigo-800/50 rounded-xl p-4 space-y-4">
      <h2 className="text-lg font-semibold">AutoPilot système — Paper</h2>
      <p className="text-sm text-gray-400">Supervision administrateur en lecture seule. Simulation interne, distincte de MT5 et Binance. Aucun ordre broker.</p>
      {!snapshot && <p role="status">{error ? 'Supervision AutoPilot indisponible. Données précédentes masquées.' : 'Chargement AutoPilot…'}</p>}
      {snapshot && <>
        <p className="text-sm">Nouvelles entrées : {snapshot.worker.enabled ? 'autorisées en paper' : 'suspendues'} · Dernière tentative de traitement : {date(snapshot.worker.lastAttemptAt)}</p>
        <p className="text-xs text-gray-500">Ce dernier traitement n’est pas un heartbeat du worker. Rafraîchissement toutes les 30 secondes · Contrôle : {date(snapshot.checkedAt)}</p>
        <div className="flex flex-wrap gap-3 text-xs">{Object.entries(snapshot.worker.statusCounts).map(([status, count]) => <span key={status}>{status} : {count}</span>)}</div>
        {!pf ? <p>Portefeuille système pas encore créé. Cette vue ne le crée pas.</p> : <>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">{[
            ['Capital initial', money(pf.initialCapital)], ['Capital comptabilisé', money(pf.currentCapital)],
            ['P&L réalisé (partiels inclus)', money(pf.realizedPnl)], ['P&L latent', money(pf.unrealizedPnl)],
            ['Equity estimée', money(pf.equity)], ['Risque entrée → stop restant', money(pf.riskToStop)],
          ].map(([label, content]) => <div key={label}><dt className="text-gray-400">{label}</dt><dd>{content}</dd></div>)}</dl>
          <p className="text-xs text-gray-500">Latent indicatif sur la dernière clôture 1 minute, âgée au maximum de 4 minutes. Indisponible sans prix récent. Les frais non modélisés ne sont pas déduits.</p>
          {Math.abs(pf.accountingDifference) > 0.01 && <p role="alert" className="text-amber-400">Écart comptable à vérifier : {money(pf.accountingDifference)}</p>}
          <h3 className="font-medium">Positions ouvertes ({pf.positions.length})</h3>
          {pf.positions.length ? positionsTable(pf.positions) : <p>Aucune position paper ouverte.</p>}
          <h3 className="font-medium">Clôtures récentes ({pf.closedPositions.length} sur {pf.closedCount})</h3>
          {pf.closedPositions.length ? positionsTable(pf.closedPositions) : <p>Aucune clôture enregistrée.</p>}
        </>}
        <h3 className="font-medium">Signaux récents et décisions ({snapshot.signals.length} derniers signaux, jusqu’à 10 événements chacun)</h3>
        <p className="text-xs text-gray-500">Un événement de suivi ne prouve pas une ouverture paper. Les positions liées sont listées ci-dessus.</p>
        {!snapshot.signals.length && <p>Aucun signal récent.</p>}
        <div className="space-y-3 max-h-96 overflow-y-auto">{snapshot.signals.map(s => <div key={s.id} className="border-t border-gray-800 pt-2 text-sm">
          <button className="text-indigo-400 underline" onClick={() => setSelected(s)}>{s.symbol} {s.direction} · {s.confidence}%</button> · {date(s.createdAt)} · {s.executionStatus}
          {!s.events.length && <p>{s.executionStatus === 'EXPIRED' ? 'Expiré sans événement d’entrée enregistré' : 'Aucun événement d’entrée enregistré'}</p>}
          {s.events.map(e => <div key={e.id} className="text-xs text-gray-400 mt-1">{e.type} · {e.status} · {e.reason ?? 'En attente de décision'} · {e.attempts} tentative(s)<div>Bougie : {date(e.candleTime)} · Enregistré : {date(e.createdAt)} · Traité : {date(e.processedAt)}{e.nextAttemptAt && ` · Reprise : ${date(e.nextAttemptAt)}`}</div></div>)}
        </div>)}</div>
      </>}
      {selected && <SignalTrackingSheet signalId={selected.id} symbol={selected.symbol} signal={selected.direction} open onClose={() => setSelected(null)} />}
    </section>
  );
}
