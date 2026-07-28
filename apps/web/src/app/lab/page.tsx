'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import {
  FlaskConical, Plus, Play, Save, ChevronDown, ChevronUp, BarChart2,
  CheckCircle, XCircle, AlertTriangle, TrendingUp, TrendingDown, FileText, Shuffle, Rocket,
} from 'lucide-react';

const MiniEquityChart = dynamic(
  () => import('@/components/backtest/MiniEquityChart').then(mod => mod.MiniEquityChart),
  { ssr: false, loading: () => <div className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" /> },
);

interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  strategy: any;
}

interface LabSession {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  strategy: any;
  status: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'ARCHIVED';
  backtestMetrics: any;
  tradeList: any[];
  createdAt: string;
}

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AVAX/USDT', 'XRP/USDT', 'EUR/USD', 'XAU/USD'];
const RISK_LEVELS = ['conservative', 'moderate', 'aggressive'] as const;

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function LabPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('Nouvelle stratégie');
  const [symbol, setSymbol] = useState('ETH/USDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [templateId, setTemplateId] = useState('');
  const [strategyJson, setStrategyJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [riskLevel, setRiskLevel] = useState<typeof RISK_LEVELS[number]>('moderate');
  const [profileResult, setProfileResult] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [walkForward, setWalkForward] = useState<any>(null);
  const [promoteResult, setPromoteResult] = useState<any>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<any>(null);

  const { data: templates = [] } = useQuery<StrategyTemplate[]>({
    queryKey: ['lab-templates'],
    queryFn: async () => (await api.get('/lab/templates')).data,
  });

  const { data: sessions = [] } = useQuery<LabSession[]>({
    queryKey: ['lab-sessions'],
    queryFn: async () => (await api.get('/lab/sessions')).data,
  });

  const selected = sessions.find(s => s.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setSymbol(selected.symbol);
      setTimeframe(selected.timeframe);
      setStrategyJson(JSON.stringify(selected.strategy ?? {}, null, 2));
    }
  }, [selected?.id, selected]);

  useEffect(() => {
    if (templates.length && !templateId) {
      setTemplateId(templates[0].id);
      setStrategyJson(JSON.stringify(templates[0].strategy, null, 2));
    }
  }, [templates, templateId]);

  const handleTemplateChange = (id: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setStrategyJson(JSON.stringify(t.strategy, null, 2));
    setJsonError(null);
  };

  const validateJson = (v: string): any | null => {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const strategy = validateJson(strategyJson);
      if (!strategy) throw new Error('JSON invalide');
      return (await api.post('/lab/sessions', { name, symbol, timeframe, strategy })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-sessions'] });
      setShowCreate(false);
    },
  });

  const backtestMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/lab/sessions/${id}/backtest`, {
        lookback_bars: 500,
        initial_capital: 10000,
        risk_pct: 1.0,
        min_confidence: 55,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-sessions'] }),
  });

  const evaluateMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/lab/sessions/${id}/evaluate`)).data,
  });

  const suitabilityMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/lab/sessions/${id}/suitability`, { riskLevel })).data,
    onSuccess: (data) => setProfileResult(data),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/lab/sessions/${id}/archive`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lab-sessions'] }),
  });

  const compareMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/lab/compare', { ids: compareIds })).data,
    onSuccess: (data) => setCompareResult(data),
  });

  return (
    <AppLayout title="Testeur Lab">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-emerald-400" /> Testeur Lab
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Créer, backtester et évaluer des stratégies</p>
          </div>
          <button
            onClick={() => setShowCreate(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />{showCreate ? 'Fermer' : 'Nouvelle session'}
          </button>
        </div>

        {showCreate && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Nom</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Symbole</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                  {SYMBOLS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Timeframe</label>
                <select value={timeframe} onChange={e => setTimeframe(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                  {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Template</label>
                <select value={templateId} onChange={e => handleTemplateChange(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Stratégie JSON</label>
              <textarea
                value={strategyJson}
                onChange={e => { setStrategyJson(e.target.value); setJsonError(validateJson(e.target.value) ? null : 'JSON invalide'); }}
                rows={10}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-emerald-300 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
              {jsonError && <p className="text-red-400 text-xs mt-1">{jsonError}</p>}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !!jsonError}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                <Save className="w-4 h-4" />{createMutation.isPending ? 'Création…' : 'Créer la session'}
              </button>
            </div>
            {createMutation.error && (
              <p className="text-red-400 text-sm">{(createMutation.error as any)?.message}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Liste sessions */}
          <div className="lg:col-span-1 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-300">Sessions</h3>
              {compareIds.length >= 2 && (
                <button
                  onClick={() => compareMutation.mutate()}
                  disabled={compareMutation.isPending}
                  className="text-xs px-2 py-1 rounded bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-50"
                >
                  Comparer {compareIds.length}
                </button>
              )}
            </div>
            {compareResult && (
              <div className="bg-gray-900 border border-violet-500/30 rounded-xl p-3 text-xs">
                <p className="text-violet-400 font-medium mb-1">Gagnant : {compareResult.sessions.find((s: any) => s.id === compareResult.winnerId)?.name ?? '—'}</p>
                <div className="space-y-1">
                  {compareResult.sessions.map((s: any, i: number) => (
                    <div key={s.id} className={`flex items-center justify-between ${i === 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                      <span className="truncate max-w-[70%]">{i + 1}. {s.name}</span>
                      <span className="font-mono">{s.score} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sessions.length === 0 && <p className="text-gray-500 text-sm">Aucune session.</p>}
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => { setSelectedId(s.id); setProfileResult(null); setReport(null); setWalkForward(null); setPromoteResult(null); }}
                className={`w-full text-left bg-gray-900 border rounded-xl p-4 transition-colors cursor-pointer ${selectedId === s.id ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-gray-800 hover:border-gray-700'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="checkbox"
                    checked={compareIds.includes(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (e.target.checked) setCompareIds(ids => [...ids, s.id]);
                      else setCompareIds(ids => ids.filter(id => id !== s.id));
                    }}
                    className="accent-violet-500 w-3.5 h-3.5 shrink-0"
                  />
                  <span className="font-medium text-white text-sm truncate flex-1">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    s.status === 'COMPLETED' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' :
                    s.status === 'RUNNING' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' :
                    s.status === 'ARCHIVED' ? 'bg-gray-700 text-gray-400 border-gray-600' :
                    'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
                  }`}>{s.status}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">{s.symbol} · {s.timeframe}</p>
                {s.backtestMetrics && (
                  <p className={`text-xs font-mono mt-2 ${s.backtestMetrics.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    PnL {s.backtestMetrics.total_pnl_pct}% · PF {s.backtestMetrics.profit_factor}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Détail */}
          <div className="lg:col-span-2 space-y-4">
            {!selected && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
                Sélectionnez ou créez une session pour commencer.
              </div>
            )}
            {selected && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => backtestMutation.mutate(selected.id)}
                    disabled={backtestMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    <Play className="w-4 h-4" />{backtestMutation.isPending ? 'Backtest…' : 'Lancer backtest'}
                  </button>
                  <button
                    onClick={() => evaluateMutation.mutate(selected.id)}
                    disabled={evaluateMutation.isPending || selected.status !== 'COMPLETED'}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    <BarChart2 className="w-4 h-4" />Évaluer
                  </button>
                  <select
                    value={riskLevel}
                    onChange={e => setRiskLevel(e.target.value as any)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    onClick={() => suitabilityMutation.mutate(selected.id)}
                    disabled={suitabilityMutation.isPending || selected.status !== 'COMPLETED'}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    Profil
                  </button>
                  <button
                    onClick={async () => {
                      const { data } = await api.get(`/lab/sessions/${selected.id}/report`);
                      setReport(data);
                    }}
                    disabled={selected.status !== 'COMPLETED'}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    <FileText className="w-4 h-4" />Rapport
                  </button>
                  <button
                    onClick={async () => {
                      const { data } = await api.get(`/lab/sessions/${selected.id}/walk-forward`);
                      setWalkForward(data);
                    }}
                    disabled={selected.status !== 'COMPLETED'}
                    className="flex items-center gap-2 px-4 py-2 bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    <Shuffle className="w-4 h-4" />Walk-forward
                  </button>
                  <button
                    onClick={async () => {
                      const { data } = await api.post(`/lab/sessions/${selected.id}/promote`, {});
                      setPromoteResult(data);
                    }}
                    disabled={selected.status !== 'COMPLETED'}
                    className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
                  >
                    <Rocket className="w-4 h-4" />Promouvoir
                  </button>
                  <button
                    onClick={() => archiveMutation.mutate(selected.id)}
                    disabled={archiveMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg text-sm transition-colors ml-auto"
                  >
                    Archiver
                  </button>
                </div>

                {selected.backtestMetrics && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <MetricCard label="Trades" value={String(selected.backtestMetrics.trades)} sub={`W:${selected.backtestMetrics.wins} L:${selected.backtestMetrics.losses}`} />
                      <MetricCard label="Win Rate" value={`${selected.backtestMetrics.win_rate}%`}
                        color={selected.backtestMetrics.win_rate >= 50 ? 'text-emerald-400' : 'text-red-400'} />
                      <MetricCard label="PnL total" value={`${selected.backtestMetrics.total_pnl >= 0 ? '+' : ''}${selected.backtestMetrics.total_pnl_pct}%`}
                        sub={`$${selected.backtestMetrics.total_pnl}`}
                        color={selected.backtestMetrics.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                      <MetricCard label="Profit Factor" value={String(selected.backtestMetrics.profit_factor)}
                        color={selected.backtestMetrics.profit_factor >= 1.5 ? 'text-emerald-400' : selected.backtestMetrics.profit_factor < 1 ? 'text-red-400' : 'text-gray-400'} />
                      <MetricCard label="Max Drawdown" value={`${selected.backtestMetrics.max_drawdown_pct}%`} color="text-orange-400" />
                      <MetricCard label="Sharpe" value={String(selected.backtestMetrics.sharpe_ratio)}
                        color={selected.backtestMetrics.sharpe_ratio >= 1 ? 'text-emerald-400' : 'text-gray-400'} />
                      <MetricCard label="Expectancy" value={String(selected.backtestMetrics.expectancy)} />
                      <MetricCard label="vs Benchmark" value={`${selected.backtestMetrics.outperformance_pct >= 0 ? '+' : ''}${selected.backtestMetrics.outperformance_pct}%`}
                        color={selected.backtestMetrics.outperformance_pct >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                    </div>
                    {selected.tradeList && <MiniEquityChart curve={selected.tradeList.map((t: any) => t.pnl)} />}
                  </>
                )}

                {evaluateMutation.data && (
                  <div className={`rounded-xl p-4 border ${
                    evaluateMutation.data.verdict === 'STRONG' ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400' :
                    evaluateMutation.data.verdict === 'PROMISING' ? 'bg-blue-400/10 border-blue-400/20 text-blue-400' :
                    evaluateMutation.data.verdict === 'MARGINAL' ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400' :
                    'bg-red-400/10 border-red-400/20 text-red-400'
                  }`}>
                    <div className="flex items-center gap-2 font-semibold">
                      {evaluateMutation.data.verdict === 'STRONG' ? <CheckCircle className="w-5 h-5" /> :
                       evaluateMutation.data.verdict === 'REJECT' ? <XCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      Verdict : {evaluateMutation.data.verdict} · Score {evaluateMutation.data.score}/8
                    </div>
                  </div>
                )}

                {profileResult && (
                  <div className={`rounded-xl p-4 border ${profileResult.suitable ? 'bg-emerald-400/10 border-emerald-400/20' : 'bg-red-400/10 border-red-400/20'}`}>
                    <p className={`font-semibold ${profileResult.suitable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {profileResult.suitable ? (
                        <><CheckCircle className="w-4 h-4 inline mr-1" /> Adapté au profil {profileResult.riskLevel}</>
                      ) : (
                        <><XCircle className="w-4 h-4 inline mr-1" /> Non adapté au profil {profileResult.riskLevel}</>
                      )}
                    </p>
                    {profileResult.reasons && (
                      <ul className="text-xs text-gray-400 mt-2 list-disc pl-4">
                        {profileResult.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    )}
                  </div>
                )}

                {report && !report.error && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white font-semibold">
                      <FileText className="w-4 h-4 text-amber-400" /> Rapport détaillé
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-gray-950 rounded-lg p-3">
                        <p className="text-gray-500">Durée moyenne</p>
                        <p className="text-white font-mono">{report.statistics.avgHoldBars} barres</p>
                      </div>
                      <div className="bg-gray-950 rounded-lg p-3">
                        <p className="text-gray-500">Meilleur trade</p>
                        <p className="text-emerald-400 font-mono">+{report.statistics.bestTradePct}%</p>
                      </div>
                      <div className="bg-gray-950 rounded-lg p-3">
                        <p className="text-gray-500">Pire trade</p>
                        <p className="text-red-400 font-mono">{report.statistics.worstTradePct}%</p>
                      </div>
                      <div className="bg-gray-950 rounded-lg p-3">
                        <p className="text-gray-500">Max win streak</p>
                        <p className="text-white font-mono">{report.statistics.maxWinStreak}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Recommandations</p>
                      <ul className="text-sm text-gray-300 list-disc pl-4 space-y-1">
                        {report.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                    {report.statistics.reasonDistribution && Object.keys(report.statistics.reasonDistribution).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Fréquence des raisons de signal</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(report.statistics.reasonDistribution).map(([reason, count]: [string, any]) => (
                            <span key={reason} className="px-2 py-1 rounded bg-gray-800 text-gray-300 text-xs border border-gray-700">
                              {reason}: {count}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {report?.error && (
                  <div className="p-4 bg-yellow-400/10 border border-yellow-400/20 rounded-xl text-yellow-400 text-sm">
                    {report.message}
                  </div>
                )}

                {walkForward && !walkForward.error && (
                  <div className={`rounded-xl p-4 border ${
                    walkForward.verdict === 'ROBUST' ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400' :
                    walkForward.verdict === 'MILD_OVERFIT' ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400' :
                    'bg-red-400/10 border-red-400/20 text-red-400'
                  }`}>
                    <p className="font-semibold flex items-center gap-2">
                      {walkForward.verdict === 'ROBUST' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      Walk-forward : {walkForward.verdict} · score {walkForward.overfitScore}/4
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                      <div className="bg-gray-950/50 rounded p-2">
                        <p className="text-gray-500">Win Rate IS</p>
                        <p>{walkForward.inSample.winRate.toFixed(1)}%</p>
                      </div>
                      <div className="bg-gray-950/50 rounded p-2">
                        <p className="text-gray-500">Win Rate OOS</p>
                        <p>{walkForward.outOfSample.winRate.toFixed(1)}%</p>
                      </div>
                      <div className="bg-gray-950/50 rounded p-2">
                        <p className="text-gray-500">Profit Factor IS</p>
                        <p>{walkForward.inSample.profitFactor.toFixed(2)}</p>
                      </div>
                      <div className="bg-gray-950/50 rounded p-2">
                        <p className="text-gray-500">Profit Factor OOS</p>
                        <p>{walkForward.outOfSample.profitFactor.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {walkForward?.error && (
                  <div className="p-4 bg-yellow-400/10 border border-yellow-400/20 rounded-xl text-yellow-400 text-sm">
                    {walkForward.message}
                  </div>
                )}

                {promoteResult && (
                  <div className={`rounded-xl p-4 border text-sm ${promoteResult.error ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400' : 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'}`}>
                    {promoteResult.error
                      ? <p className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {promoteResult.message}</p>
                      : <p className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Stratégie promue : <span className="font-semibold">{promoteResult.name}</span></p>}
                  </div>
                )}

                {selected.tradeList && selected.tradeList.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <p className="px-4 py-3 text-sm font-medium text-white border-b border-gray-800">Trades ({selected.tradeList.length})</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-800/50">
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">#</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">Dir</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">Entry</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">Exit</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">PnL %</th>
                            <th className="px-4 py-2 text-left text-gray-500 font-medium">Conf</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                          {selected.tradeList.map((t: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-800/30">
                              <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                              <td className="px-4 py-2">
                                <span className={`px-1.5 py-0.5 rounded font-bold ${t.direction === 'BUY' ? 'text-emerald-400 bg-emerald-400/10' : 'text-red-400 bg-red-400/10'}`}>{t.direction}</span>
                              </td>
                              <td className="px-4 py-2 font-mono text-gray-300">${t.entry_price}</td>
                              <td className="px-4 py-2 font-mono text-gray-300">${t.exit_price}</td>
                              <td className={`px-4 py-2 font-mono ${t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%</td>
                              <td className="px-4 py-2 text-gray-400">{Math.round(t.confidence)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
