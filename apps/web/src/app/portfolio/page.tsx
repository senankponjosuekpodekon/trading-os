'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, X, Plus, AlertCircle, RefreshCw,
  Calculator, Zap, History, Activity, ChevronLeft, ChevronRight, Bot, Target,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { useTradingStore } from '@/store/trading.store';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { Portfolio, PortfolioSummary, Position, Signal } from '@/types';

interface LivePosition extends Position {
  livePrice:    number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  slDistance:   number | null;
  tpDistance:   number | null;
}

function PnlBadge({ value }: { value: string | number | undefined }) {
  const n = parseFloat(String(value ?? 0));
  const color = n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-gray-400';
  return <span className={`font-mono font-semibold ${color}`}>{n >= 0 ? '+' : ''}${n.toFixed(2)}</span>;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
      <AlertCircle className="w-5 h-5 shrink-0" />
      <span className="text-sm flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 text-xs hover:text-red-300 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />Réessayer
        </button>
      )}
    </div>
  );
}

const ASSETS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'EUR/USD', 'GBP/USD', 'XAU/USD', 'V75'];

export default function PortfolioPage() {
  const [tab,         setTab]         = useState<'open' | 'history'>('open');
  const [showForm,    setShowForm]    = useState(false);
  const [closePrice,  setClosePrice]  = useState<Record<string, string>>({});
  const [form,        setForm]        = useState({
    assetSymbol: 'BTC/USDT',
    direction: 'BUY',
    entryPrice: '',
    quantity: '',
    stopLoss: '',
    takeProfit: '',
    trailingMethod: 'atr',
    trailingActive: true,
  });
  const [riskCalc,    setRiskCalc]    = useState<any>(null);
  const [riskPct,     setRiskPct]     = useState('1.0');
  const [calcLoading, setCalcLoading] = useState(false);
  const [histPage,    setHistPage]    = useState(0);
  const [formError,   setFormError]   = useState<string | null>(null);
  const [aiReview,    setAiReview]    = useState<{ positionId: string; text: string; pnl: number | null } | null>(null);
  const [continuation, setContinuation] = useState<Record<string, any>>({});
  const qc = useQueryClient();

  const HIST_PAGE_SIZE = 10;

  const calcRisk = async () => {
    if (!form.entryPrice || !form.stopLoss || !portfolio) return;
    setCalcLoading(true);
    try {
      const { data } = await api.post('/risk/calculate', {
        capital:     parseFloat(portfolio.currentCapital),
        entry_price: parseFloat(form.entryPrice),
        stop_loss:   parseFloat(form.stopLoss),
        direction:   form.direction,
        risk_pct:    parseFloat(riskPct),
      });
      setRiskCalc(data);
      setForm(v => ({
        ...v,
        quantity:   String(data.position_size),
        takeProfit: String(data.take_profit_1),
      }));
    } catch {}
    setCalcLoading(false);
  };

  const { data: portfolios, isLoading: loadingPortfolio, error: errorPortfolio, refetch: refetchPortfolio } = useQuery<Portfolio[]>({
    queryKey: ['portfolios'],
    queryFn: async () => (await api.get('/portfolios')).data,
  });

  const portfolio = portfolios?.[0];

  const { data: summary, isLoading: loadingSummary, error: errorSummary, refetch: refetchSummary } = useQuery<PortfolioSummary>({
    queryKey: ['positions-summary', portfolio?.id],
    queryFn: async () => (await api.get(`/positions/summary?portfolioId=${portfolio!.id}`)).data,
    enabled: !!portfolio?.id,
  });

  // Live positions avec PnL temps réel (J15)
  const { data: livePositions, refetch: refetchLive } = useQuery<LivePosition[]>({
    queryKey: ['positions-live', portfolio?.id],
    queryFn: async () => (await api.get('/positions/live')).data,
    enabled: tab === 'open',
    refetchInterval: 30_000,
  });

  // Signaux actifs depuis le store global
  const signals = useTradingStore(s => s.signals) as Signal[];

  const activeSignals = signals?.filter(s => s.signal !== 'NEUTRAL') ?? [];

  const openPosition = useMutation({
    mutationFn: (data: any) => api.post('/positions', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positions-summary'] });
      qc.invalidateQueries({ queryKey: ['portfolios'] });
      setShowForm(false);
      setForm({
        assetSymbol: 'BTC/USDT',
        direction: 'BUY',
        entryPrice: '',
        quantity: '',
        stopLoss: '',
        takeProfit: '',
        trailingMethod: 'atr',
        trailingActive: true,
      });
    },
  });

  const closePosition = useMutation({
    mutationFn: ({ id, exitPrice }: { id: string; exitPrice: number }) =>
      api.patch(`/positions/${id}/close`, { exitPrice }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['positions-live'] });
      const previous = qc.getQueryData<LivePosition[]>(['positions-live']);
      if (previous) {
        qc.setQueryData(['positions-live'], previous.filter(p => p.id !== id));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['positions-live'], context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['positions-summary'] });
      qc.invalidateQueries({ queryKey: ['positions-live'] });
      qc.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });

  const updateTrailingStop = useMutation({
    mutationFn: ({ id, method, active }: { id: string; method?: string; active?: boolean }) =>
      api.post(`/positions/${id}/trailing-stop`, { method, active }),
    onMutate: async ({ id, method, active }) => {
      await qc.cancelQueries({ queryKey: ['positions-live'] });
      const previous = qc.getQueryData<LivePosition[]>(['positions-live']);
      if (previous) {
        qc.setQueryData(['positions-live'],
          previous.map(p => p.id === id ? { ...p, ...(method && { trailingMethod: method as any }), ...(active !== undefined && { trailingActive: active }) } : p));
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['positions-live'], context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['positions-live'] });
    },
  });

  const reviewWithAI = useMutation({
    mutationFn: (positionId: string) => api.post(`/ai/review/position/${positionId}`, {}),
    onSuccess: (res, positionId) => {
      setAiReview({ positionId, text: res.data.ai_review, pnl: res.data.pnl ?? null });
    },
  });

  const continuationAdvice = useMutation({
    mutationFn: async (positionId: string) =>
      (await api.post(`/positions/${positionId}/continuation-advice`, {})).data,
    onSuccess: (data, positionId) => {
      setContinuation(prev => ({ ...prev, [positionId]: data }));
    },
  });

  const confirmPosition = useMutation({
    mutationFn: ({ positionId, fillPrice }: { positionId: string; fillPrice?: number }) =>
      api.post('/execution/confirm', { positionId, fillPrice }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positions-live'] });
      qc.invalidateQueries({ queryKey: ['positions-summary'] });
    },
  });

  const openFromSignal = useMutation({
    mutationFn: (signalId: string) => api.post(`/positions/from-signal/${signalId}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positions-summary'] });
      qc.invalidateQueries({ queryKey: ['positions-live'] });
      qc.invalidateQueries({ queryKey: ['portfolios'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!portfolio) return;
    const entry = parseFloat(form.entryPrice);
    const qty   = parseFloat(form.quantity);
    const cost  = entry * qty;
    const avail = parseFloat(portfolio.currentCapital);
    if (cost > avail) {
      setFormError(`Capital insuffisant : coût estimé $${cost.toLocaleString('en-US', { maximumFractionDigits: 2 })} > disponible $${avail.toLocaleString('en-US', { maximumFractionDigits: 2 })}. Réduisez la quantité ou utilisez le Risk Engine.`);
      return;
    }
    openPosition.mutate({
      portfolioId: portfolio.id,
      assetSymbol: form.assetSymbol,
      direction: form.direction,
      entryPrice: entry,
      quantity: qty,
      stopLoss: form.stopLoss ? parseFloat(form.stopLoss) : undefined,
      takeProfit: form.takeProfit ? parseFloat(form.takeProfit) : undefined,
      trailingMethod: form.trailingMethod,
      trailingActive: form.trailingActive,
    });
  };

  const capital = portfolio ? parseFloat(portfolio.currentCapital) : 0;
  const initial = portfolio ? parseFloat(portfolio.initialCapital) : 0;
  const totalPnl = summary?.totalPnl ?? 0;
  const pnlPct = initial > 0 ? ((totalPnl / initial) * 100).toFixed(2) : '0.00';

  const unrealizedTotal = livePositions?.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0) ?? 0;

  return (
    <AppLayout title="Portfolio">
      <div className="space-y-5">
        {loadingPortfolio ? (
          <PageSkeleton statCards={4} tableRows={5} />
        ) : (
        <>

        {errorPortfolio && <ErrorBox message="Impossible de charger le portfolio." onRetry={() => refetchPortfolio()} />}
        {errorSummary  && <ErrorBox message="Impossible de charger les positions." onRetry={() => refetchSummary()} />}
        {openPosition.isError   && <ErrorBox message={(openPosition.error as any)?.response?.data?.message ?? "Erreur ouverture."} />}
        {closePosition.isError  && <ErrorBox message={(closePosition.error as any)?.response?.data?.message ?? "Erreur clôture."} />}
        {updateTrailingStop.isError && <ErrorBox message={(updateTrailingStop.error as any)?.response?.data?.message ?? "Erreur mise à jour trailing stop."} />}
        {openFromSignal.isError && <ErrorBox message={(openFromSignal.error as any)?.response?.data?.message ?? "Erreur paper trading."} />}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Capital disponible', value: `$${capital.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
            { label: 'P&L réalisé', value: <span><PnlBadge value={totalPnl} /> <span className="text-xs text-gray-500">({pnlPct}%)</span></span> },
            { label: 'PnL non réalisé', value: <span className={`font-mono font-bold ${unrealizedTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{unrealizedTotal >= 0 ? '+' : ''}${unrealizedTotal.toFixed(2)}</span> },
            { label: 'Win Rate', value: loadingSummary ? '…' : (summary?.winRate ? `${summary.winRate.toFixed(1)}%` : '—') },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <div className="text-xl font-bold text-white">{loadingPortfolio ? <span className="text-gray-600">…</span> : s.value}</div>
            </div>
          ))}
        </div>

        {/* Header + onglets */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
            <button onClick={() => setTab('open')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${tab === 'open' ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
              <Activity className="w-3.5 h-3.5" />Ouvertes ({livePositions?.length ?? summary?.open ?? 0})
            </button>
            <button onClick={() => setTab('history')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${tab === 'history' ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
              <History className="w-3.5 h-3.5" />Historique ({summary?.closed ?? 0})
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { refetchLive(); refetchSummary(); }}
              className="p-2 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold rounded-lg text-sm transition-colors">
              <Plus className="w-4 h-4" />{showForm ? 'Annuler' : 'Nouvelle position'}
            </button>
          </div>
        </div>

        {/* Paper Trading depuis signal */}
        {activeSignals.length > 0 && tab === 'open' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Paper Trading — signaux actifs</span>
              <span className="text-xs text-gray-500">1% risque, sizing automatique</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeSignals.slice(0, 5).map(s => (
                <button key={s.id}
                  disabled={openFromSignal.isPending}
                  onClick={() => openFromSignal.mutate(s.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                    s.signal === 'BUY'
                      ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/20'
                      : 'bg-red-400/10 text-red-400 border-red-400/20 hover:bg-red-400/20'
                  }`}>
                  {s.signal === 'BUY' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {s.signal} {s.asset?.symbol} · {Math.round(s.confidence)}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Formulaire manuel */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Ouvrir une position manuellement</h3>
              {form.entryPrice && form.quantity && (
                <span className="text-xs text-gray-400">
                  Coût estimé : <span className={`font-mono font-semibold ${
                    parseFloat(form.entryPrice) * parseFloat(form.quantity) > parseFloat(portfolio?.currentCapital ?? '0')
                      ? 'text-red-400' : 'text-white'
                  }`}>${(parseFloat(form.entryPrice) * parseFloat(form.quantity)).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  {' / '}${parseFloat(portfolio?.currentCapital ?? '0').toLocaleString('en-US', { maximumFractionDigits: 2 })} dispo
                </span>
              )}
            </div>
            {formError && <ErrorBox message={formError} />}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Actif</label>
                <select value={form.assetSymbol} onChange={e => setForm(v => ({ ...v, assetSymbol: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500">
                  {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Direction</label>
                <select value={form.direction} onChange={e => setForm(v => ({ ...v, direction: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500">
                  <option>BUY</option><option>SELL</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Risque %</label>
                <input type="number" step="0.1" min="0.1" max="5" value={riskPct}
                  onChange={e => setRiskPct(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500" />
              </div>
              {[
                { label: "Prix d'entrée", key: 'entryPrice', required: true },
                { label: 'Stop Loss',     key: 'stopLoss' },
                { label: 'Take Profit',   key: 'takeProfit' },
                { label: 'Quantité',      key: 'quantity', required: true },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{f.label}</label>
                  <input type="number" step="any" required={f.required}
                    value={(form as any)[f.key]}
                    onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Trailing</label>
                <select value={form.trailingMethod}
                  onChange={e => setForm(v => ({ ...v, trailingMethod: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500">
                  <option value="atr">ATR</option>
                  <option value="swing">Swing</option>
                  <option value="ema">EMA</option>
                  <option value="chandelier">Chandelier</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input id="trailingActive" type="checkbox" checked={form.trailingActive}
                  onChange={e => setForm(v => ({ ...v, trailingActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500" />
                <label htmlFor="trailingActive" className="text-sm text-gray-300">Activer trailing stop</label>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button type="button" onClick={calcRisk} disabled={calcLoading || !form.entryPrice || !form.stopLoss}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 border border-gray-700 text-gray-300 text-sm rounded-lg transition-colors">
                  {calcLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                  Risk Engine
                </button>
                {riskCalc && (
                  <div className="flex gap-3 text-xs">
                    <span className="text-gray-400">Size: <span className="text-white font-mono">{riskCalc.position_size}</span></span>
                    <span className="text-gray-400">R/R: <span className="text-yellow-400 font-mono">{riskCalc.risk_reward}x</span></span>
                  </div>
                )}
              </div>
              <button type="submit" disabled={openPosition.isPending}
                className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                {openPosition.isPending && <RefreshCw className="w-4 h-4 animate-spin" />}
                Confirmer
              </button>
            </div>
          </form>
        )}

        {/* Onglet OUVERTES — avec PnL live */}
        {tab === 'open' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800/50">
                    {['Actif', 'Dir.', 'Entrée', 'Prix live', 'PnL live', 'SL', 'TP', 'Trailing', 'Conseil', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {!livePositions && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-600">
                      <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Chargement prix live…
                    </td></tr>
                  )}
                  {livePositions?.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-600">
                        <Activity className="w-8 h-8" />
                        <p>Aucune position ouverte</p>
                      </div>
                    </td></tr>
                  )}
                  {livePositions?.map((p: LivePosition) => {
                    const entry     = parseFloat(p.entryPrice);
                    const sl        = p.stopLoss   ? parseFloat(p.stopLoss)   : null;
                    const tp        = p.takeProfit ? parseFloat(p.takeProfit) : null;
                    const tsl       = p.trailingStop ? parseFloat(p.trailingStop) : null;
                    const live      = p.livePrice;
                    const upnl      = p.unrealizedPnl;
                    const upnlPct   = p.unrealizedPct;
                    const progress  = sl && tp && live
                      ? Math.max(0, Math.min(100, ((live - sl) / (tp - sl)) * 100))
                      : null;
                    return (
                      <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold">{p.asset?.symbol}</span>
                            {p.status === 'PENDING' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-500/10 text-orange-400 border border-orange-500/30">
                                PENDING
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {p.direction === 'BUY'
                            ? <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><TrendingUp className="w-3 h-3" />BUY</span>
                            : <span className="text-red-400 text-xs font-bold flex items-center gap-1"><TrendingDown className="w-3 h-3" />SELL</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-300">${entry.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 font-mono text-white font-semibold">
                          {live ? `$${live.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-gray-600">…</span>}
                        </td>
                        <td className="px-4 py-3">
                          {upnl !== null ? (
                            <div>
                              <span className={`font-mono font-semibold ${upnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {upnl >= 0 ? '+' : ''}${upnl.toFixed(2)}
                              </span>
                              <span className={`text-xs ml-1 ${upnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                ({upnlPct! >= 0 ? '+' : ''}{upnlPct?.toFixed(2)}%)
                              </span>
                              {progress !== null && (
                                <div className="mt-1 h-1 w-20 bg-gray-700 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all ${upnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                    style={{ width: `${p.direction === 'BUY' ? progress : 100 - progress}%` }} />
                                </div>
                              )}
                            </div>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-red-400 text-xs">
                          {sl ? `$${sl.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-400 text-xs">
                          {tp ? `$${tp.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5 min-w-[120px]">
                            <span className="font-mono text-yellow-400 text-xs">
                              {tsl ? `$${tsl.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                            </span>
                            <select
                              disabled={updateTrailingStop.isPending}
                              value={p.trailingMethod || 'atr'}
                              onChange={e => updateTrailingStop.mutate({ id: p.id, method: e.target.value })}
                              className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                            >
                              <option value="atr">ATR</option>
                              <option value="swing">Swing</option>
                              <option value="ema">EMA</option>
                              <option value="chandelier">Chandelier</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                              <input type="checkbox" checked={p.trailingActive !== false}
                                disabled={updateTrailingStop.isPending}
                                onChange={e => updateTrailingStop.mutate({ id: p.id, active: e.target.checked })}
                                className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500 disabled:opacity-50" />
                              Actif
                            </label>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 min-w-[140px]">
                            {continuation[p.id] && (
                              <div className="text-[10px] leading-tight">
                                <span className={`font-medium ${
                                  continuation[p.id].action === 'ACTIVATE_TRAILING' ? 'text-emerald-400' :
                                  continuation[p.id].action === 'EXHAUSTED' ? 'text-red-400' :
                                  continuation[p.id].action === 'MOVE_TO_BREAK_EVEN' ? 'text-yellow-400' :
                                  'text-gray-400'
                                }`}>
                                  {continuation[p.id].action.replace(/_/g, ' ')}
                                </span>
                                <p className="text-gray-500 mt-0.5">Score {continuation[p.id].score}</p>
                              </div>
                            )}
                            <button
                              onClick={() => continuationAdvice.mutate(p.id)}
                              disabled={continuationAdvice.isPending}
                              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-50 transition-colors w-fit"
                            >
                              <Target className="w-3 h-3" />
                              {continuation[p.id] ? 'Rafraîchir' : 'Conseil'}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {p.status === 'PENDING' ? (
                              <button
                                disabled={confirmPosition.isPending}
                                onClick={() => confirmPosition.mutate({ positionId: p.id, fillPrice: live ?? undefined })}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                              >
                                <Zap className="w-3 h-3" />
                                Confirmer
                              </button>
                            ) : (
                              <>
                                <input type="number" step="any" placeholder="Exit"
                                  value={closePrice[p.id] ?? ''}
                                  onChange={e => setClosePrice(v => ({ ...v, [p.id]: e.target.value }))}
                                  className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-red-500" />
                                <button
                                  disabled={!closePrice[p.id] || closePosition.isPending}
                                  onClick={() => closePosition.mutate({ id: p.id, exitPrice: parseFloat(closePrice[p.id]) })}
                                  className="p-1.5 text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors rounded hover:bg-red-400/10">
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden p-4 space-y-3">
              {!livePositions && (
                <div className="text-center text-gray-600 py-8">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Chargement prix live…
                </div>
              )}
              {livePositions?.length === 0 && (
                <div className="flex flex-col items-center gap-2 text-gray-600 py-8">
                  <Activity className="w-8 h-8" />
                  <p>Aucune position ouverte</p>
                </div>
              )}
              {livePositions?.map((p: LivePosition) => {
                const entry     = parseFloat(p.entryPrice);
                const sl        = p.stopLoss   ? parseFloat(p.stopLoss)   : null;
                const tp        = p.takeProfit ? parseFloat(p.takeProfit) : null;
                const tsl       = p.trailingStop ? parseFloat(p.trailingStop) : null;
                const live      = p.livePrice;
                const upnl      = p.unrealizedPnl;
                const upnlPct   = p.unrealizedPct;
                const progress  = sl && tp && live
                  ? Math.max(0, Math.min(100, ((live - sl) / (tp - sl)) * 100))
                  : null;
                return (
                  <div key={p.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold">{p.asset?.symbol}</span>
                        {p.status === 'PENDING' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-orange-500/10 text-orange-400 border border-orange-500/30">
                            PENDING
                          </span>
                        )}
                        {p.direction === 'BUY'
                          ? <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><TrendingUp className="w-3 h-3" />BUY</span>
                          : <span className="text-red-400 text-xs font-bold flex items-center gap-1"><TrendingDown className="w-3 h-3" />SELL</span>}
                        {p.trailingActive !== false && tsl !== null && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            TRAIL {p.trailingMethod?.toUpperCase()} ${tsl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      {p.status === 'PENDING' ? (
                        <button
                          disabled={confirmPosition.isPending}
                          onClick={() => confirmPosition.mutate({ positionId: p.id, fillPrice: live ?? undefined })}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                        >
                          <Zap className="w-3 h-3" />
                          Confirmer
                        </button>
                      ) : (
                        <button
                          disabled={!closePrice[p.id] || closePosition.isPending}
                          onClick={() => closePosition.mutate({ id: p.id, exitPrice: parseFloat(closePrice[p.id]) })}
                          className="p-1.5 text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors rounded hover:bg-red-400/10">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Entrée</p>
                        <p className="font-mono text-gray-300">${entry.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Prix live</p>
                        <p className="font-mono text-white font-semibold">{live ? `$${live.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '…'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">SL</p>
                        <p className="font-mono text-red-400">{sl ? `$${sl.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">TP</p>
                        <p className="font-mono text-emerald-400">{tp ? `$${tp.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Trailing</p>
                        <p className="font-mono text-yellow-400">{tsl ? `$${tsl.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-2 border-t border-gray-700/50">
                      <select
                        disabled={updateTrailingStop.isPending}
                        value={p.trailingMethod || 'atr'}
                        onChange={e => updateTrailingStop.mutate({ id: p.id, method: e.target.value })}
                        className="px-2 py-1 bg-gray-900 border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                      >
                        <option value="atr">ATR</option>
                        <option value="swing">Swing</option>
                        <option value="ema">EMA</option>
                        <option value="chandelier">Chandelier</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                        <input type="checkbox" checked={p.trailingActive !== false}
                          disabled={updateTrailingStop.isPending}
                          onChange={e => updateTrailingStop.mutate({ id: p.id, active: e.target.checked })}
                          className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-50" />
                        Trailing actif
                      </label>
                    </div>
                    {upnl !== null && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className={`font-mono font-semibold ${upnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {upnl >= 0 ? '+' : ''}${upnl.toFixed(2)}
                          </span>
                          <span className={`text-xs ${upnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            ({upnlPct! >= 0 ? '+' : ''}{upnlPct?.toFixed(2)}%)
                          </span>
                        </div>
                        {progress !== null && (
                          <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${upnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                              style={{ width: `${p.direction === 'BUY' ? progress : 100 - progress}%` }} />
                          </div>
                        )}
                      </div>
                    )}
                    <input type="number" step="any" placeholder="Prix de clôture"
                      value={closePrice[p.id] ?? ''}
                      onChange={e => setClosePrice(v => ({ ...v, [p.id]: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-red-500" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Onglet HISTORIQUE */}
        {tab === 'history' && (() => {
          const closed = summary?.positions?.filter((p: Position) => p.status === 'CLOSED') ?? [];
          const totalPages = Math.ceil(closed.length / HIST_PAGE_SIZE);
          const paginated  = closed.slice(histPage * HIST_PAGE_SIZE, (histPage + 1) * HIST_PAGE_SIZE);
          return (
          <div className="space-y-3">
            {closed.length > HIST_PAGE_SIZE && (
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-500">
                  {histPage * HIST_PAGE_SIZE + 1}–{Math.min((histPage + 1) * HIST_PAGE_SIZE, closed.length)} sur {closed.length} trades
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setHistPage(p => Math.max(0, p - 1))} disabled={histPage === 0}
                    className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-400 px-2">{histPage + 1} / {totalPages}</span>
                  <button onClick={() => setHistPage(p => Math.min(totalPages - 1, p + 1))} disabled={(histPage + 1) * HIST_PAGE_SIZE >= closed.length}
                    className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800/50">
                    {['Actif', 'Dir.', 'Entrée', 'Sortie', 'PnL $', 'PnL %', 'Date', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {paginated.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-600">
                      <History className="w-8 h-8 inline mb-2 block mx-auto" />Aucun trade clôturé
                    </td></tr>
                  )}
                  {paginated.map((p: Position) => {
                    const pnl = parseFloat(String(p.pnl ?? 0));
                    const pct = parseFloat(String(p.pnlPercent ?? 0));
                    return (
                      <tr key={p.id} className={`hover:bg-gray-800/30 ${pnl > 0 ? 'border-l-2 border-l-emerald-500/30' : 'border-l-2 border-l-red-500/30'}`}>
                        <td className="px-4 py-3 text-white font-semibold">{p.asset?.symbol}</td>
                        <td className="px-4 py-3">
                          {p.direction === 'BUY'
                            ? <span className="text-emerald-400 text-xs font-bold">BUY</span>
                            : <span className="text-red-400 text-xs font-bold">SELL</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-400">${parseFloat(p.entryPrice).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-gray-300">${p.exitPrice ? parseFloat(String(p.exitPrice)).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3"><PnlBadge value={pnl} /></td>
                        <td className={`px-4 py-3 font-mono text-xs ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">
                          {p.closedAt ? new Date(p.closedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => reviewWithAI.mutate(p.id)}
                            disabled={reviewWithAI.isPending}
                            title="Analyse IA du trade"
                            className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 border border-purple-400/20 rounded-lg hover:bg-purple-400/10 disabled:opacity-40 transition-colors">
                            {reviewWithAI.isPending && reviewWithAI.variables === p.id
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <Bot className="w-3 h-3" />}
                            IA
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden p-4 space-y-3">
              {paginated.length === 0 && (
                <div className="flex flex-col items-center gap-2 text-gray-600 py-8">
                  <History className="w-8 h-8" />
                  <p>Aucun trade clôturé</p>
                </div>
              )}
              {paginated.map((p: Position) => {
                const pnl = parseFloat(String(p.pnl ?? 0));
                const pct = parseFloat(String(p.pnlPercent ?? 0));
                return (
                  <div key={p.id} className={`bg-gray-800/50 border rounded-xl p-4 space-y-2 ${pnl > 0 ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{p.asset?.symbol}</span>
                        {p.direction === 'BUY'
                          ? <span className="text-emerald-400 text-xs font-bold">BUY</span>
                          : <span className="text-red-400 text-xs font-bold">SELL</span>}
                      </div>
                      <span className="text-gray-600 text-xs">
                        {p.closedAt ? new Date(p.closedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-500">Entrée</p>
                        <p className="font-mono text-gray-400">${parseFloat(p.entryPrice).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Sortie</p>
                        <p className="font-mono text-gray-300">${p.exitPrice ? parseFloat(String(p.exitPrice)).toLocaleString() : '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                      <PnlBadge value={pnl} />
                      <span className={`font-mono text-xs ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                      <button
                        onClick={() => reviewWithAI.mutate(p.id)}
                        disabled={reviewWithAI.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 border border-purple-400/20 rounded-lg hover:bg-purple-400/10 disabled:opacity-40 transition-colors">
                        {reviewWithAI.isPending && reviewWithAI.variables === p.id
                          ? <RefreshCw className="w-3 h-3 animate-spin" />
                          : <Bot className="w-3 h-3" />}
                        Analyse IA
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
          );
        })()}
        </>
        )}
      </div>

      {/* Modal analyse IA */}
      {aiReview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setAiReview(null)}>
          <div className="bg-gray-900 border border-purple-500/30 rounded-2xl max-w-2xl w-full flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-purple-400" />
                <span className="text-white font-semibold">Analyse IA du trade</span>
              </div>
              <button onClick={() => setAiReview(null)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* PnL badge */}
            {aiReview.pnl !== null && (
              <div className={`mx-6 mt-4 shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold ${
                aiReview.pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}>
                {aiReview.pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                PnL : {aiReview.pnl >= 0 ? '+' : ''}${aiReview.pnl.toFixed(2)}
              </div>
            )}
            {/* Contenu scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <pre className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap font-sans break-words">{aiReview.text}</pre>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-800 shrink-0">
              <button onClick={() => setAiReview(null)}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg text-sm transition-colors">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
