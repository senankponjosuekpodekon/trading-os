'use client';
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, Brain, ChevronDown, ChevronUp, Newspaper, ExternalLink, ChevronLeft, ChevronRight, BarChart2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SkeletonSignalCard } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { Signal } from '@/types';
import { useTradingStore } from '@/store/trading.store';

// Mapping symbole interne → clé utilisée dans les prix live WS
// Crypto Binance : clé = BTCUSDT | Forex/Deriv : clé = symbole interne direct
const SYMBOL_TO_PRICE_KEY: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'ADA/USDT': 'ADAUSDT',
  'DOT/USDT': 'DOTUSDT', 'LINK/USDT': 'LINKUSDT', 'MATIC/USDT': 'MATICUSDT',
  'ATOM/USDT': 'ATOMUSDT', 'LTC/USDT': 'LTCUSDT', 'XRP/USDT': 'XRPUSDT',
  'DOGE/USDT': 'DOGEUSDT', 'TRX/USDT': 'TRXUSDT', 'TON/USDT': 'TONUSDT', 'PAXG/USDT': 'PAXGUSDT',
  // Forex, Matières, Deriv → clé = symbole interne (broadcast direct)
  'EUR/USD': 'EUR/USD', 'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY',
  'AUD/USD': 'AUD/USD', 'USD/CHF': 'USD/CHF', 'USD/CAD': 'USD/CAD', 'NZD/USD': 'NZD/USD',
  'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD', 'WTI/USD': 'WTI/USD', 'BRENT/USD': 'BRENT/USD',
  'VIX10/USD': 'VIX10/USD', 'VIX25/USD': 'VIX25/USD', 'VIX50/USD': 'VIX50/USD',
  'VIX75/USD': 'VIX75/USD', 'VIX100/USD': 'VIX100/USD',
  'BOOM300/USD': 'BOOM300/USD', 'BOOM500/USD': 'BOOM500/USD', 'BOOM1000/USD': 'BOOM1000/USD',
  'CRASH300/USD': 'CRASH300/USD', 'CRASH500/USD': 'CRASH500/USD', 'CRASH1000/USD': 'CRASH1000/USD',
  'JUMP10/USD': 'JUMP10/USD', 'JUMP25/USD': 'JUMP25/USD', 'JUMP50/USD': 'JUMP50/USD',
  'JUMP75/USD': 'JUMP75/USD', 'JUMP100/USD': 'JUMP100/USD',
};

const SCAN_SYMBOLS_GROUPS = [
  { label: 'Crypto',      symbols: ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AVAX/USDT','ADA/USDT','DOT/USDT','LINK/USDT','MATIC/USDT','ATOM/USDT','LTC/USDT','XRP/USDT','DOGE/USDT','TRX/USDT','TON/USDT','PAXG/USDT'] },
  { label: 'Forex',       symbols: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD'] },
  { label: 'Matières',    symbols: ['XAU/USD','XAG/USD','WTI/USD','BRENT/USD'] },
  { label: 'Deriv Vol',   symbols: ['VIX10/USD','VIX25/USD','VIX50/USD','VIX75/USD','VIX100/USD'] },
  { label: 'Deriv B&C',   symbols: ['BOOM300/USD','BOOM500/USD','BOOM1000/USD','CRASH300/USD','CRASH500/USD','CRASH1000/USD'] },
  { label: 'Deriv Jump',  symbols: ['JUMP10/USD','JUMP25/USD','JUMP50/USD','JUMP75/USD','JUMP100/USD'] },
  { label: 'BRVM',        symbols: ['ONTBF','SGBF','BOABF','ETIT','SIVC','PALC','SOGC','SNTS','CIEC','NSIC','ORGT','BICC','CBIBF','ABJC','STAC'] },
];
const ALL_SYMBOLS = SCAN_SYMBOLS_GROUPS.flatMap(g => g.symbols);
const TIMEFRAMES  = ['15m', '1h', '4h', '1d'];

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 70 ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
    : value >= 50 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
    : 'text-gray-400 bg-gray-400/10 border-gray-600';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${color}`}>
      {value}%
    </span>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === 'BUY')  return <span className="flex items-center gap-1 text-emerald-400 font-bold text-sm"><TrendingUp className="w-3.5 h-3.5"/>BUY</span>;
  if (signal === 'SELL') return <span className="flex items-center gap-1 text-red-400 font-bold text-sm"><TrendingDown className="w-3.5 h-3.5"/>SELL</span>;
  return <span className="flex items-center gap-1 text-gray-500 text-sm"><Minus className="w-3.5 h-3.5"/>NEUTRAL</span>;
}

function PaBadge({ explanation }: { explanation?: string }) {
  if (!explanation) return <span className="text-gray-600">—</span>;
  const hasBos   = explanation.includes('BOS');
  const hasChoch = explanation.includes('CHoCH');
  const isBull   = explanation.includes('bullish') || explanation.includes('HH');
  const isBear   = explanation.includes('bearish') || explanation.includes('LL');
  return (
    <div className="flex flex-col gap-0.5">
      {hasBos   && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 border border-blue-400/20 w-fit">BOS</span>}
      {hasChoch && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-400/10 text-purple-400 border border-purple-400/20 w-fit">CHoCH</span>}
      {!hasBos && !hasChoch && isBull && <span className="text-xs text-emerald-500">↑ Bull</span>}
      {!hasBos && !hasChoch && isBear && <span className="text-xs text-red-500">↓ Bear</span>}
      {!hasBos && !hasChoch && !isBull && !isBear && <span className="text-xs text-gray-600">—</span>}
    </div>
  );
}

const PAGE_SIZE = 12;

const LS_SYMBOLS = 'scan_selected_symbols';
const LS_TF      = 'scan_timeframe';

export default function SignalsPage() {
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
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ALL_SYMBOLS;
    try {
      const saved = localStorage.getItem(LS_SYMBOLS);
      return saved ? JSON.parse(saved) : ALL_SYMBOLS;
    } catch { return ALL_SYMBOLS; }
  });
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);

  // Persister sélection dans localStorage
  useEffect(() => { localStorage.setItem(LS_SYMBOLS, JSON.stringify(selectedSymbols)); }, [selectedSymbols]);
  useEffect(() => { localStorage.setItem(LS_TF, tf); }, [tf]);

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

  const portfolioRisk = (scan.data?.data as any)?.portfolio_risk ?? null;

  return (
    <AppLayout title="Signaux">
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-gray-400 text-sm">{signals?.length ?? 0} signaux actifs</p>
            {signals && signals.length > PAGE_SIZE && <p className="text-gray-600 text-xs">Page {page + 1}/{Math.ceil(signals.length / PAGE_SIZE)}</p>}
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
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm">
            ✅ {Array.isArray(scan.data?.data) ? scan.data.data.length : 0} nouveau(x) signal(aux) générés
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

        {!isLoading && (!signals || signals.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-600 bg-gray-900 border border-gray-800 rounded-xl">
            <TrendingUp className="w-10 h-10 mb-3"/>
            <p className="font-medium">Aucun signal</p>
            <p className="text-sm mt-1">Cliquez sur <strong className="text-gray-400">Scanner</strong> pour lancer l'analyse</p>
          </div>
        )}

        {signals && signals.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, signals.length)} sur {signals.length} signaux
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-400 px-2">{page + 1} / {Math.ceil(signals.length / PAGE_SIZE)}</span>
              <button onClick={() => setPage(p => Math.min(Math.ceil(signals.length / PAGE_SIZE) - 1, p + 1))} disabled={(page + 1) * PAGE_SIZE >= signals.length}
                className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {signals?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(s => {
            const pa        = s.metadata?.price_action ?? {};
            const sr        = s.metadata?.sr_zones     ?? {};
            const pats      = s.metadata?.patterns     ?? {};
            const regime    = s.metadata?.regime       ?? {};
            const smc       = s.metadata?.smc          ?? {};
            const mtf       = s.metadata?.mtf_context  ?? {};
            const isPending = (s as any).signal_pending === true;
            const isSticky  = (s as any).signal_sticky  === true;
            const fvg    = smc.fvg    ?? {};
            const ob     = smc.ob     ?? {};
            const liq    = smc.liquidity ?? {};
            const isBuy  = s.signal === 'BUY';
            const isSell = s.signal === 'SELL';
            return (
              <div key={s.id} className={`bg-gray-900 border rounded-xl p-5 hover:border-gray-700 transition-colors ${
                isBuy ? 'border-l-2 border-l-emerald-500 border-gray-800' : isSell ? 'border-l-2 border-l-red-500 border-gray-800' : 'border-gray-800'
              }`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-bold text-lg">{s.asset?.symbol ?? '—'}</span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{s.timeframe}</span>
                      {isPending && <span className="text-xs px-2 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400">⏳ Confirmation</span>}
                      {isSticky  && <span className="text-xs px-2 py-0.5 rounded border border-gray-500/30 bg-gray-700/50 text-gray-400">📌 Maintenu</span>}
                      <PaBadge explanation={s.explanation}/>
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5">{new Date(s.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <SignalBadge signal={s.signal}/>
                    <ConfidenceBadge value={Math.round(s.confidence)}/>
                  </div>
                </div>

                {/* Prix live */}
                {(() => {
                  const priceKey  = SYMBOL_TO_PRICE_KEY[s.asset?.symbol ?? ''] ?? (s.asset?.symbol ?? '');
                  const livePrice = prices[priceKey] ?? null;
                  const entry = s.entryPrice ? parseFloat(s.entryPrice) : null;
                  const delta = livePrice && entry ? ((livePrice - entry) / entry) * 100 : null;
                  if (!livePrice) return null;
                  return (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-gray-800/60 rounded-lg border border-gray-700">
                      <span className="text-gray-500 text-xs">Prix actuel</span>
                      <span className="text-white font-mono text-sm font-bold">${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                      {delta !== null && (
                        <span className={`text-xs font-mono font-semibold ml-auto ${
                          delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'
                        }`}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}% vs entrée</span>
                      )}
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                  );
                })()}

                {/* Niveaux */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {[
                    { label: 'Entrée',  value: s.entryPrice  ? parseFloat(s.entryPrice).toFixed(2)  : '—', color: 'text-white' },
                    { label: 'SL',      value: s.stopLoss    ? parseFloat(s.stopLoss).toFixed(2)    : '—', color: 'text-red-400' },
                    { label: 'TP1',     value: s.takeProfit1 ? parseFloat(s.takeProfit1).toFixed(2) : '—', color: 'text-emerald-400' },
                    { label: 'R/R',     value: s.riskReward  ? `${s.riskReward}x`                  : '—', color: 'text-yellow-400' },
                  ].map(lv => (
                    <div key={lv.label} className="bg-gray-800 rounded-lg p-2 text-center">
                      <p className="text-gray-500 text-xs mb-0.5">{lv.label}</p>
                      <p className={`font-mono text-xs font-semibold ${lv.color}`}>{lv.value}</p>
                    </div>
                  ))}
                </div>

                {/* Badge MTF confluence */}
                {mtf.confluence && mtf.confluence !== 'UNKNOWN' && (
                  <div className="flex items-center gap-1.5 mb-2 px-2.5 py-1.5 rounded-lg border bg-gray-800/60 w-fit" title={`${mtf.ltf} → ${mtf.mtf} → ${mtf.htf} | MTF: ${mtf.mtf_regime ?? '?'} (ADX ${mtf.mtf_adx ?? '?'}) | HTF: ${mtf.htf_regime ?? '?'} (ADX ${mtf.htf_adx ?? '?'})`}
                    style={{ borderColor: mtf.confluence === 'FULL' ? 'rgba(52,211,153,0.3)' : mtf.confluence === 'PARTIAL' ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)' }}>
                    <span className={`text-xs font-bold ${
                      mtf.confluence === 'FULL'    ? 'text-emerald-400' :
                      mtf.confluence === 'PARTIAL' ? 'text-yellow-400'  : 'text-red-400'
                    }`}>
                      {mtf.confluence === 'FULL' ? '⬡ FULL' : mtf.confluence === 'PARTIAL' ? '◑ PARTIAL' : '○ NONE'}
                    </span>
                    <span className="text-gray-500 text-xs">{mtf.ltf}→{mtf.mtf}→{mtf.htf}</span>
                    {mtf.mtf_aligned && <span className="text-xs text-emerald-500" title={`${mtf.mtf}: ${mtf.mtf_regime}`}>✓{mtf.mtf}</span>}
                    {mtf.htf_aligned && <span className="text-xs text-emerald-500" title={`${mtf.htf}: ${mtf.htf_regime}`}>✓{mtf.htf}</span>}
                    {mtf.mtf_aligned === false && <span className="text-xs text-red-500" title={`${mtf.mtf}: ${mtf.mtf_regime}`}>✗{mtf.mtf}</span>}
                    {mtf.htf_aligned === false && <span className="text-xs text-red-500" title={`${mtf.htf}: ${mtf.htf_regime}`}>✗{mtf.htf}</span>}
                  </div>
                )}

                {/* Badges PA + patterns */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {pa.trend && pa.trend !== 'NEUTRAL' && (
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${pa.trend === 'BULLISH' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
                      {pa.trend === 'BULLISH' ? '↑' : '↓'} {pa.structure?.split(' ')[0]}
                    </span>
                  )}
                  {pa.bos && <span className="text-xs px-2 py-0.5 rounded border text-blue-400 bg-blue-400/10 border-blue-400/20 font-medium">BOS {pa.bos_dir}</span>}
                  {pa.choch && <span className="text-xs px-2 py-0.5 rounded border text-purple-400 bg-purple-400/10 border-purple-400/20 font-medium">CHoCH</span>}
                  {pats.pin_bar && <span className="text-xs px-2 py-0.5 rounded border text-yellow-400 bg-yellow-400/10 border-yellow-400/20">Pin Bar {pats.pin_bar}</span>}
                  {pats.engulfing && <span className="text-xs px-2 py-0.5 rounded border text-orange-400 bg-orange-400/10 border-orange-400/20">Engulfing {pats.engulfing}</span>}
                  {pats.inside_bar && <span className="text-xs px-2 py-0.5 rounded border text-gray-400 bg-gray-400/10 border-gray-600">Inside Bar</span>}
                  {pats.doji && <span className="text-xs px-2 py-0.5 rounded border text-gray-400 bg-gray-700 border-gray-600">Doji</span>}
                  {sr.near_support && <span className="text-xs px-2 py-0.5 rounded border text-emerald-400 bg-emerald-400/10 border-emerald-400/20">Support ${sr.near_support.price?.toFixed(0)}</span>}
                  {sr.near_resistance && <span className="text-xs px-2 py-0.5 rounded border text-red-400 bg-red-400/10 border-red-400/20">Résist. ${sr.near_resistance.price?.toFixed(0)}</span>}
                  {regime.regime && (
                    <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                      regime.regime === 'TRENDING_BULL' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' :
                      regime.regime === 'TRENDING_BEAR' ? 'text-red-400 bg-red-400/10 border-red-400/20' :
                      regime.regime === 'VOLATILE'      ? 'text-orange-400 bg-orange-400/10 border-orange-400/20' :
                      'text-gray-500 bg-gray-700 border-gray-600'
                    }`} title={regime.description}>
                      ADX {regime.adx} · {regime.regime?.replace('_', ' ')}
                    </span>
                  )}
                  {fvg.near_bullish_fvg && <span className="text-xs px-2 py-0.5 rounded border text-cyan-400 bg-cyan-400/10 border-cyan-400/20 font-medium" title={`FVG ${fvg.near_bullish_fvg.bottom?.toFixed(2)}–${fvg.near_bullish_fvg.top?.toFixed(2)}`}>FVG Bull</span>}
                  {fvg.near_bearish_fvg && <span className="text-xs px-2 py-0.5 rounded border text-rose-400 bg-rose-400/10 border-rose-400/20 font-medium" title={`FVG ${fvg.near_bearish_fvg.bottom?.toFixed(2)}–${fvg.near_bearish_fvg.top?.toFixed(2)}`}>FVG Bear</span>}
                  {ob.near_bullish_ob && <span className="text-xs px-2 py-0.5 rounded border text-teal-400 bg-teal-400/10 border-teal-400/20 font-medium" title={`OB ${ob.near_bullish_ob.bottom?.toFixed(2)}–${ob.near_bullish_ob.top?.toFixed(2)}`}>OB Bull</span>}
                  {ob.near_bearish_ob && <span className="text-xs px-2 py-0.5 rounded border text-pink-400 bg-pink-400/10 border-pink-400/20 font-medium" title={`OB ${ob.near_bearish_ob.bottom?.toFixed(2)}–${ob.near_bearish_ob.top?.toFixed(2)}`}>OB Bear</span>}
                  {liq.near_eqh && <span className="text-xs px-2 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20" title={`${liq.near_eqh.touches} touches`}>EQH Liq</span>}
                  {liq.near_eql && <span className="text-xs px-2 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20" title={`${liq.near_eql.touches} touches`}>EQL Liq</span>}
                </div>

                {/* Explication technique */}
                <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-3" title={s.explanation ?? ''}>{s.explanation ?? '—'}</p>

                {/* Sentiment News */}
                {(() => {
                  const ns = (s.metadata as any)?.news_sentiment;
                  if (!ns) return null;
                  const sentColor = ns.label === 'bullish'
                    ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                    : ns.label === 'bearish'
                    ? 'text-red-400 bg-red-400/10 border-red-400/20'
                    : 'text-gray-400 bg-gray-700 border-gray-600';
                  const bonusText = ns.bonus > 0 ? `+${ns.bonus}` : `${ns.bonus}`;
                  return (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Newspaper className="w-3 h-3 text-gray-500" />
                        <span className="text-xs text-gray-500">Sentiment news</span>
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium capitalize ${sentColor}`}>
                          {ns.label}
                        </span>
                        <span className={`text-xs font-mono font-bold ${ns.bonus > 0 ? 'text-emerald-400' : ns.bonus < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {bonusText}pts
                        </span>
                      </div>
                      {ns.articles?.length > 0 && (
                        <div className="space-y-1">
                          {ns.articles.slice(0,2).map((a: any, i: number) => (
                            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-start gap-1.5 group">
                              <ExternalLink className="w-2.5 h-2.5 text-gray-600 group-hover:text-violet-400 mt-0.5 shrink-0" />
                              <span className="text-xs text-gray-500 group-hover:text-gray-300 line-clamp-1 transition-colors">
                                {a.title}
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Bouton Chart + IA */}
                {s.signal !== 'NEUTRAL' && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Link href={`/chart?symbol=${encodeURIComponent(s.asset?.symbol ?? 'BTC/USDT')}&tf=${s.timeframe}`}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 bg-gray-800/50 hover:bg-gray-700 hover:text-white transition-colors font-medium">
                        <BarChart2 className="w-3 h-3" />Voir chart
                      </Link>
                      <button
                        onClick={() => explainSignal(s.id)}
                        disabled={loadingAi[s.id]}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-violet-500/30 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-50 transition-colors font-medium">
                        {loadingAi[s.id]
                          ? <><RefreshCw className="w-3 h-3 animate-spin" />Analyse IA...</>
                          : aiExplain[s.id]
                            ? <><ChevronUp className="w-3 h-3" />Masquer l'IA</>
                            : <><Brain className="w-3 h-3" />Expliquer avec l'IA</>}
                      </button>
                    </div>
                    {aiExplain[s.id] && (
                      <div className="mt-2 p-3 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Brain className="w-3 h-3 text-violet-400" />
                          <span className="text-xs font-medium text-violet-400">Analyse GPT-4o</span>
                        </div>
                        <p className="text-gray-300 text-xs leading-relaxed">{aiExplain[s.id]}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
