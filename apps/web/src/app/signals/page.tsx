'use client';
import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Zap, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Scale, Brain, UserCircle, AlertTriangle, Activity, Radar } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SignalCard } from '@/components/signals/SignalCard';
import { SkeletonSignalCard } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { useTradingStore } from '@/store/trading.store';
import { useToast } from '@/hooks/useToast';

const SCAN_SYMBOLS_GROUPS = [
  { label: 'Crypto',      symbols: ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AVAX/USDT','ADA/USDT','DOT/USDT','LINK/USDT','MATIC/USDT','ATOM/USDT','LTC/USDT','XRP/USDT','DOGE/USDT','TRX/USDT','TON/USDT','PAXG/USDT'] },
  { label: 'Forex',       symbols: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD'] },
  { label: 'Matières',    symbols: ['XAU/USD','XAG/USD','WTI/USD','BRENT/USD'] },
  { label: 'Deriv Vol',   symbols: ['V10','V25','V50','V75','V100'] },
  { label: 'Deriv B&C',   symbols: ['BOOM300','BOOM500','BOOM1000','CRASH300','CRASH500','CRASH1000'] },
  { label: 'Deriv Jump',  symbols: ['JUMP10','JUMP25','JUMP50','JUMP75','JUMP100'] },
  { label: 'BRVM',        symbols: ['ONTBF','SGBF','BOABF','ETIT','SIVC','PALC','SOGC','SNTS','CIEC','NSIC','ORGT','BICC','CBIBF','ABJC','STAC'] },
  { label: 'Actions US',  symbols: ['AAPL/USD','TSLA/USD','MSFT/USD','NVDA/USD','AMZN/USD','META/USD','GOOGL/USD','NFLX/USD','AMD/USD','INTC/USD','JPM/USD','BAC/USD','SP500/USD','NASDAQ/USD','DOW/USD','VIX/USD'] },
];
const ALL_SYMBOLS = SCAN_SYMBOLS_GROUPS.flatMap(g => g.symbols);
const TIMEFRAMES  = ['15m', '1h', '4h', '1d'];

const PAGE_SIZE = 12;

const LS_SYMBOLS = 'scan_selected_symbols';
const LS_TF      = 'scan_timeframe';
const LS_PROFILE = 'trading_profile';
const LS_MARKET  = 'scan_market';

const PROFILES = [
  { key: 'all', label: 'Tous' },
  { key: 'conservative', label: 'Conservateur' },
  { key: 'moderate', label: 'Modéré' },
  { key: 'aggressive', label: 'Agressif' },
];

const MARKETS = [
  { key: 'all', label: 'Tous' },
  { key: 'CRYPTO', label: 'Crypto' },
  { key: 'FOREX', label: 'Forex' },
  { key: 'SYNTHETIC', label: 'Synthétique' },
  { key: 'BRVM', label: 'BRVM' },
  { key: 'STOCK', label: 'Actions US' },
];

function inferMarket(symbol?: string): string {
  if (!symbol) return 'UNKNOWN';
  if (symbol.endsWith('/USDT')) return 'CRYPTO';
  if (/^(VIX|JUMP|BOOM|CRASH)\d+/i.test(symbol)) return 'SYNTHETIC';
  if (symbol.includes('/')) {
    if (symbol.endsWith('/USD') && !['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD','XAU/USD','XAG/USD','WTI/USD','BRENT/USD'].includes(symbol)) return 'STOCK';
    return 'FOREX';
  }
  return 'BRVM';
}

export default function SignalsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prices        = useTradingStore(s => s.prices);
  const signals       = useTradingStore(s => s.signals);
  const isLoading     = useTradingStore(s => s.signalsLoading);
  const fetchSignals  = useTradingStore(s => s.fetchSignals);
  const [tf, setTf] = useState(() => {
    if (typeof window === 'undefined') return '1h';
    return localStorage.getItem(LS_TF) ?? '1h';
  });
  const [page, setPage] = useState(0);
  const [aiExplain, setAiExplain] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi]     = useState<Record<string, boolean>>({});
  const [profileFilter, setProfileFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return localStorage.getItem(LS_PROFILE) ?? 'all';
  });
  const [marketFilter, setMarketFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'all';
    return localStorage.getItem(LS_MARKET) ?? 'all';
  });
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ALL_SYMBOLS;
    try {
      const saved = localStorage.getItem(LS_SYMBOLS);
      return saved ? JSON.parse(saved) : ALL_SYMBOLS;
    } catch { return ALL_SYMBOLS; }
  });
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'signals' | 'scanner'>('signals');

  // Persister sélection dans localStorage
  useEffect(() => { localStorage.setItem(LS_SYMBOLS, JSON.stringify(selectedSymbols)); }, [selectedSymbols]);
  useEffect(() => { localStorage.setItem(LS_TF, tf); }, [tf]);
  useEffect(() => { localStorage.setItem(LS_PROFILE, profileFilter); }, [profileFilter]);
  useEffect(() => { localStorage.setItem(LS_MARKET, marketFilter); }, [marketFilter]);

  const toggleSymbol = (s: string) =>
    setSelectedSymbols(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const toggleGroup = (groupSymbols: string[]) => {
    const allSelected = groupSymbols.every(s => selectedSymbols.includes(s));
    if (allSelected) {
      setSelectedSymbols(prev => prev.filter(s => !groupSymbols.includes(s)));
    } else {
      setSelectedSymbols(prev => [...new Set([...prev, ...groupSymbols])]);
    }
  };
  const explainSignal = async (signalId: string) => {
    if (aiExplain[signalId]) {
      setAiExplain(v => { const n = {...v}; delete n[signalId]; return n; });
      return;
    }
    setLoadingAi(v => ({ ...v, [signalId]: true }));
    try {
      const { data } = await api.post(`/ai/explain/signal/${signalId}`, {});
      setAiExplain(v => ({ ...v, [signalId]: data.ai_explanation }));
    } catch {
      setAiExplain(v => ({ ...v, [signalId]: 'Erreur lors de la génération de l\'explication.' }));
    } finally {
      setLoadingAi(v => ({ ...v, [signalId]: false }));
    }
  };

  const scan = useMutation({
    mutationFn: () => api.post('/signals/scan', { symbols: selectedSymbols.length ? selectedSymbols : ALL_SYMBOLS, timeframe: tf }),
    onSuccess: () => {
      setPage(0);
      fetchSignals(true); // force re-fetch store après scan
    },
  });

  const engineResponse = (scan.data?.data as any) ?? null;
  const portfolioRisk = engineResponse?.portfolio_risk ?? null;
  const dataGaps = Array.isArray(engineResponse?.data_gaps) ? engineResponse.data_gaps : [];

  const filteredSignals = signals?.filter((s: any) => {
    const profileOk = profileFilter === 'all' || s.profileSuitability?.includes(profileFilter);
    const marketOk = marketFilter === 'all' || inferMarket(s.asset?.symbol) === marketFilter;
    return profileOk && marketOk;
  }) ?? [];

  const { data: predictorStatus, isFetching: predictorStatusLoading } = useQuery({
    queryKey: ['signal-predictor-status'],
    queryFn: async () => (await api.get('/signals/predictor/status')).data,
    staleTime: 60_000,
  });

  const { data: alertStats } = useQuery({
    queryKey: ['alert-stats'],
    queryFn: async () => (await api.get('/signals/alerts/stats')).data,
    staleTime: 60_000,
  });

  const { data: pollingConfig } = useQuery({
    queryKey: ['polling-config'],
    queryFn: async () => (await api.get('/system/polling-config/public')).data,
    staleTime: 60_000,
  });

  const scanPollingEnabled = pollingConfig?.scanPollingEnabled ?? true;
  const scanPollingInterval = pollingConfig?.scanPollingInterval ?? 5_000;

  const { data: scanHistoryData, isFetching: scanHistoryLoading } = useQuery({
    queryKey: ['scan-history-realtime'],
    queryFn: async () => (await api.get('/signals/scan-history', { params: { limit: 100 } })).data,
    refetchInterval: scanPollingEnabled ? scanPollingInterval : false,
    staleTime: 3_000,
  });

  const trainPredictor = useMutation({
    mutationFn: async () => {
      const params: Record<string, string> = {};
      if (marketFilter !== 'all') params.market = marketFilter;
      if (tf) params.timeframe = tf;
      const res = await api.post('/signals/predictor/train', undefined, { params });
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['signal-predictor-status'] });
      toast(`Accuracy ${(data?.accuracy ? (data.accuracy * 100).toFixed(1) : '—')}% · ${data?.samples ?? '—'} samples`, {
        title: 'SignalScorer entraîné',
        type: 'success',
      });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message ?? error?.message ?? 'Erreur inconnue';
      toast(message, { title: 'Échec entraînement SignalScorer', type: 'error' });
    },
  });

  return (
    <AppLayout title="Signaux">
      <div className="space-y-5">
        {/* Tab navigation */}
        <div className="flex bg-gray-800 rounded-lg p-1 gap-0.5 w-fit">
          <button onClick={() => setActiveTab('signals')}
            className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'signals' ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white'}`}>
            <TrendingUp className="w-4 h-4" />Signaux
          </button>
          <button onClick={() => setActiveTab('scanner')}
            className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${activeTab === 'scanner' ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white'}`}>
            <Radar className="w-4 h-4" />Scanner
            {scanHistoryData?.entries?.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {scanHistoryData.entries.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'scanner' ? (
          <ScannerView
            entries={scanHistoryData?.entries ?? []}
            loading={scanHistoryLoading}
            pollingEnabled={scanPollingEnabled}
            pollingInterval={scanPollingInterval}
          />
        ) : (
        <>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <UserCircle className="w-4 h-4 text-indigo-400" />
              <p className="text-gray-400 text-sm">{filteredSignals.length} signaux actifs</p>
              {alertStats && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                  {alertStats.sentToday}/{alertStats.maxDaily} alertes
                </span>
              )}
            </div>
            {filteredSignals && filteredSignals.length > PAGE_SIZE && <p className="text-gray-600 text-xs">Page {page + 1}/{Math.ceil(filteredSignals.length / PAGE_SIZE)}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex bg-gray-800 rounded-lg p-1 gap-0.5">
              {TIMEFRAMES.map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`px-2.5 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${tf === t ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="flex bg-gray-800 rounded-lg p-1 gap-0.5">
              {PROFILES.map(p => (
                <button key={p.key} onClick={() => { setProfileFilter(p.key); setPage(0); }}
                  className={`px-2.5 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${profileFilter === p.key ? 'bg-indigo-500 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex bg-gray-800 rounded-lg p-1 gap-0.5">
              {MARKETS.map(m => (
                <button key={m.key} onClick={() => { setMarketFilter(m.key); setPage(0); }}
                  className={`px-2.5 py-1 rounded text-xs sm:text-sm font-medium transition-colors ${marketFilter === m.key ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <button onClick={() => scan.mutate()}
              disabled={scan.isPending || selectedSymbols.length === 0}
              title={selectedSymbols.length === 0 ? 'Sélectionnez au moins un actif' : undefined}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs sm:text-sm transition-colors">
              {scan.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin"/>Scan...</>
                : <><Zap className="w-4 h-4"/>Scanner {selectedSymbols.length} actif{selectedSymbols.length > 1 ? 's' : ''}</>}
            </button>
          </div>
        </div>

        {/* Calibration auto des poids de features */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">Calibration des features</span>
              {predictorStatus?.trained && (
                <span className="text-xs text-gray-400">
                  Accuracy {(predictorStatus.accuracy * 100).toFixed(1)}% · {predictorStatus.samples ?? '—'} échantillons
                  {predictorStatus.updatedAt && ` · MAJ ${new Date(predictorStatus.updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </span>
              )}
              {predictorStatusLoading && <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />}
            </div>
            <button
              onClick={() => trainPredictor.mutate()}
              disabled={trainPredictor.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {trainPredictor.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
              Entraîner
            </button>
          </div>
          {predictorStatus?.trained && predictorStatus.topFeatures?.length > 0 && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
              {predictorStatus.topFeatures.map(([feature, weight]: [string, number]) => (
                <div key={feature} className="flex items-center justify-between bg-gray-950 rounded px-2 py-1">
                  <span className="text-gray-400 truncate" title={feature}>{feature}</span>
                  <div className="flex items-center gap-1 w-16">
                    <div className="h-1.5 flex-1 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400" style={{ width: `${Math.round((weight ?? 0) * 100)}%` }} />
                    </div>
                    <span className="text-gray-300 w-8 text-right">{(weight ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sélecteur d'actifs */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <button onClick={() => setShowSymbolPicker(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-800/50 transition-colors rounded-xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-gray-400 text-sm">Actifs :</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {selectedSymbols.length} / {ALL_SYMBOLS.length}
              </span>
              {SCAN_SYMBOLS_GROUPS.map(group => {
                const cnt = group.symbols.filter(s => selectedSymbols.includes(s)).length;
                if (cnt === 0) return null;
                return <span key={group.label} className="hidden sm:inline text-xs text-gray-500">{group.label} <span className="text-gray-400">{cnt}</span></span>;
              })}
            </div>
            {showSymbolPicker ? <ChevronUp className="w-4 h-4 text-gray-500"/> : <ChevronDown className="w-4 h-4 text-gray-500"/>}
          </button>
          {showSymbolPicker && (
            <div className="px-4 pb-4 space-y-3 border-t border-gray-800">
              {SCAN_SYMBOLS_GROUPS.map(group => {
                const groupSelected = group.symbols.filter(s => selectedSymbols.includes(s)).length;
                const allGroupSelected = groupSelected === group.symbols.length;
                return (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 pt-3 mb-2">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">{group.label}</p>
                      <span className="text-xs text-gray-600">{groupSelected}/{group.symbols.length}</span>
                      <button onClick={() => toggleGroup(group.symbols)}
                        className={`ml-auto text-xs px-2 py-0.5 rounded border transition-colors ${
                          allGroupSelected
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                        }`}>
                        {allGroupSelected ? 'Tout désélect.' : 'Tout sélect.'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.symbols.map(sym => (
                        <button key={sym} onClick={() => toggleSymbol(sym)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            selectedSymbols.includes(sym)
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                          }`}>{sym.replace('/USDT','').replace('/USD','')}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-2 pt-2 border-t border-gray-800">
                <button onClick={() => setSelectedSymbols(ALL_SYMBOLS)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors">✓ Tout</button>
                <button onClick={() => setSelectedSymbols([])} className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors">✗ Aucun</button>
                <button onClick={() => setShowSymbolPicker(false)} className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 transition-colors">Fermer</button>
              </div>
            </div>
          )}
        </div>

        {scan.isSuccess && (
          <div className="space-y-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
              ✅ {Array.isArray(scan.data?.data) ? scan.data.data.length : 0} nouveau(x) signal(aux) générés
            </div>
            {dataGaps.length > 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-200">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" />
                  {dataGaps.length} actif{dataGaps.length > 1 ? 's' : ''} sans données complètes
                </div>
                <p className="text-xs text-amber-300 mt-1">
                  Certaines sources (Binance, TwelveData, etc.) n&apos;ont pas répondu. Vérifie que l&apos;engine a accès au réseau,
                  sinon les trailing stop ou analyses avancées peuvent échouer.
                </p>
                <div className="mt-2 space-y-1 text-xs">
                  {dataGaps.slice(0, 5).map((gap: any) => (
                    <div key={`${gap.symbol}-${gap.providers?.join?.('-') ?? 'na'}`} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-amber-100">{gap.symbol}</span>
                      {Array.isArray(gap.providers) && gap.providers.length > 0 && (
                        <span className="text-amber-300">{gap.providers.join(', ')}</span>
                      )}
                    </div>
                  ))}
                  {dataGaps.length > 5 && (
                    <p className="text-amber-300">+ {dataGaps.length - 5} autre{dataGaps.length - 5 > 1 ? 's' : ''}…</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bloc risque portefeuille */}
        {portfolioRisk && portfolioRisk.alerts?.length > 0 && (
          <div className={`p-4 rounded-xl border space-y-2 ${
            portfolioRisk.risk_level === 'HIGH'   ? 'bg-red-500/10 border-red-500/20'    :
            portfolioRisk.risk_level === 'MEDIUM' ? 'bg-orange-500/10 border-orange-500/20' :
            'bg-yellow-500/10 border-yellow-500/20'
          }`}>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                portfolioRisk.risk_level === 'HIGH'   ? 'bg-red-500/20 text-red-400'    :
                portfolioRisk.risk_level === 'MEDIUM' ? 'bg-orange-500/20 text-orange-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>
                Risque {portfolioRisk.risk_level}
              </span>
              <span className="text-xs text-gray-400">{portfolioRisk.summary}</span>
            </div>
            {portfolioRisk.alerts.map((alert: any, i: number) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`text-xs mt-0.5 ${
                  alert.severity === 'HIGH' ? 'text-red-400' :
                  alert.direction === 'MIXED' ? 'text-yellow-400' : 'text-orange-400'
                }`}>⚠</span>
                <p className="text-xs text-gray-300">{alert.message}</p>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonSignalCard key={i} />)}
          </div>
        )}

        {!isLoading && filteredSignals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
            <TrendingUp className="w-10 h-10 mb-3"/>
            <p className="font-medium">Aucun signal</p>
            <p className="text-sm mt-1">Cliquez sur <strong className="text-gray-400">Scanner</strong> pour lancer l&apos;analyse</p>
          </div>
        )}

        {filteredSignals.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSignals.length)} sur {filteredSignals.length} signaux
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-400 px-2">{page + 1} / {Math.ceil(filteredSignals.length / PAGE_SIZE)}</span>
              <button onClick={() => setPage(p => Math.min(Math.ceil(filteredSignals.length / PAGE_SIZE) - 1, p + 1))} disabled={(page + 1) * PAGE_SIZE >= filteredSignals.length}
                className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredSignals.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((s: any) => (
            <SignalCard
              key={s.id}
              signal={s}
              prices={prices}
              aiExplain={aiExplain[s.id]}
              loadingAi={loadingAi[s.id]}
              onExplain={explainSignal}
            />
          ))}
        </div>
        </>
        )}
      </div>
    </AppLayout>
  );
}

function ScannerView({ entries, loading, pollingEnabled, pollingInterval }: {
  entries: any[];
  loading: boolean;
  pollingEnabled: boolean;
  pollingInterval: number;
}) {
  const signalColors: Record<string, string> = {
    BUY: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    SELL: 'text-red-400 bg-red-500/10 border-red-500/30',
    NEUTRAL: 'text-gray-400 bg-gray-700/30 border-gray-700',
  };

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const ta = new Date(a.scanned_at || 0).getTime();
      const tb = new Date(b.scanned_at || 0).getTime();
      return tb - ta;
    });
  }, [entries]);

  const activeSignals = sorted.filter(e => e.signal === 'BUY' || e.signal === 'SELL');
  const pendingSignals = sorted.filter(e => e.signal_pending);
  const neutralScans = sorted.filter(e => e.signal === 'NEUTRAL' && !e.signal_pending);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-gray-400">
            {pollingEnabled ? `Temps réel — polling ${pollingInterval / 1000}s` : 'Temps réel — polling désactivé'}
          </span>
          {loading && <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />{activeSignals.length} signaux
          </span>
          <span className="flex items-center gap-1 text-yellow-400">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />{pendingSignals.length} en confirmation
          </span>
          <span className="flex items-center gap-1 text-gray-500">
            <span className="w-2 h-2 rounded-full bg-gray-600" />{neutralScans.length} neutres
          </span>
        </div>
      </div>

      {sorted.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
          <Radar className="w-10 h-10 mb-3" />
          <p className="font-medium">Aucun scan récent</p>
          <p className="text-sm mt-1">Les scans apparaîtront ici en temps réel</p>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((entry, i) => {
            const signalColor = signalColors[entry.signal] || signalColors.NEUTRAL;
            const time = entry.scanned_at ? new Date(entry.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            return (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${entry.signal !== 'NEUTRAL' ? 'bg-gray-900' : 'bg-gray-900/50'} border-gray-800`}>
                <div className={`px-2 py-1 rounded text-xs font-bold border ${signalColor} min-w-[60px] text-center`}>
                  {entry.signal}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{entry.symbol}</span>
                    <span className="text-xs text-gray-500">{entry.timeframe}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      {entry.strategy_name || 'Default'}
                    </span>
                    {entry.signal_pending && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 animate-pulse">
                        EN CONFIRMATION
                      </span>
                    )}
                    {entry.confidence > 0 && (
                      <span className={`text-xs font-medium ${entry.confidence >= 70 ? 'text-emerald-400' : entry.confidence >= 50 ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {entry.confidence}%
                      </span>
                    )}
                    {entry.persistence_score > 0 && (
                      <span className="text-xs text-gray-500" title="Persistence score">
                        ⟳ {Math.round(entry.persistence_score)}%
                      </span>
                    )}
                  </div>
                  {entry.explanation && (
                    <p className="text-xs text-gray-400 mt-1 truncate" title={entry.explanation}>{entry.explanation}</p>
                  )}
                </div>
                <span className="text-xs text-gray-600 whitespace-nowrap">{time}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
