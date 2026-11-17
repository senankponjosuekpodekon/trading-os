'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, Wallet, Shield, Activity, Zap,
  AlertTriangle, Layers, Globe, RefreshCw, BarChart3, BookOpen,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Portfolio } from '@/types';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

type Mode = 'PAPER' | 'LIVE';

interface PfState {
  equity: number; cash: number; cash_free: number | null;
  margin_locked: number | null; margin_ratio?: number | null;
  unrealized_pnl: number | null; n_positions: number;
  risk_to_stop_total?: number; risk_budget?: number;
  risk_used_frac?: number | null;
  gap_loss_total?: number; gap_loss_frac_equity?: number | null;
  stale?: boolean;
  clusters: Record<string, { notional: number; risk: number; n: number; symbols: string[] }>;
  venues: Record<string, { notional: number; margin: number; n: number }>;
  positions: Array<{
    id: string; symbol: string; direction: string; qty: number;
    entry: number; mark: number; notional: number; margin: number;
    unrealized: number; risk_to_stop: number; gap_loss: number;
    cluster: string; venue: string; leverage: number; stale_mark: boolean;
  }>;
}

interface Snapshot { equity: number; cash_free: number; margin_locked: number; unrealized_pnl: number; n_positions: number; risk_to_stop: number; gap_loss: number | null; ts: string; }
interface LedgerRow { event: string; amount: number; balance_after: number | null; symbol: string | null; ts: string; }

const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;

function Card({ label, value, sub, icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; accent?: 'up' | 'down' | 'warn';
}) {
  const colors = { up: 'text-emerald-400', down: 'text-red-400', warn: 'text-amber-400' };
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between text-gray-500 text-xs mb-2">
        <span>{label}</span>{icon}
      </div>
      <div className={`text-xl font-mono font-semibold ${accent ? colors[accent] : 'text-gray-100'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function EquityCurve({ snaps }: { snaps: Snapshot[] }) {
  if (!snaps.length) return <div className="text-gray-600 text-sm py-8 text-center">Courbe disponible après les premiers snapshots (cron horaire).</div>;
  const pts = [...snaps].reverse().map(s => s.equity);
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const W = 600, H = 120;
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1 || 1)) * W},${H - ((v - min) / range) * (H - 16) - 8}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">
        <path d={path} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-xs text-gray-600">
        <span>{new Date(snaps[snaps.length - 1].ts).toLocaleDateString('fr')}</span>
        <span className={up ? 'text-emerald-500' : 'text-red-500'}>{fmt(min)} → {fmt(max)}</span>
        <span>{new Date(snaps[0].ts).toLocaleDateString('fr')}</span>
      </div>
    </div>
  );
}

function Dashboard({ portfolio }: { portfolio: Portfolio }) {
  const { data: st, isLoading, refetch, isFetching } = useQuery<PfState>({
    queryKey: ['pf-state', portfolio.id],
    queryFn: async () => (await api.get(`/portfolios/${portfolio.id}/state`)).data,
    refetchInterval: 30_000,
  });
  const { data: snaps } = useQuery<Snapshot[]>({
    queryKey: ['pf-snaps', portfolio.id],
    queryFn: async () => (await api.get(`/portfolios/${portfolio.id}/snapshots?limit=336`)).data,
    refetchInterval: 300_000,
  });
  const { data: ledger } = useQuery<LedgerRow[]>({
    queryKey: ['pf-ledger', portfolio.id],
    queryFn: async () => (await api.get(`/portfolios/${portfolio.id}/ledger`)).data,
    refetchInterval: 60_000,
  });

  if (isLoading || !st) return <PageSkeleton />;
  const upl = st.unrealized_pnl ?? 0;
  const riskFrac = st.risk_used_frac ?? null;

  return (
    <div className="space-y-5">
      {st.stale && (
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4" /> Engine indisponible — état dégradé (capital seul).
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card label="Equity" value={fmt(st.equity)} icon={<TrendingUp className="w-4 h-4" />}
          sub={`cash ${fmt(st.cash)}`} />
        <Card label="PnL latent" value={fmt(upl)}
          accent={upl > 0 ? 'up' : upl < 0 ? 'down' : undefined}
          icon={<Activity className="w-4 h-4" />} sub={`${st.n_positions} position(s)`} />
        <Card label="Cash libre" value={fmt(st.cash_free)} icon={<Wallet className="w-4 h-4" />}
          sub={st.margin_locked != null ? `marge ${fmt(st.margin_locked)}` : undefined} />
        <Card label="Risque → stop" value={fmt(st.risk_to_stop_total)}
          accent={riskFrac != null && riskFrac > 0.8 ? 'warn' : undefined}
          icon={<Shield className="w-4 h-4" />}
          sub={riskFrac != null ? `${(riskFrac * 100).toFixed(0)}% du budget τ` : undefined} />
        <Card label="Perte gap (−16/30%)" value={fmt(st.gap_loss_total)}
          accent={st.gap_loss_frac_equity != null && st.gap_loss_frac_equity > 0.2 ? 'warn' : undefined}
          icon={<AlertTriangle className="w-4 h-4" />}
          sub={pct(st.gap_loss_frac_equity) + ' equity'} />
        <Card label="Marge utilisée" value={pct(st.margin_ratio)}
          icon={<Layers className="w-4 h-4" />} />
      </div>

      {/* Equity curve + venues */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
            <BarChart3 className="w-4 h-4" /> Courbe d’equity
          </div>
          <EquityCurve snaps={snaps ?? []} />
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
            <Globe className="w-4 h-4" /> Exposition par venue
          </div>
          {Object.keys(st.venues).length === 0
            ? <div className="text-gray-600 text-sm">Aucune position.</div>
            : Object.entries(st.venues).map(([v, x]) => (
              <div key={v} className="flex justify-between items-center py-1.5 border-b border-gray-800/50 last:border-0">
                <span className="text-xs font-mono text-gray-400">{v}</span>
                <span className="text-sm font-mono">{fmt(x.notional)}</span>
                <span className="text-xs text-gray-600">{x.n} pos</span>
              </div>
            ))}
        </div>
      </div>

      {/* Clusters */}
      {Object.keys(st.clusters).length > 0 && (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
          <div className="text-sm text-gray-400 mb-3">Sources de risque (clusters)</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(st.clusters).map(([k, c]) => (
              <div key={k} className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${c.n >= 3 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-gray-700 text-gray-300'}`}>
                {k} · {c.n} · {fmt(c.risk)} risque
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <span className="text-sm text-gray-400">Positions ouvertes ({st.n_positions})</span>
          <button onClick={() => refetch()} className="text-gray-500 hover:text-gray-300">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {st.positions.length === 0
          ? <div className="text-gray-600 text-sm p-6 text-center">Aucune position ouverte.</div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b border-gray-800">
                  <tr>{['Symbole', 'Dir', 'Qté', 'Entrée', 'Mark', 'Notionnel', 'Marge', 'PnL', 'Risque', 'Gap', 'Cluster'].map(h =>
                    <th key={h} className="text-left px-3 py-2 font-normal">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {st.positions.map(p => (
                    <tr key={p.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="px-3 py-2 font-mono">{p.symbol}{p.stale_mark && <span title="prix figé (pas de bougie)" className="text-amber-500"> ⚠</span>}</td>
                      <td className={`px-3 py-2 font-mono ${p.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{p.direction}</td>
                      <td className="px-3 py-2 font-mono">{p.qty}</td>
                      <td className="px-3 py-2 font-mono">{p.entry}</td>
                      <td className="px-3 py-2 font-mono">{p.mark}</td>
                      <td className="px-3 py-2 font-mono">{fmt(p.notional)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(p.margin)}</td>
                      <td className={`px-3 py-2 font-mono ${p.unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(p.unrealized)}</td>
                      <td className="px-3 py-2 font-mono">{fmt(p.risk_to_stop)}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{fmt(p.gap_loss)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{p.cluster}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Ledger */}
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
          <BookOpen className="w-4 h-4" /> Ledger comptable
        </div>
        {!ledger?.length
          ? <div className="text-gray-600 text-sm">Aucun événement encore.</div>
          : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {ledger.map((l, i) => (
                <div key={i} className="flex justify-between text-xs font-mono py-1 border-b border-gray-800/40 last:border-0">
                  <span className="text-gray-500">{new Date(l.ts).toLocaleString('fr')}</span>
                  <span className="text-gray-400">{l.event}{l.symbol ? ` · ${l.symbol}` : ''}</span>
                  <span className={l.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {l.amount >= 0 ? '+' : ''}{fmt(l.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

interface ExecStatus {
  db: { mode: string; live_venues: string[]; gate_fail_closed: boolean; updated_at: string } | null;
  engine: { mode: string; live_venues: string[]; gate_fail_closed: boolean; source: string; adapters: Record<string, string> } | null;
}
const VENUES = ['FUTURES', 'MARGIN', 'SPOT', 'SYNTHETIC', 'GEM'];

function ExecutionPanel() {
  const qc = useQueryClient();
  const { data } = useQuery<ExecStatus>({
    queryKey: ['exec-config'],
    queryFn: async () => (await api.get('/portfolios/execution/config')).data,
    refetchInterval: 30_000,
  });
  const [edit, setEdit] = useState<{ mode: string; venues: Set<string>; gfc: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const cur = edit ?? {
    mode: data?.db?.mode ?? data?.engine?.mode ?? 'shadow',
    venues: new Set(data?.db?.live_venues ?? data?.engine?.live_venues ?? []),
    gfc: data?.db?.gate_fail_closed ?? data?.engine?.gate_fail_closed ?? false,
  };
  const modeColors: Record<string, string> = { shadow: 'text-gray-400', paper: 'text-amber-400', live: 'text-red-400' };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await api.put('/portfolios/execution/config', {
        mode: cur.mode, live_venues: [...cur.venues], gate_fail_closed: cur.gfc,
      });
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['exec-config'] });
    } catch (e: any) {
      setErr(e?.response?.status === 403 ? 'Admin requis' : (e?.response?.data?.message || 'Erreur'));
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400 flex items-center gap-2"><Zap className="w-4 h-4" /> Exécution</span>
        {data?.engine?.source && <span className="text-xs text-gray-600">source: {data.engine.source}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select value={cur.mode} onChange={e => setEdit({ ...cur, mode: e.target.value })}
          className={`bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm font-mono ${modeColors[cur.mode]}`}>
          {['shadow', 'paper', 'live'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={cur.gfc} onChange={e => setEdit({ ...cur, gfc: e.target.checked })} className="accent-red-500" />
          gate fail-closed (requis live)
        </label>
        <span className="text-xs text-gray-500">venues live :</span>
        {VENUES.map(v => (
          <label key={v} className={`flex items-center gap-1 text-xs font-mono ${cur.venues.has(v) ? 'text-red-300' : 'text-gray-500'}`}>
            <input type="checkbox" checked={cur.venues.has(v)}
              onChange={e => { const s = new Set(cur.venues); e.target.checked ? s.add(v) : s.delete(v); setEdit({ ...cur, venues: s }); }}
              className="accent-red-500" />
            {v}
          </label>
        ))}
        {edit && <button onClick={save} disabled={saving}
          className="ml-auto px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs">
          {saving ? '…' : 'Appliquer'}</button>}
      </div>
      {err && <div className="text-red-400 text-xs mt-2">{err}</div>}
      {data?.engine?.adapters && Object.keys(data.engine.adapters).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(data.engine.adapters).map(([v, a]) => (
            <span key={v} className="text-xs px-2 py-1 rounded border border-emerald-700/50 bg-emerald-900/20 text-emerald-300 font-mono">
              {v}: {a}
            </span>
          ))}
        </div>
      )}
      <div className="text-xs text-gray-600 mt-2">
        Live effectif = mode live + venue coché + adapter enregistré + fail-closed. Sans ça → shadow.
      </div>
    </div>
  );
}

export default function PortfolioManagerPage() {
  const [mode, setMode] = useState<Mode>('PAPER');
  const { data: portfolios, isLoading } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  if (isLoading) return <PageSkeleton />;
  // La DB a accumulé des centaines de portfolios "Mon Portfolio" vides
  // (doublons). On déduplique par nom pour l'affichage — sinon la barre
  // de chips est inutilisable.
  const seen = new Set<string>();
  const list = (portfolios ?? []).filter(p => {
    if (p.type !== mode || seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  const pf = list[0];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestion de portefeuille</h1>
          <p className="text-sm text-gray-500 mt-1">État consolidé temps réel — marge, risque, clusters, ledger.</p>
        </div>
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(['PAPER', 'LIVE'] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === m ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {m === 'PAPER' ? 'Demo' : 'Réel'}
            </button>
          ))}
        </div>
      </div>

      <ExecutionPanel />

      {!pf ? (
        <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-10 text-center text-gray-500">
          {mode === 'PAPER'
            ? 'Aucun portfolio Demo — l\'AutoPilot ou un portfolio paper apparaîtra ici.'
            : 'Aucun portfolio Réel — l\'exécution live n\'est pas encore activée (phase C).'}
        </div>
      ) : (
        <div>
          {list.length > 1 && (
            <div className="flex gap-2 mb-4">
              {list.map(p => (
                <span key={p.id} className="text-xs px-2 py-1 bg-gray-800 rounded text-gray-400">{p.name}</span>
              ))}
            </div>
          )}
          <div className="mb-3 text-sm text-gray-500">
            <span className="font-medium text-gray-300">{pf.name}</span> · {pf.currency}
          </div>
          <Dashboard portfolio={pf} />
        </div>
      )}
    </div>
  );
}
