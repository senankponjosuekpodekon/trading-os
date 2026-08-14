'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Clock,
  Database, Cpu, Zap, TrendingUp, TrendingDown, Brain,
  Server, GitBranch, Layers, BarChart3, RefreshCw, Gauge,
  Globe, Power,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';

interface HealthCheck {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  details?: Record<string, any>;
}

interface HealthSummary {
  status: string;
  checks: HealthCheck[];
  timestamp: string;
}

interface CronStatus {
  [key: string]: { lastRun: string; lastStatus: string; lastError?: string };
}

interface DataFlow {
  pipeline: {
    assets: number;
    strategies: number;
    signals24h: number;
    signals7d: number;
    openPositions: number;
    signalLogs: number;
    features: number;
  };
  outcomes: Record<string, number>;
  crons: CronStatus;
  timestamp: string;
}

interface StrategyPerf {
  strategyId: string;
  name: string;
  isActive: boolean;
  signalsGenerated: number;
  buyCount: number;
  sellCount: number;
  avgConfidence: number;
  tradesClosed: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnlPct: number;
}

interface ContainerStat {
  name: string;
  cpuPerc: string;
  memUsage: string;
  memPerc: string;
}

interface HostCpu {
  user: string;
  system: string;
  idle: string;
  load1: string;
  load5: string;
  load15: string;
}

interface TopProcess {
  user: string;
  pid: string;
  cpu: string;
  mem: string;
  command: string;
}

interface ContainerInfo {
  api: any;
  engine: any;
  containers: ContainerStat[];
  hostCpu: HostCpu | null;
  topProcesses: TopProcess[];
}

const statusIcon = (status: string) => {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
};

const statusColor = (status: string) => {
  if (status === 'ok') return 'text-emerald-400';
  if (status === 'warning') return 'text-amber-400';
  return 'text-red-400';
};

function PipelineStep({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl min-w-[100px]">
      <div className="text-gray-500">{icon}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<'health' | 'dataflow' | 'strategies' | 'polling' | 'markets'>('health');
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: health, refetch: refetchHealth } = useQuery<HealthSummary>({
    queryKey: ['system-health'],
    queryFn: async () => (await api.get('/system/health')).data,
    refetchInterval: 30000,
  });

  const { data: dataFlow } = useQuery<DataFlow>({
    queryKey: ['system-data-flow'],
    queryFn: async () => (await api.get('/system/data-flow')).data,
    refetchInterval: 30000,
  });

  const { data: strategyPerf } = useQuery<StrategyPerf[]>({
    queryKey: ['strategy-performance'],
    queryFn: async () => (await api.get('/strategies/performance')).data,
  });

  const { data: containerInfo } = useQuery<ContainerInfo>({
    queryKey: ['admin-containers'],
    queryFn: async () => (await api.get('/admin/ops/containers')).data,
    refetchInterval: 15000,
  });

  return (
    <AppLayout title="Admin Dashboard">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Server className="w-6 h-6" /> Admin Dashboard
          </h1>
          <button
            onClick={() => refetchHealth()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'health', label: 'Santé système', icon: <Activity className="w-4 h-4" /> },
            { key: 'dataflow', label: 'Data Flow', icon: <GitBranch className="w-4 h-4" /> },
            { key: 'strategies', label: 'Stratégies', icon: <BarChart3 className="w-4 h-4" /> },
            { key: 'polling', label: 'Polling', icon: <Gauge className="w-4 h-4" /> },
            { key: 'markets', label: 'Marchés', icon: <Globe className="w-4 h-4" /> },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition ${
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Health tab */}
        {tab === 'health' && (
          <div className="space-y-4">
            <div className={`p-4 rounded-xl border ${
              health?.status === 'ok' ? 'bg-emerald-950 border-emerald-800' :
              health?.status === 'warning' ? 'bg-amber-950 border-amber-800' :
              'bg-red-950 border-red-800'
            }`}>
              <div className="flex items-center gap-3">
                {statusIcon(health?.status ?? 'critical')}
                <div>
                  <p className="text-lg font-semibold text-white">
                    Statut global: {health?.status?.toUpperCase() ?? '...'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {health ? new Date(health.timestamp).toLocaleString() : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {health?.checks.map(check => (
                <div key={check.name} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {statusIcon(check.status)}
                      <span className="font-medium text-white capitalize">{check.name}</span>
                    </div>
                    <span className={`text-xs ${statusColor(check.status)}`}>{check.status}</span>
                  </div>
                  <p className="text-sm text-gray-400">{check.message}</p>
                  {check.details && (
                    <pre className="mt-2 text-xs text-gray-600 overflow-x-auto">
                      {JSON.stringify(check.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>

            {/* Cron status */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Cron Jobs
              </h3>
              <div className="space-y-2">
                {dataFlow && Object.entries(dataFlow.crons).map(([name, cron]) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <span className="text-gray-300">{name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">
                        {new Date(cron.lastRun).toLocaleTimeString()}
                      </span>
                      {cron.lastStatus === 'ok'
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : <XCircle className="w-4 h-4 text-red-400" />}
                    </div>
                  </div>
                ))}
                {dataFlow && Object.keys(dataFlow.crons).length === 0 && (
                  <p className="text-sm text-gray-500">No cron runs recorded yet.</p>
                )}
              </div>
            </div>

            {/* CPU Monitoring */}
            {containerInfo && (
              <div className="space-y-4">
                {/* Host CPU bar */}
                {containerInfo.hostCpu && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                      <Cpu className="w-4 h-4" /> CPU Hôte
                    </h3>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden flex">
                        <div className="bg-blue-600" style={{ width: `${containerInfo.hostCpu.user}%` }} />
                        <div className="bg-purple-600" style={{ width: `${containerInfo.hostCpu.system}%` }} />
                        <div className="bg-emerald-600" style={{ width: `${containerInfo.hostCpu.idle}%` }} />
                      </div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span className="text-blue-400">User: {containerInfo.hostCpu.user}%</span>
                      <span className="text-purple-400">Sys: {containerInfo.hostCpu.system}%</span>
                      <span className="text-emerald-400">Idle: {containerInfo.hostCpu.idle}%</span>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-gray-500">
                      <span>Load 1m: <span className={parseFloat(containerInfo.hostCpu.load1) > 4 ? 'text-red-400' : 'text-gray-300'}>{containerInfo.hostCpu.load1}</span></span>
                      <span>5m: <span className={parseFloat(containerInfo.hostCpu.load5) > 4 ? 'text-red-400' : 'text-gray-300'}>{containerInfo.hostCpu.load5}</span></span>
                      <span>15m: <span className="text-gray-300">{containerInfo.hostCpu.load15}</span></span>
                    </div>
                  </div>
                )}

                {/* Container CPU table */}
                {containerInfo.containers.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                      <Server className="w-4 h-4" /> Containers Docker
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400">
                          <th className="text-left py-2">Container</th>
                          <th className="text-right py-2">CPU</th>
                          <th className="text-right py-2">Memoire</th>
                          <th className="text-right py-2">Mem %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {containerInfo.containers.map(c => {
                          const cpuVal = parseFloat(c.cpuPerc?.replace('%', '') || '0');
                          return (
                            <tr key={c.name} className="border-b border-gray-800/50">
                              <td className="py-2 text-gray-300">{c.name}</td>
                              <td className={`py-2 text-right font-mono ${cpuVal > 100 ? 'text-red-400' : cpuVal > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {c.cpuPerc}
                              </td>
                              <td className="py-2 text-right text-gray-400 font-mono">{c.memUsage}</td>
                              <td className="py-2 text-right text-gray-400">{c.memPerc}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Top processes */}
                {containerInfo.topProcesses.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                      <Activity className="w-4 h-4" /> Top Processus (CPU)
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400">
                          <th className="text-left py-2">PID</th>
                          <th className="text-right py-2">CPU %</th>
                          <th className="text-right py-2">Mem %</th>
                          <th className="text-left py-2">Commande</th>
                        </tr>
                      </thead>
                      <tbody>
                        {containerInfo.topProcesses.map((p, i) => (
                          <tr key={i} className="border-b border-gray-800/50">
                            <td className="py-2 text-gray-400 font-mono">{p.pid}</td>
                            <td className={`py-2 text-right font-mono ${parseFloat(p.cpu) > 50 ? 'text-red-400' : parseFloat(p.cpu) > 20 ? 'text-amber-400' : 'text-gray-300'}`}>
                              {p.cpu}%
                            </td>
                            <td className="py-2 text-right text-gray-400 font-mono">{p.mem}%</td>
                            <td className="py-2 text-gray-500 text-xs truncate max-w-[300px]">{p.command}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Data Flow tab */}
        {tab === 'dataflow' && dataFlow && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <GitBranch className="w-4 h-4" /> Pipeline
              </h3>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <PipelineStep label="Assets" value={dataFlow.pipeline.assets} icon={<Database className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Strategies" value={dataFlow.pipeline.strategies} icon={<Layers className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Signals 24h" value={dataFlow.pipeline.signals24h} icon={<Zap className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Signals 7d" value={dataFlow.pipeline.signals7d} icon={<TrendingUp className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Positions" value={dataFlow.pipeline.openPositions} icon={<Activity className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Signal Logs" value={dataFlow.pipeline.signalLogs} icon={<BarChart3 className="w-4 h-4" />} />
                <span className="text-gray-600">→</span>
                <PipelineStep label="Features" value={dataFlow.pipeline.features} icon={<Brain className="w-4 h-4" />} />
              </div>
            </div>

            {/* Outcome breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Signal Outcomes</h3>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {Object.entries(dataFlow.outcomes).map(([outcome, count]) => (
                  <div key={outcome} className="text-center p-3 bg-gray-950 rounded-lg">
                    <p className="text-2xl font-bold text-white">{count}</p>
                    <p className="text-xs text-gray-400">{outcome}</p>
                  </div>
                ))}
                {Object.keys(dataFlow.outcomes).length === 0 && (
                  <p className="text-sm text-gray-500 col-span-6">No outcomes recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Strategies tab */}
        {tab === 'strategies' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-4 py-3">Stratégie</th>
                  <th className="text-center px-4 py-3">Active</th>
                  <th className="text-right px-4 py-3">Signaux</th>
                  <th className="text-right px-4 py-3">Confiance moy.</th>
                  <th className="text-right px-4 py-3">Trades</th>
                  <th className="text-right px-4 py-3">Win Rate</th>
                  <th className="text-right px-4 py-3">PnL total</th>
                  <th className="text-right px-4 py-3">PnL moy. %</th>
                </tr>
              </thead>
              <tbody>
                {strategyPerf?.map(s => (
                  <tr key={s.strategyId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-center">
                      {s.isActive
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                        : <XCircle className="w-4 h-4 text-gray-600 inline" />}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{s.signalsGenerated}</td>
                    <td className="px-4 py-3 text-right text-gray-300">{s.avgConfidence}%</td>
                    <td className="px-4 py-3 text-right text-gray-300">{s.tradesClosed}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>
                        {s.winRate}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {s.totalPnl >= 0 ? '+' : ''}{s.totalPnl}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">{s.avgPnlPct}%</td>
                  </tr>
                ))}
                {(!strategyPerf || strategyPerf.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      No strategy performance data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {/* Polling tab */}
        {tab === 'polling' && <PollingTab />}

        {/* Markets tab */}
        {tab === 'markets' && <MarketsTab />}
      </div>
    </AppLayout>
  );
}

function PollingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: pollingConfig } = useQuery({
    queryKey: ['polling-config-admin'],
    queryFn: async () => (await api.get('/system/polling-config')).data,
  });

  const updatePolling = useMutation({
    mutationFn: async (patch: { scanPollingEnabled?: boolean; scanPollingInterval?: number }) =>
      (await api.patch('/system/polling-config', patch)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['polling-config-admin'] });
      qc.invalidateQueries({ queryKey: ['polling-config'] });
      toast('Configuration de polling mise à jour', { type: 'success' });
    },
  });

  const enabled = pollingConfig?.scanPollingEnabled ?? true;
  const interval = pollingConfig?.scanPollingInterval ?? 5_000;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-blue-400" /> Scan Polling
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          Contrôle le polling automatique de l&apos;historique des scans sur la page Signaux.
          Désactiver réduit la charge serveur mais les données ne se rafraîchissent plus automatiquement.
        </p>

        <div className="flex items-center justify-between py-3 border-b border-gray-800">
          <div>
            <p className="text-white font-medium">Polling activé</p>
            <p className="text-xs text-gray-500">Active/désactive le rafraîchissement automatique</p>
          </div>
          <button
            onClick={() => updatePolling.mutate({ scanPollingEnabled: !enabled })}
            className={`relative w-12 h-6 rounded-full transition ${
              enabled ? 'bg-emerald-600' : 'bg-gray-700'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${
              enabled ? 'left-6' : 'left-0.5'
            }`} />
          </button>
        </div>

        <div className="py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-white font-medium">Intervalle de polling</p>
            <span className="text-sm text-gray-400">{interval / 1000}s</span>
          </div>
          <input
            type="range"
            min={1000}
            max={60000}
            step={1000}
            value={interval}
            disabled={!enabled}
            onChange={(e) => updatePolling.mutate({ scanPollingInterval: Number(e.target.value) })}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1s</span>
            <span>60s</span>
          </div>
        </div>

        {updatePolling.isPending && (
          <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" /> Mise à jour...
          </p>
        )}
      </div>
    </div>
  );
}

interface MarketConfig {
  marketType: string;
  isActive: boolean;
  warmupEnabled: boolean;
  scanInterval: number | null;
  maxStrategies: number | null;
  timeframes: string[] | null;
}

const MARKET_LABELS: Record<string, string> = {
  CRYPTO: 'Crypto',
  FOREX: 'Forex',
  SYNTHETIC: 'Synthétiques (Deriv)',
  BRVM: 'BRVM',
  US_STOCK: 'Actions US',
  COMMODITY: 'Commodités',
};

const MARKET_COLORS: Record<string, string> = {
  CRYPTO: 'text-amber-400',
  FOREX: 'text-blue-400',
  SYNTHETIC: 'text-purple-400',
  BRVM: 'text-emerald-400',
  US_STOCK: 'text-cyan-400',
  COMMODITY: 'text-orange-400',
};

function MarketsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: markets, isLoading } = useQuery<MarketConfig[]>({
    queryKey: ['admin-markets'],
    queryFn: async () => (await api.get('/admin/markets')).data,
  });

  const updateMarket = useMutation({
    mutationFn: async (params: {
      marketType: string;
      isActive?: boolean;
      warmupEnabled?: boolean;
      maxStrategies?: number | null;
      scanInterval?: number | null;
    }) => (await api.put(`/admin/markets/${params.marketType}`, {
      isActive: params.isActive,
      warmupEnabled: params.warmupEnabled,
      maxStrategies: params.maxStrategies,
      scanInterval: params.scanInterval,
    })).data,
    onMutate: async (params) => {
      await qc.cancelQueries({ queryKey: ['admin-markets'] });
      const prev = qc.getQueryData<MarketConfig[]>(['admin-markets']);
      if (prev) {
        qc.setQueryData<MarketConfig[]>(['admin-markets'], prev.map(m =>
          m.marketType === params.marketType
            ? { ...m, isActive: params.isActive ?? m.isActive, warmupEnabled: params.warmupEnabled ?? m.warmupEnabled, maxStrategies: params.maxStrategies ?? m.maxStrategies, scanInterval: params.scanInterval ?? m.scanInterval }
            : m
        ));
      }
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-markets'] });
      toast('Configuration marché mise à jour', { type: 'success' });
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['admin-markets'], ctx.prev);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-950 border border-blue-800 rounded-xl p-4">
        <p className="text-sm text-blue-200">
          Contrôle l&apos;activation des marchés et le pré-calcul (warmup). Désactiver un marché
          arrête les scans automatiques et le scraping. Les scans à la demande restent disponibles via l&apos;API.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {markets?.map((m) => (
          <div
            key={m.marketType}
            className={`bg-gray-900 border rounded-xl p-5 ${
              m.isActive ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe className={`w-5 h-5 ${MARKET_COLORS[m.marketType] ?? 'text-gray-400'}`} />
                <h3 className="text-lg font-semibold text-white">
                  {MARKET_LABELS[m.marketType] ?? m.marketType}
                </h3>
              </div>
              <button
                onClick={() => updateMarket.mutate({ marketType: m.marketType, isActive: !m.isActive })}
                className={`relative w-12 h-6 rounded-full transition ${
                  m.isActive ? 'bg-emerald-600' : 'bg-gray-700'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${
                  m.isActive ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <Power className="w-4 h-4 text-gray-500" />
                  <div>
                    <p className="text-sm text-white font-medium">Warmup (pré-calcul)</p>
                    <p className="text-xs text-gray-500">Scans automatiques en arrière-plan</p>
                  </div>
                </div>
                <button
                  onClick={() => updateMarket.mutate({ marketType: m.marketType, warmupEnabled: !m.warmupEnabled })}
                  className={`relative w-10 h-5 rounded-full transition ${
                    m.warmupEnabled ? 'bg-emerald-600' : 'bg-gray-700'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${
                    m.warmupEnabled ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </div>

              <div className="py-2 border-b border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-white font-medium">Max stratégies warmup</p>
                  <span className="text-sm text-gray-400">
                    {m.maxStrategies ?? 'Toutes'}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={1}
                  value={m.maxStrategies ?? 8}
                  disabled={!m.warmupEnabled}
                  onChange={(e) => updateMarket.mutate({
                    marketType: m.marketType,
                    maxStrategies: Number(e.target.value),
                  })}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>1</span>
                  <span>8</span>
                </div>
              </div>

              <div className="py-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-white font-medium">Intervalle scan (s)</p>
                  <span className="text-sm text-gray-400">
                    {m.scanInterval ? `${m.scanInterval}s` : 'Défaut'}
                  </span>
                </div>
                <input
                  type="number"
                  min={30}
                  max={3600}
                  step={30}
                  value={m.scanInterval ?? ''}
                  disabled={!m.warmupEnabled}
                  placeholder="Défaut"
                  onChange={(e) => updateMarket.mutate({
                    marketType: m.marketType,
                    scanInterval: e.target.value ? Number(e.target.value) : null,
                  })}
                  className="w-full bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            {updateMarket.isPending && (
              <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
                <RefreshCw className="w-3 h-3 animate-spin" /> Mise à jour...
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
