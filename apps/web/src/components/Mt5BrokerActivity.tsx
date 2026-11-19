'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type BrokerRow = Record<string, string | number>;
type Page = { items: BrokerRow[]; total: number; limit: number; nextOffset: number | null };
type Activity = {
  status: 'READY' | 'NOT_READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'INVALID_RESPONSE';
  mode: 'READ_ONLY'; executionEnabled: false; checkedAt: string; brokerErrorCode?: number | null;
  brokerCheckedAt?: string; currency?: string; period?: { from: string; to: string };
  pendingOrders?: Page; historyOrders?: Page; deals?: Page; contract?: BrokerRow;
};
const labels = {
  READY: 'Lectures broker vérifiées — compte démo', NOT_READY: 'Compte démo ou identité non vérifiés',
  NOT_CONFIGURED: 'Connexion de lecture non configurée', UNAVAILABLE: 'Lectures broker indisponibles',
  INVALID_RESPONSE: 'Réponse broker incohérente ou périmée',
};
const date = (stamp: number | string | undefined) => {
  const value = new Date(stamp ?? NaN);
  return stamp && Number.isFinite(value.getTime()) ? value.toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
};
function validPage(p: Page | undefined): boolean {
  return !!p && Number.isSafeInteger(p.total) && p.total >= 0 && p.limit === 100
    && Array.isArray(p.items) && p.items.length === Math.min(p.total, p.limit)
    && p.nextOffset === (p.total > p.limit ? p.limit : null)
    && p.items.every(row => !!row && typeof row.ticket === 'string' && typeof row.symbol === 'string'
      && Object.values(row).every(value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))));
}
function valid(data: Activity): boolean {
  return !!data && data.mode === 'READ_ONLY' && data.executionEnabled === false
    && Object.prototype.hasOwnProperty.call(labels, data.status)
    && Number.isFinite(Date.parse(data.checkedAt)) && Math.abs(Date.now() - Date.parse(data.checkedAt)) <= 60000
    && (data.status !== 'READY' || (!!data.period && Number.isFinite(Date.parse(data.period.from))
      && Number.isFinite(Date.parse(data.period.to)) && typeof data.currency === 'string'
      && Number.isFinite(Date.parse(data.brokerCheckedAt ?? ''))
      && Math.abs(Date.now() - Date.parse(data.brokerCheckedAt!)) <= 60000
      && Date.parse(data.period.from) < Date.parse(data.period.to)
      && validPage(data.pendingOrders) && validPage(data.historyOrders) && validPage(data.deals)
      && !!data.contract && ['point', 'tick_size', 'tick_value_profit', 'tick_value_loss', 'volume_min', 'volume_max', 'volume_step', 'stops_level', 'freeze_level']
        .every(key => typeof data.contract![key] === 'number' && Number.isFinite(data.contract![key]))));
}
const fieldLabels: Record<string, string> = {
  ticket: 'Ticket', order: 'Ordre lié', position_id: 'Position liée', symbol: 'Symbole', type: 'Type', entry: 'Entrée/sortie', state: 'État',
  time_msc: 'Heure UTC', time_setup_msc: 'Création UTC', time_done_msc: 'Fin UTC',
  volume: 'Volume (lots)', volume_initial: 'Initial (lots)', volume_current: 'Restant (lots)',
  price: 'Prix', price_open: 'Prix demandé', sl: 'SL', tp: 'TP', commission: 'Commission', swap: 'Swap', fee: 'Frais', profit: 'Profit',
};
function table(page: Page, deals = false) {
  const fields = deals ? ['ticket', 'order', 'position_id', 'symbol', 'type', 'entry', 'time_msc', 'volume', 'price', 'commission', 'swap', 'fee', 'profit']
    : ['ticket', 'position_id', 'symbol', 'type', 'state', 'time_setup_msc', 'time_done_msc', 'volume_initial', 'volume_current', 'price_open', 'sl', 'tp'];
  const cell = (key: string, row: BrokerRow) => {
    const value = row[key];
    if (key.endsWith('_msc')) return date(value);
    if (key === 'type') return (deals ? ['BUY', 'SELL', 'Solde', 'Crédit'] : ['BUY', 'SELL', 'BUY LIMIT', 'SELL LIMIT', 'BUY STOP', 'SELL STOP', 'BUY STOP LIMIT', 'SELL STOP LIMIT'])[Number(value)] ?? `Code ${value}`;
    if (key === 'entry') return ['Entrée', 'Sortie', 'Inversion', 'Sortie opposée'][Number(value)] ?? `Code ${value}`;
    return value ?? '—';
  };
  return <>
    {page.nextOffset !== null && <p className="text-amber-400 text-xs">Lecture partielle : {page.items.length} dernières lignes sur {page.total}.</p>}
    {page.total === 0 ? <p className="text-gray-400 text-sm">Aucun enregistrement dans ce relevé.</p> : <div className="overflow-auto max-h-64">
      <table className="w-full text-xs text-left"><thead><tr>{fields.map(key => <th key={key} className="p-2 font-normal text-gray-400">{fieldLabels[key]}</th>)}</tr></thead>
        <tbody>{page.items.map(row => <tr key={row.ticket} className="border-t border-gray-800">{fields.map(key => <td key={key} className="p-2 whitespace-nowrap">{cell(key, row)}</td>)}</tr>)}</tbody>
      </table>
    </div>}
  </>;
}

export function Mt5BrokerActivity() {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const response = await api.get<Activity>('/admin/ops/mt5/activity', { signal: abort.signal, timeout: 16000 });
        if (!valid(response.data)) throw new Error('invalid_activity');
        if (!abort.signal.aborted) { setData(response.data); setError(false); }
      } catch {
        if (!abort.signal.aborted) { setData(null); setError(true); }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(refresh, 30000);
      }
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [expanded]);
  return <details className="mt-4 border-t border-gray-800 pt-3" onToggle={event => {
    setExpanded(event.currentTarget.open);
    if (!event.currentTarget.open) { setData(null); setError(false); }
  }}>
    <summary className="cursor-pointer text-sm text-indigo-300">Ordres, historique et spécifications broker</summary>
    {expanded && <div className="mt-3 space-y-3">
      <p role="status" className="text-sm text-gray-300">{error ? 'Lecture indisponible — ancien relevé masqué' : data ? labels[data.status] : 'Lecture du broker…'}
        {data?.brokerErrorCode != null && ` (code ${data.brokerErrorCode})`}</p>
      {data?.status === 'READY' && <>
        <p className="text-xs text-gray-400">Historique du {date(data.period!.from)} au {date(data.period!.to)}. Relevé : {date(data.brokerCheckedAt)}. Montants dans la devise du compte : {data.currency}.</p>
        <h3 className="text-sm font-medium">Ordres en attente ({data.pendingOrders!.total})</h3>{table(data.pendingOrders!)}
        <h3 className="text-sm font-medium">Historique des ordres ({data.historyOrders!.total})</h3>{table(data.historyOrders!)}
        <h3 className="text-sm font-medium">Deals — exécutions et opérations ({data.deals!.total})</h3>{table(data.deals!, true)}
        <h3 className="text-sm font-medium">Spécifications EURUSD</h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">{[
          ['Unités par lot', 'contract_size'], ['Minimum lots', 'volume_min'], ['Maximum lots', 'volume_max'], ['Pas lots', 'volume_step'],
          ['Point', 'point'], ['Pas du tick', 'tick_size'], ['Valeur tick profit', 'tick_value_profit'], ['Valeur tick perte', 'tick_value_loss'],
          ['Distance stops (points)', 'stops_level'], ['Zone gel (points)', 'freeze_level'], ['Devise profit', 'currency_profit'], ['Devise marge', 'currency_margin'],
        ].map(([label, key]) => <div key={key}><dt className="text-gray-500">{label}</dt><dd>{key.startsWith('tick_') && data.contract![key] === 0 ? 'Indisponible pour sizing' : data.contract![key] ?? '—'}</dd></div>)}</dl>
        <p className="text-xs text-amber-400">Lecture seule. Ces données ne valident ni le sizing ni la marge d’un futur ordre. Aucun ordre n’est envoyé.</p>
      </>}
    </div>}
  </details>;
}
