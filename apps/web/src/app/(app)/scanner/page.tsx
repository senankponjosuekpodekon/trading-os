'use client';
import { useMemo, useState, useEffect, useRef, Suspense } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { SignalCard } from '@/components/signals/SignalCard';
import { api } from '@/lib/api';
import { Signal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useNotifications } from '@/hooks/useNotifications';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useTradingStore } from '@/store/trading.store';
import {
  Search, RefreshCw, Zap, TrendingUp, TrendingDown, Minus, Activity,
  ChevronDown, ChevronUp, Radar, Bell, BellOff
} from 'lucide-react';

const TIMEFRAMES = ['all', '15m', '1h', '4h', '1d'];
const DIRECTIONS = ['all', 'BUY', 'SELL', 'NEUTRAL'];

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

const LS_SYMBOLS = 'scanner_selected_symbols';
const LS_TF = 'scanner_timeframe';

const QUALITY_THRESHOLD = 70;
// Fenêtre d'absence : > cycle warmup max (10 min + jitter). Un signal qui
// réapparaît après cette durée est considéré comme une nouvelle occurrence.
const SIGNAL_ABSENCE_MS = 20 * 60 * 1000;

function inferMarket(symbol?: string): string {
  if (!symbol) return 'UNKNOWN';
  if (symbol.endsWith('/USDT')) return 'CRYPTO';
  if (/^(VIX|JUMP|BOOM|CRASH|V\d+)/i.test(symbol)) return 'SYNTHETIC';
  if (symbol.includes('/')) {
    if (symbol.endsWith('/USD') && !['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD','XAU/USD','XAG/USD','WTI/USD','BRENT/USD'].includes(symbol)) return 'STOCK';
    return 'FOREX';
  }
  return 'BRVM';
}

function computeOpportunityScore(s: Signal): number {
  const conf = s.confidence ?? 50;
  const rr = s.riskReward ? parseFloat(String(s.riskReward)) : 2;
  const mtf = s.metadata?.mtf_context ?? {};
  const mtfBonus = mtf.confluence === 'FULL' ? 1.25 : mtf.confluence === 'PARTIAL' ? 1 : 0.85;
  return Math.round(Math.min(100, conf * Math.min(rr, 5) * mtfBonus / 2));
}

function ScannerPageInner() {
  const { toast } = useToast();
  const { notifications } = useNotifications();
  const { supported: pushSupported, subscribed: pushSubscribed, requestPermission: requestPush, unsubscribe: unsubscribePush } = usePushNotifications();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastNotifIdRef = useRef<string | null>(null);
  const prices = useTradingStore(s => s.prices);
  const fetchSignals = useTradingStore(s => s.fetchSignals);
  const storeSignals = useTradingStore(s => s.signals);

  const getParam = (key: string, fallback: string) => searchParams.get(key) ?? fallback;
  const [query, setQuery] = useState(getParam('q', ''));
  const [timeframe, setTimeframe] = useState(getParam('tf', 'all'));
  const [direction, setDirection] = useState(getParam('dir', 'all'));
  const [market, setMarket] = useState(getParam('mkt', 'all'));
  const [minConf, setMinConf] = useState(parseInt(getParam('conf', '50'), 10));
  const [page, setPage] = useState(parseInt(getParam('page', '1'), 10));
  const [sortBy, setSortBy] = useState(getParam('sort', 'createdAt:desc'));
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(getParam('view', 'grid') as 'grid' | 'table');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ALL_SYMBOLS;
    try {
      const saved = localStorage.getItem(LS_SYMBOLS);
      return saved ? JSON.parse(saved) : ALL_SYMBOLS;
    } catch { return ALL_SYMBOLS; }
  });

  useEffect(() => { localStorage.setItem(LS_SYMBOLS, JSON.stringify(selectedSymbols)); }, [selectedSymbols]);
  useEffect(() => { localStorage.setItem(LS_TF, timeframe); }, [timeframe]);

  // ── Sync filters with URL ──────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (timeframe !== 'all') params.set('tf', timeframe);
    if (direction !== 'all') params.set('dir', direction);
    if (market !== 'all') params.set('mkt', market);
    if (minConf !== 50) params.set('conf', String(minConf));
    if (page !== 1) params.set('page', String(page));
    if (sortBy !== 'createdAt:desc') params.set('sort', sortBy);
    if (viewMode !== 'grid') params.set('view', viewMode);
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  }, [query, timeframe, direction, market, minConf, page, sortBy, viewMode, router, pathname]);

  // ── Beep via Web Audio API ─────────────────────────────────
  const initAudio = () => {
    if (typeof window === 'undefined') return;
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  };

  const playBeep = () => {
    initAudio();
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
  };

  useEffect(() => {
    const resumeOnInteraction = () => {
      initAudio();
      window.removeEventListener('click', resumeOnInteraction);
      window.removeEventListener('touchstart', resumeOnInteraction);
    };
    window.addEventListener('click', resumeOnInteraction);
    window.addEventListener('touchstart', resumeOnInteraction);
    return () => {
      window.removeEventListener('click', resumeOnInteraction);
      window.removeEventListener('touchstart', resumeOnInteraction);
    };
  }, []);

  useEffect(() => {
    const latest = notifications[0];
    if (!latest || latest.id === lastNotifIdRef.current) return;
    lastNotifIdRef.current = latest.id;
    if (latest.type !== 'SIGNAL' || (latest.data?.confidence ?? 0) < 70) return;
    playBeep();
    toast(`${latest.data?.signal === 'BUY' ? '🟢' : '🔴'} ${latest.data?.symbol} ${latest.data?.signal} ${latest.data?.confidence}%`, {
      title: 'Nouveau signal SSE',
      type: latest.data?.signal === 'BUY' ? 'success' : 'error',
    });
  }, [notifications, toast]);

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

  // ── Polling config (same as /signals page) ──────────────────
  const { data: pollingConfig } = useQuery({
    queryKey: ['polling-config'],
    queryFn: async () => (await api.get('/system/polling-config/public')).data,
    staleTime: 60_000,
  });
  const scanPollingInterval = pollingConfig?.scanPollingInterval ?? 5_000;

  // ── Real-time scan history (from engine warmup loops) ───────
  // Filtré côté serveur (BUY/SELL + min conf) pour couvrir toute la liste
  // Redis (500 entrées) sans être éjecté par le bruit NEUTRAL.
  const { data: scanHistoryData, isFetching: scanHistoryLoading } = useQuery({
    queryKey: ['scan-history-scanner', minConf],
    queryFn: async () => (await api.get('/signals/scan-history', {
      params: {
        limit: 200,
        signal: 'BUY,SELL',
        min_confidence: Math.min(minConf, QUALITY_THRESHOLD),
      },
    })).data,
    refetchInterval: autoRefresh ? scanPollingInterval : false,
    staleTime: 3_000,
  });

  const PAGE_LIMIT = 12;

  // ── Persisted signals (from DB) ─────────────────────────────
  const { data: signalsData, isLoading, refetch } = useQuery<{
    data: Signal[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['signals', 'scanner', page, sortBy, market],
    queryFn: async () => (await api.get('/signals', {
      params: {
        page,
        limit: PAGE_LIMIT,
        sort: sortBy,
        market: market === 'all' ? undefined : market,
      },
    })).data,
    refetchInterval: autoRefresh ? 15_000 : false,
  });

  // ── Detect new quality signals from scan-history ────────────
  const prevScanIds = useRef<Set<string>>(new Set());
  // Dernière occurrence vue par signal logique (symbol-timeframe-signal).
  // Un signal qui refire à chaque cycle warmup = une seule occurrence :
  // on ne re-notifie que s'il a disparu plus de SIGNAL_ABSENCE_MS.
  const signalLastSeen = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const entries = scanHistoryData?.entries ?? scanHistoryData ?? [];
    if (!entries || entries.length === 0) return;

    const isQuality = (e: any) =>
      (e.signal === 'BUY' || e.signal === 'SELL') && (e.confidence ?? 0) >= QUALITY_THRESHOLD;
    const keyOf = (e: any) => `${e.symbol}-${e.timeframe}-${e.signal}`;

    const currentIds = new Set<string>(entries.map((e: any) => `${e.symbol}-${e.timeframe}-${e.scanned_at}`));
    const isFirstPoll = prevScanIds.current.size === 0;
    const freshEntries = entries.filter((e: any) =>
      !prevScanIds.current.has(`${e.symbol}-${e.timeframe}-${e.scanned_at}`)
    );
    prevScanIds.current = currentIds;

    const now = Date.now();
    // Une notification par signal logique (l'entrée la plus récente en tête de liste).
    const newOccurrences = new Map<string, any>();
    for (const e of freshEntries) {
      if (!isQuality(e)) continue;
      const key = keyOf(e);
      const lastSeen = signalLastSeen.current.get(key);
      if ((lastSeen === undefined || now - lastSeen > SIGNAL_ABSENCE_MS) && !newOccurrences.has(key)) {
        newOccurrences.set(key, e);
      }
    }
    // Rafraîchir la présence de tous les signaux qualité visibles.
    for (const e of entries) {
      if (isQuality(e)) signalLastSeen.current.set(keyOf(e), now);
    }

    if (!isFirstPoll && newOccurrences.size > 0 && notifyEnabled) {
      Array.from(newOccurrences.values()).slice(0, 3).forEach((e: any) => {
        const icon = e.signal === 'BUY' ? '🟢' : '🔴';
        toast(`${icon} ${e.symbol} ${e.signal} ${e.confidence}% — ${e.timeframe}`, {
          title: 'Nouveau signal détecté',
          type: e.signal === 'BUY' ? 'success' : 'error',
        });
      });
      setNewCount(c => c + newOccurrences.size);
    }
  }, [scanHistoryData, notifyEnabled, toast]);

  // ── Also sync store signals ─────────────────────────────────
  useEffect(() => {
    if (autoRefresh) {
      fetchSignals();
    }
  }, [autoRefresh, fetchSignals]);

  // ── Merge: DB signals + scan-history quality entries ────────
  const allSignals = useMemo(() => {
    const merged: Signal[] = [];
    const seen = new Set<string>();

    // DB signals first (rich data)
    if (signalsData?.data) {
      for (const s of signalsData.data) {
        if (!seen.has(s.id)) {
          merged.push(s);
          seen.add(s.id);
        }
      }
    }

    // Also include store signals (may have fresher data via WS)
    if (storeSignals) {
      for (const s of storeSignals) {
        if (!seen.has(s.id)) {
          merged.push(s);
          seen.add(s.id);
        }
      }
    }

    return merged;
  }, [signalsData, storeSignals]);

  const filtered = useMemo(() => {
    return allSignals
      .filter(s => {
        if (s.confidence < minConf) return false;
        if (direction !== 'all' && s.signal !== direction) return false;
        if (timeframe !== 'all' && s.timeframe !== timeframe) return false;
        if (market !== 'all' && inferMarket(s.asset?.symbol) !== market) return false;
        if (query && !s.asset?.symbol.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => computeOpportunityScore(b) - computeOpportunityScore(a));
  }, [allSignals, minConf, direction, timeframe, market, query]);

  const counts = useMemo(() => {
    const buy = filtered.filter(s => s.signal === 'BUY').length;
    const sell = filtered.filter(s => s.signal === 'SELL').length;
    const neutral = filtered.filter(s => s.signal === 'NEUTRAL').length;
    return { buy, sell, neutral };
  }, [filtered]);

  // ── Live scan entries from warmup loops ─────────────────────
  const liveEntries = useMemo(() => {
    const entries = scanHistoryData?.entries ?? scanHistoryData ?? [];
    if (!entries) return [];
    return entries
      .filter((e: any) => (e.signal === 'BUY' || e.signal === 'SELL') && (e.confidence ?? 0) >= minConf)
      .sort((a: any, b: any) => new Date(b.scanned_at || 0).getTime() - new Date(a.scanned_at || 0).getTime())
      .slice(0, 20);
  }, [scanHistoryData, minConf]);

  const liveHighQualitySignals = useMemo<Signal[]>(() => {
    // Dédupliquer sur TOUTES les entrées fetchées (pas le top-20 du feed) :
    // sinon une rafale de nouveaux scans éjecte la source de la carte et
    // elle disparaît au poll suivant.
    const entries = scanHistoryData?.entries ?? scanHistoryData ?? [];
    const latestByKey = new Map<string, any>();
    for (const e of entries) {
      if ((e.signal === 'BUY' || e.signal === 'SELL') && (e.confidence ?? 0) >= QUALITY_THRESHOLD) {
        const key = `${e.symbol}-${e.timeframe}-${e.signal}`;
        const existing = latestByKey.get(key);
        if (!existing || new Date(e.scanned_at || 0).getTime() > new Date(existing.scanned_at || 0).getTime()) {
          latestByKey.set(key, e);
        }
      }
    }
    return Array.from(latestByKey.values()).map((e: any) => ({
      id: `live-${e.symbol}-${e.timeframe}-${e.scanned_at}`,
      assetId: '',
      strategyId: '',
      signal: e.signal,
      confidence: e.confidence,
      timeframe: e.timeframe,
      createdAt: e.scanned_at,
      asset: { symbol: e.symbol, name: e.symbol },
      entryPrice: e.entry_price ? String(e.entry_price) : undefined,
      stopLoss: e.stop_loss ? String(e.stop_loss) : undefined,
      takeProfit1: e.take_profit_1 ? String(e.take_profit_1) : undefined,
      takeProfit2: e.take_profit_2 ? String(e.take_profit_2) : undefined,
      riskReward: e.risk_reward,
      status: 'ACTIVE',
      explanation: e.explanation,
    }));
  }, [scanHistoryData]);

  const scan = useMutation({
    mutationFn: async () => (await api.post('/signals/scan', {
      symbols: selectedSymbols.length ? selectedSymbols : ALL_SYMBOLS,
      timeframe: timeframe === 'all' ? '1h' : timeframe,
    })).data,
    onSuccess: (data) => {
      const count = Array.isArray(data?.data) ? data.data.length : 0;
      refetch();
      fetchSignals(true);
      toast(`${count} nouveau(x) signal(aux) généré(s)`, { type: 'success' });
    },
    onError: () => toast('Erreur lors du scan', { type: 'error' }),
  });

  const resetNewCount = () => {
    setNewCount(0);
    setHighlightedIds(new Set());
  };

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Search className="w-5 h-5 text-emerald-400" />Scanner
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Signaux en temps réel + scan manuel sur tous les marchés</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                autoRefresh ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
              Auto: {autoRefresh ? 'ON' : 'OFF'}
            </button>
            {/* Notifications toggle */}
            <button
              onClick={() => setNotifyEnabled(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                notifyEnabled ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'
              }`}
            >
              {notifyEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              Notif: {notifyEnabled ? 'ON' : 'OFF'}
            </button>
            {/* Push notifications */}
            {pushSupported && (
              <button
                onClick={() => (pushSubscribed ? unsubscribePush() : requestPush())}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  pushSubscribed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {pushSubscribed ? '🔔 Push ON' : '🔕 Push OFF'}
              </button>
            )}
            {/* View mode */}
            <button
              onClick={() => setViewMode(v => v === 'grid' ? 'table' : 'grid')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
              title="Basculer vue grille / tableau"
            >
              {viewMode === 'grid' ? '⊞ Grille' : '☰ Tableau'}
            </button>
            {/* New signals badge */}
            {newCount > 0 && (
              <button
                onClick={resetNewCount}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm bg-emerald-500/20 border-emerald-500/40 text-emerald-300 animate-pulse"
              >
                <span className="font-bold">{newCount}</span> nouveau(x)
              </button>
            )}
            {/* Scan button */}
            <button
              onClick={() => scan.mutate()}
              disabled={scan.isPending || selectedSymbols.length === 0}
              title={selectedSymbols.length === 0 ? 'Sélectionnez au moins un actif' : undefined}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {scan.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Scanner {selectedSymbols.length} actif{selectedSymbols.length > 1 ? 's' : ''}
            </button>
          </div>
        </div>

        {/* Live scan feed (from engine warmup loops) */}
        {liveEntries.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-gray-400">Flux temps réel — engine warmup</span>
                {scanHistoryLoading && <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />}
                <span className="text-xs text-gray-600">· polling {scanPollingInterval / 1000}s</span>
              </div>
              <span className="text-xs text-gray-500">{liveEntries.length} signaux qualité</span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {liveEntries.map((entry: any, i: number) => {
                const id = `${entry.symbol}-${entry.timeframe}-${entry.scanned_at}`;
                const isNew = !prevScanIds.current.has(id) && prevScanIds.current.size > 0;
                const color = entry.signal === 'BUY' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30';
                const time = entry.scanned_at ? new Date(entry.scanned_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                      isNew ? 'border-emerald-500/50 bg-emerald-500/5 animate-pulse' : 'border-gray-800 bg-gray-900/50'
                    }`}
                  >
                    <div className={`px-2 py-0.5 rounded text-xs font-bold border ${color} min-w-[55px] text-center`}>
                      {entry.signal}
                    </div>
                    <span className="text-sm font-semibold text-white">{entry.symbol}</span>
                    <span className="text-xs text-gray-500">{entry.timeframe}</span>
                    <span className={`text-xs font-medium ${entry.confidence >= 70 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {entry.confidence}%
                    </span>
                    {entry.signal_pending && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 animate-pulse">
                        EN CONFIRMATION
                      </span>
                    )}
                    {entry.quality_score != null && entry.quality_score > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium border ${
                        entry.quality_score >= 70 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                        entry.quality_score >= 40 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                        'bg-red-500/10 text-red-400 border-red-500/30'
                      }`} title={entry.quality_flags?.join(' | ') ?? ''}>
                        Q{entry.quality_score}
                      </span>
                    )}
                    {entry.quality_size_multiplier != null && entry.quality_size_multiplier > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium border bg-blue-500/10 text-blue-400 border-blue-500/30"
                        title={`Size multiplier: ${entry.quality_size_multiplier}x`}>
                        {entry.quality_size_multiplier}x
                      </span>
                    )}
                    {entry.explanation && (
                      <span className="text-xs text-gray-500 truncate flex-1" title={entry.explanation}>{entry.explanation}</span>
                    )}
                    <span className="text-xs text-gray-600 whitespace-nowrap ml-auto">{time}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Rechercher un actif..."
                className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <Select label="Timeframe" value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
            <Select label="Direction" value={direction} onChange={setDirection} options={DIRECTIONS} />
            <Select label="Marché" value={market} onChange={(v) => { setMarket(v); setPage(1); }} options={['all', 'CRYPTO', 'FOREX', 'SYNTHETIC', 'BRVM', 'STOCK']} />
            <Select
              label="Trier par"
              value={sortBy}
              onChange={(v) => { setSortBy(v); setPage(1); }}
              options={[
                { value: 'createdAt:desc', label: 'Date ↓' },
                { value: 'createdAt:asc', label: 'Date ↑' },
                { value: 'confidence:desc', label: 'Confiance ↓' },
                { value: 'confidence:asc', label: 'Confiance ↑' },
              ]}
            />
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Confiance min : {minConf}%</label>
              <input
                type="range"
                min={40}
                max={90}
                step={5}
                value={minConf}
                onChange={e => setMinConf(+e.target.value)}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>

          {/* Symbol picker */}
          <div className="border-t border-gray-800 pt-3">
            <button onClick={() => setShowSymbolPicker(v => !v)}
              className="w-full flex items-center justify-between text-sm hover:bg-gray-800/50 -mt-3 -mx-4 px-4 py-2 transition-colors rounded-t-xl">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400 text-sm">Actifs à scanner :</span>
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
              <div className="px-0 pb-3 pt-2 space-y-3">
                {SCAN_SYMBOLS_GROUPS.map(group => {
                  const groupSelected = group.symbols.filter(s => selectedSymbols.includes(s)).length;
                  const allGroupSelected = groupSelected === group.symbols.length;
                  return (
                    <div key={group.label}>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">{group.label}</p>
                        <span className="text-xs text-gray-600">{groupSelected}/{group.symbols.length}</span>
                        <button onClick={() => toggleGroup(group.symbols)}
                          className={`ml-auto text-xs px-2 py-0.5 rounded border transition-colors ${
                            allGroupSelected ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                          }`}>
                          {allGroupSelected ? 'Tout désélect.' : 'Tout sélect.'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.symbols.map(sym => (
                          <button key={sym} onClick={() => toggleSymbol(sym)}
                            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                              selectedSymbols.includes(sym) ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
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

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <CountBadge icon={<TrendingUp className="w-3 h-3" />} label="BUY" count={counts.buy} color="text-emerald-400 bg-emerald-400/10 border-emerald-400/20" />
            <CountBadge icon={<TrendingDown className="w-3 h-3" />} label="SELL" count={counts.sell} color="text-red-400 bg-red-400/10 border-red-400/20" />
            <CountBadge icon={<Minus className="w-3 h-3" />} label="NEUTRAL" count={counts.neutral} color="text-gray-400 bg-gray-800 border-gray-700" />
            <span className="ml-auto text-gray-500">{filtered.length} résultat(s)</span>
          </div>
        </div>

        {/* Nouveaux signaux live ≥ 70% */}
        {liveHighQualitySignals.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-medium text-white">Nouveaux signaux live ≥ 70%</h3>
              <span className="text-xs text-gray-500">{liveHighQualitySignals.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {liveHighQualitySignals.map(s => <SignalCard key={s.id} signal={s} prices={prices} />)}
            </div>
          </div>
        )}

        {/* Résultats */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 h-36 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-gray-900 border border-gray-800 rounded-xl">
            <Activity className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Aucun signal ne correspond aux filtres</p>
            <button onClick={() => scan.mutate()} disabled={scan.isPending || selectedSymbols.length === 0} className="mt-4 text-emerald-400 text-sm hover:underline">
              Lancer un scan maintenant
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(s => <SignalCard key={s.id} signal={s} prices={prices} />)}
          </div>
        ) : (
          <SignalsTable signals={filtered} prices={prices} />
        )}

        {/* Pagination */}
        {signalsData?.meta && signalsData.meta.totalPages > 1 && (
          <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Précédent
            </button>
            <span className="text-sm text-gray-400">
              Page {page} / {signalsData.meta.totalPages} · {signalsData.meta.total} signaux
            </span>
            <button
              onClick={() => setPage(p => Math.min(signalsData.meta.totalPages, p + 1))}
              disabled={page === signalsData.meta.totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Suivant
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function SignalsTable({ signals, prices }: { signals: Signal[]; prices: Record<string, number> }) {
  const fmtPrice = (v?: string | number | null) => {
    if (v == null) return '—';
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isNaN(n) ? '—' : n.toFixed(n < 1 ? 4 : 2);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-sm text-left text-gray-400">
        <thead className="bg-gray-900 text-gray-300 text-xs uppercase">
          <tr>
            <th className="px-4 py-3">Actif</th>
            <th className="px-4 py-3">Signal</th>
            <th className="px-4 py-3">Confiance</th>
            <th className="px-4 py-3">TF</th>
            <th className="px-4 py-3">Entrée</th>
            <th className="px-4 py-3">SL</th>
            <th className="px-4 py-3">TP1</th>
            <th className="px-4 py-3">R/R</th>
            <th className="px-4 py-3">Prix live</th>
            <th className="px-4 py-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(s => {
            const live = s.asset?.symbol ? prices[s.asset.symbol] : undefined;
            return (
              <tr key={s.id} className="border-t border-gray-800 hover:bg-gray-900/50 transition-colors">
                <td className="px-4 py-3 font-medium text-white">{s.asset?.symbol ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`font-bold ${s.signal === 'BUY' ? 'text-emerald-400' : s.signal === 'SELL' ? 'text-red-400' : 'text-gray-400'}`}>
                    {s.signal}
                  </span>
                </td>
                <td className="px-4 py-3">{s.confidence}%</td>
                <td className="px-4 py-3">{s.timeframe}</td>
                <td className="px-4 py-3">{fmtPrice(s.entryPrice)}</td>
                <td className="px-4 py-3 text-red-400">{fmtPrice(s.stopLoss)}</td>
                <td className="px-4 py-3 text-emerald-400">{fmtPrice(s.takeProfit1)}</td>
                <td className="px-4 py-3">{s.riskReward ? `${s.riskReward}x` : '—'}</td>
                <td className="px-4 py-3">{live != null ? fmtPrice(live) : '—'}</td>
                <td className="px-4 py-3">{s.createdAt ? new Date(s.createdAt).toLocaleString('fr-FR') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
}) {
  const normalized = options.map(o => (typeof o === 'string' ? { value: o, label: o === 'all' ? 'Tous' : o } : o));
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
      >
        {normalized.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function CountBadge({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${color}`}>
      {icon}
      <span className="font-medium">{count}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

export default function ScannerPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Chargement…</div>}>
      <ScannerPageInner />
    </Suspense>
  );
}
