'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Gauge,
  ShieldAlert, ShieldCheck, RefreshCw, XCircle, Zap, TrendingDown,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface FunnelData {
  [strategy: string]: {
    signal_decided?: number;
    confidence_threshold?: number;
    regime_filter?: number;
    market_filter?: number;
    trigger_check?: number;
    dps_filter?: number;
    final?: number;
  };
}

interface HistogramData {
  count: number;
  sum: number;
  avg: number;
}

interface RiskEngineData {
  kill_switch?: { state?: string };
  cooldown?: { in_cooldown?: boolean };
  drawdown?: { level?: string };
  tail_risk?: { crisis_mode?: boolean };
  performance?: { total_trades?: number; win_rate?: number };
  capital?: number;
  correlation?: { open_positions?: number };
  error?: string;
}

interface DashboardData {
  summary: { counters: number; histograms: number; errors: number };
  funnel: FunnelData;
  histograms: Record<string, HistogramData>;
  errors: Record<string, number>;
  risk_engine: RiskEngineData;
  raw_counters: Record<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────

const FUNNEL_STAGES: { key: string; label: string }[] = [
  { key: 'signal_decided', label: 'Signal' },
  { key: 'confidence_threshold', label: 'Confiance' },
  { key: 'regime_filter', label: 'Régime' },
  { key: 'market_filter', label: 'Marché' },
  { key: 'trigger_check', label: 'Trigger' },
  { key: 'dps_filter', label: 'DPS' },
  { key: 'final', label: 'Final' },
];

function fmtNum(n: number | undefined | null): string {
  if (n === null || n === undefined) return '-';
  if (n > 999_999) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 999) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Pill({ value, type }: { value: string; type: 'ok' | 'warn' | 'err' | 'neutral' }) {
  const colors = {
    ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warn: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    err: 'bg-red-500/10 text-red-400 border-red-500/20',
    neutral: 'bg-gray-700/30 text-gray-400 border-gray-700',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${colors[type]}`}>
      {value}
    </span>
  );
}

// ── Components ─────────────────────────────────────────────────

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">{label}</p>
        <span className="text-gray-600">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function FunnelBar({ value, max }: { value: number; max: number }) {
  if (max === 0) return <div className="text-gray-600 text-xs">—</div>;
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 70 ? 'bg-emerald-500' : pct > 30 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{value}</span>
    </div>
  );
}

function RiskItem({ label, value, type }: { label: string; value: string; type: 'ok' | 'warn' | 'err' | 'neutral' }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="mt-1.5">
        <Pill value={value} type={type} />
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────

export default function ObservabilityPage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['observability-dashboard'],
    queryFn: async () => (await api.get('/observability/dashboard')).data,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const reset = useMutation({
    mutationFn: async () => (await api.post('/observability/metrics/reset')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability-dashboard'] }),
  });

  const funnel = data?.funnel ?? {};
  const strategies = Object.keys(funnel);
  const histograms = data?.histograms ?? {};
  const histEntries = Object.entries(histograms).filter(([, h]) => h.count > 0);
  const errors = data?.errors ?? {};
  const errorEntries = Object.entries(errors).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const risk = data?.risk_engine ?? {};

  const ksState = risk.kill_switch?.state ?? '—';
  const ddLevel = risk.drawdown?.level ?? '—';
  const crisis = risk.tail_risk?.crisis_mode;
  const cooldown = risk.cooldown?.in_cooldown;
  const capital = risk.capital ?? 0;
  const positions = risk.correlation?.open_positions ?? 0;

  return (
    <AppLayout title="IO Observability">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              IO Observability
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Métriques temps réel du moteur — auto-refresh 10s
            </p>
          </div>
          <button
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
          >
            <RefreshCw className={`w-4 h-4 ${reset.isPending ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            Engine indisponible — vérifiez que le moteur Python tourne sur le port 8000.
          </div>
        )}

        {isLoading && !data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse h-24" />
            ))}
          </div>
        ) : (
          <>
            {/* Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={<Zap className="w-4 h-4" />} label="Counters" value={fmtNum(data?.summary.counters)} />
              <StatCard icon={<Gauge className="w-4 h-4" />} label="Histograms" value={fmtNum(data?.summary.histograms)} />
              <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Errors" value={fmtNum(data?.summary.errors)} sub={errorEntries.length > 0 ? `${errorEntries.length} sources` : 'Aucune'} />
              <StatCard icon={<Activity className="w-4 h-4" />} label="Stratégies" value={String(strategies.length)} sub={strategies.length > 0 ? strategies.join(', ') : 'Aucune'} />
            </div>

            {/* Risk Engine */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
                Risk Engine
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <RiskItem label="Kill Switch" value={ksState} type={ksState === 'ACTIVE' ? 'ok' : 'err'} />
                <RiskItem label="Drawdown" value={ddLevel} type={ddLevel === 'NORMAL' ? 'ok' : ddLevel === 'WARNING' ? 'warn' : 'err'} />
                <RiskItem label="Crisis Mode" value={crisis ? 'ON' : 'OFF'} type={crisis ? 'err' : 'ok'} />
                <RiskItem label="Cooldown" value={cooldown ? 'COOLING' : 'READY'} type={cooldown ? 'warn' : 'ok'} />
                <RiskItem label="Capital" value={`$${fmtNum(capital)}`} type="neutral" />
                <RiskItem label="Positions" value={String(positions)} type="neutral" />
              </div>
            </div>

            {/* Strategy Funnel */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-blue-400" />
                Strategy Funnel
              </h2>
              {strategies.length === 0 ? (
                <p className="text-sm text-gray-600 italic py-8 text-center">
                  Aucune donnée — lancez un scan pour peupler le funnel.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Header row */}
                  <div className="hidden md:grid grid-cols-8 gap-2 text-xs text-gray-500 uppercase tracking-wide pb-2 border-b border-gray-800">
                    <div>Stratégie</div>
                    {FUNNEL_STAGES.map(s => <div key={s.key}>{s.label}</div>)}
                  </div>
                  {strategies.map(strat => {
                    const f = funnel[strat];
                    const maxVal = Math.max(...Object.values(f), 1);
                    return (
                      <div key={strat} className="md:grid md:grid-cols-8 md:gap-2 space-y-1 md:space-y-0">
                        <div className="text-sm font-medium text-white py-1">{strat}</div>
                        {FUNNEL_STAGES.map(stage => (
                          <div key={stage.key} className="py-1">
                            <FunnelBar value={f[stage.key] ?? 0} max={maxVal} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Two columns: Latencies + Errors */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Latencies */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Latencies (ms)
                </h2>
                {histEntries.length === 0 ? (
                  <p className="text-sm text-gray-600 italic py-4">Aucune donnée de latence.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2">Métrique</th>
                        <th className="text-right py-2">Count</th>
                        <th className="text-right py-2">Avg</th>
                        <th className="text-right py-2">Sum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {histEntries.map(([name, h]) => (
                        <tr key={name} className="border-b border-gray-800/50">
                          <td className="py-2 text-gray-300">{name}</td>
                          <td className="py-2 text-right text-gray-400">{h.count}</td>
                          <td className="py-2 text-right text-amber-400">{h.avg.toFixed(1)}</td>
                          <td className="py-2 text-right text-gray-500">{h.sum.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Errors */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  Errors & Failures
                </h2>
                {errorEntries.length === 0 ? (
                  <p className="text-sm text-gray-600 italic py-4 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Aucune erreur enregistrée.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-800">
                        <th className="text-left py-2">Source</th>
                        <th className="text-right py-2">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errorEntries.map(([name, count]) => (
                        <tr key={name} className="border-b border-gray-800/50">
                          <td className="py-2 text-red-400 truncate max-w-xs">{name}</td>
                          <td className="py-2 text-right text-gray-300">{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
