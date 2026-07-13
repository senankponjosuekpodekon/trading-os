'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { OHLCBar, ChartMarker, Drawing, IndicatorSeries, PriceLevel } from '@/components/chart/CandlestickChart';
import { DrawingToolbar, DrawingTool } from '@/components/chart/DrawingToolbar';
import { Signal } from '@/types';
import { useTradingStore } from '@/store/trading.store';
import { RefreshCw, TrendingUp, TrendingDown, Minus, X, BarChart2, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const CandlestickChart = dynamic(
  () => import('@/components/chart/CandlestickChart').then(mod => mod.CandlestickChart),
  { ssr: false, loading: () => <div className="h-[500px] flex items-center justify-center text-gray-600">Chargement du graphique…</div> },
);

// ── Groupes de symboles (alignés avec la page Signaux) ─────────────────────
const SYMBOL_GROUPS = [
  { label: 'Crypto',   symbols: ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AVAX/USDT','XRP/USDT','LINK/USDT','ADA/USDT','DOGE/USDT','MATIC/USDT','PAXG/USDT'] },
  { label: 'Forex',    symbols: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD'] },
  { label: 'Matières', symbols: ['XAU/USD','XAG/USD','WTI/USD','BRENT/USD'] },
  { label: 'Deriv',    symbols: ['VIX75/USD','VIX25/USD','VIX10/USD','BOOM1000/USD','BOOM500/USD','BOOM300/USD','CRASH1000/USD','CRASH500/USD','CRASH300/USD','JUMP75/USD','JUMP25/USD'] },
];
const ALL_SYMBOLS = SYMBOL_GROUPS.flatMap(g => g.symbols);

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

// Mapping symbole interne → Binance (crypto uniquement)
const SYM_BINANCE: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'XRP/USDT': 'XRPUSDT',
  'LINK/USDT': 'LINKUSDT', 'ADA/USDT': 'ADAUSDT', 'DOGE/USDT': 'DOGEUSDT',
  'MATIC/USDT': 'MATICUSDT', 'PAXG/USDT': 'PAXGUSDT',
};

// Mapping prix live WS (identique à signals/page.tsx)
const SYMBOL_TO_PRICE_KEY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SYM_BINANCE).map(([k, v]) => [k, v])),
  'EUR/USD': 'EUR/USD', 'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY',
  'AUD/USD': 'AUD/USD', 'USD/CHF': 'USD/CHF', 'USD/CAD': 'USD/CAD', 'NZD/USD': 'NZD/USD',
  'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD', 'WTI/USD': 'WTI/USD', 'BRENT/USD': 'BRENT/USD',
  'VIX10/USD': 'VIX10/USD', 'VIX25/USD': 'VIX25/USD', 'VIX75/USD': 'VIX75/USD',
  'BOOM1000/USD': 'BOOM1000/USD', 'BOOM500/USD': 'BOOM500/USD', 'BOOM300/USD': 'BOOM300/USD',
  'CRASH1000/USD': 'CRASH1000/USD', 'CRASH500/USD': 'CRASH500/USD', 'CRASH300/USD': 'CRASH300/USD',
  'JUMP75/USD': 'JUMP75/USD', 'JUMP25/USD': 'JUMP25/USD',
};

// ── Fetch klines multi-source ──────────────────────────────────────────────
async function fetchKlines(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const binSym = SYM_BINANCE[symbol];
  if (binSym) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${timeframe}&limit=300`;
    const { data } = await axios.get(url);
    return data.map((k: any[]) => ({
      time: Math.floor(k[0] / 1000), open: parseFloat(k[1]),
      high: parseFloat(k[2]), low: parseFloat(k[3]),
      close: parseFloat(k[4]), volume: parseFloat(k[5]),
    }));
  }
  // Forex / Commodités / Deriv → engine API (yfinance / Deriv WS)
  const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:8000';
  const { data } = await axios.get(`${ENGINE}/indicators/klines`, {
    params: { symbol, interval: timeframe, limit: 300 },
  });
  return (data.klines ?? []).map((k: any) => ({
    time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0,
  }));
}

// ── Calcul EMA simple ──────────────────────────────────────────────────────
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = closes[0];
  for (let i = 0; i < closes.length; i++) {
    ema = i === 0 ? closes[0] : closes[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

// ── Calcul Bollinger Bands (période 20, k=2) ───────────────────────────────
function calcBB(closes: number[], period = 20, k = 2): { upper: number[]; lower: number[] } {
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    upper.push(mean + k * std);
    lower.push(mean - k * std);
  }
  return { upper, lower };
}

// ── Calcul RSI(14) ─────────────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === 'BUY')  return <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded"><TrendingUp className="w-3 h-3" />BUY</span>;
  if (signal === 'SELL') return <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded"><TrendingDown className="w-3 h-3" />SELL</span>;
  return <span className="flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-700 px-2 py-0.5 rounded"><Minus className="w-3 h-3" />NEUTRAL</span>;
}

export default function ChartPage() {
  const searchParams  = useSearchParams();
  const router        = useRouter();
  const initSymbol    = searchParams.get('symbol') ?? 'BTC/USDT';
  const initTf        = searchParams.get('tf')     ?? '1h';

  const [symbol,     setSymbol]     = useState(ALL_SYMBOLS.includes(initSymbol) ? initSymbol : 'BTC/USDT');
  const [timeframe,  setTimeframe]  = useState(TIMEFRAMES.includes(initTf) ? initTf : '1h');
  const [activeTool, setActiveTool] = useState<DrawingTool>('pointer');
  const [drawings,   setDrawings]   = useState<Drawing[]>([]);
  const [chartHeight, setChartHeight] = useState(500);
  const [showIndicators, setShowIndicators] = useState(true);
  const [showLevels,     setShowLevels]     = useState(true);
  const [activeGroup, setActiveGroup] = useState(SYMBOL_GROUPS[0].label);

  const prices  = useTradingStore(s => s.prices);

  useEffect(() => {
    const update = () => setChartHeight(window.innerWidth < 768 ? 320 : 520);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Sync URL params quand on change de symbole/TF
  const changeSymbol = useCallback((s: string) => {
    setSymbol(s);
    router.replace(`/chart?symbol=${encodeURIComponent(s)}&tf=${timeframe}`, { scroll: false });
  }, [router, timeframe]);

  const changeTf = useCallback((tf: string) => {
    setTimeframe(tf);
    router.replace(`/chart?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { scroll: false });
  }, [router, symbol]);

  // Klines
  const { data: klines, isFetching, refetch } = useQuery<OHLCBar[]>({
    queryKey: ['klines', symbol, timeframe],
    queryFn:  () => fetchKlines(symbol, timeframe),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Signaux depuis le store global
  const signals = useTradingStore(s => s.signals) as Signal[];

  // Markers signaux sur chart
  const markers: ChartMarker[] = useMemo(() => {
    if (!signals || !klines || klines.length === 0) return [];
    return signals
      .filter(s => s.asset?.symbol === symbol)
      .map(s => {
        const ts  = Math.floor(new Date(s.createdAt).getTime() / 1000);
        const bar = klines.reduce((prev, cur) =>
          Math.abs((cur.time as number) - ts) < Math.abs((prev.time as number) - ts) ? cur : prev
        );
        return {
          time: bar.time, position: s.signal === 'BUY' ? 'belowBar' : 'aboveBar',
          color: s.signal === 'BUY' ? '#34d399' : '#f87171',
          shape: s.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
          text:  `${s.signal} ${Math.round(s.confidence)}%`,
        } as ChartMarker;
      });
  }, [signals, klines, symbol]);

  // Indicateurs (EMA20, EMA50, BB) calculés côté client
  const indicators: IndicatorSeries = useMemo(() => {
    if (!klines || klines.length < 50 || !showIndicators) return {};
    const times  = klines.map(b => b.time as number);
    const closes = klines.map(b => b.close);
    const ema20v = calcEMA(closes, 20);
    const ema50v = calcEMA(closes, 50);
    const bb     = calcBB(closes, 20);
    const rsiV   = calcRSI(closes, 14);
    return {
      ema20:   times.map((t, i) => ({ time: t, value: ema20v[i] })),
      ema50:   times.map((t, i) => ({ time: t, value: ema50v[i] })),
      bbUpper: times.map((t, i) => ({ time: t, value: bb.upper[i] })).filter(p => !isNaN(p.value)),
      bbLower: times.map((t, i) => ({ time: t, value: bb.lower[i] })).filter(p => !isNaN(p.value)),
      rsi:     times.map((t, i) => ({ time: t, value: rsiV[i] })).filter(p => !isNaN(p.value)),
    };
  }, [klines, showIndicators]);

  // Niveaux du dernier signal tracés sur le chart
  const latestSignal = signals?.find(s => s.asset?.symbol === symbol);
  const levels: PriceLevel[] = useMemo(() => {
    if (!latestSignal) return [];
    const out: PriceLevel[] = [];
    if (latestSignal.entryPrice)  out.push({ price: parseFloat(String(latestSignal.entryPrice)),  color: '#ffffff', label: 'Entry', style: 'dashed' });
    if (latestSignal.stopLoss)    out.push({ price: parseFloat(String(latestSignal.stopLoss)),    color: '#f87171', label: 'SL',    style: 'solid' });
    if (latestSignal.takeProfit1) out.push({ price: parseFloat(String(latestSignal.takeProfit1)), color: '#34d399', label: 'TP1',   style: 'solid' });
    if (latestSignal.takeProfit2) out.push({ price: parseFloat(String(latestSignal.takeProfit2)), color: '#6ee7b7', label: 'TP2',   style: 'dashed' });
    return out;
  }, [latestSignal]);

  // Prix live via WS
  const priceKey = SYMBOL_TO_PRICE_KEY[symbol] ?? symbol;
  const livePrice = prices[priceKey];
  const lastBar = klines?.[klines.length - 1];
  const refPrice = livePrice ?? lastBar?.close;
  const prevClose = klines?.[klines.length - 2]?.close;
  const pctChg = refPrice && prevClose ? ((refPrice - prevClose) / prevClose * 100).toFixed(2) : null;
  const isUp   = pctChg !== null ? parseFloat(pctChg) >= 0 : null;

  const currentGroup = SYMBOL_GROUPS.find(g => g.label === activeGroup) ?? SYMBOL_GROUPS[0];

  return (
    <AppLayout title={`Graphique — ${symbol.replace('/USDT','').replace('/USD','')}`}>
      <div className="space-y-3">

        {/* Barre de nav */}
        <div className="flex items-center gap-3">
          <Link href="/signals"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />Signaux
          </Link>
          <span className="text-gray-700">›</span>
          <span className="text-sm font-medium text-gray-300">{symbol.replace('/USDT','').replace('/USD','')}</span>
          <span className="text-xs text-gray-600">{timeframe}</span>
        </div>

        {/* Contrôles — ligne 1 : groupes + symboles */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
          {/* Tabs groupes */}
          <div className="flex gap-1">
            {SYMBOL_GROUPS.map(g => (
              <button key={g.label} onClick={() => setActiveGroup(g.label)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${activeGroup === g.label ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-500 hover:text-gray-300'}`}>
                {g.label}
              </button>
            ))}
          </div>
          {/* Symboles du groupe actif */}
          <div className="flex flex-wrap gap-1.5">
            {currentGroup.symbols.map(s => (
              <button key={s} onClick={() => changeSymbol(s)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${symbol === s ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'}`}>
                {s.replace('/USDT','').replace('/USD','')}
              </button>
            ))}
          </div>
        </div>

        {/* Contrôles — ligne 2 : TF + prix + signal + outils */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframes */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => changeTf(tf)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${timeframe === tf ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
                {tf}
              </button>
            ))}
          </div>

          {/* Prix live */}
          {refPrice && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg">
              <span className="text-xs text-gray-500">{symbol}</span>
              <span className="text-sm font-mono font-bold text-white">
                {refPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </span>
              {pctChg && (
                <span className={`text-xs font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{pctChg}%
                </span>
              )}
              {livePrice && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </div>
          )}

          {/* Signal actif */}
          {latestSignal && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg">
              <SignalBadge signal={latestSignal.signal} />
              <span className="text-xs text-gray-500">{Math.round(latestSignal.confidence)}%</span>
              <span className="text-xs text-gray-600">{latestSignal.timeframe}</span>
            </div>
          )}

          {/* Toggle indicateurs */}
          <button onClick={() => setShowIndicators(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showIndicators ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {showIndicators ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            EMA · BB
          </button>

          {/* Toggle niveaux SL/TP/EP */}
          {levels.length > 0 && (
            <button onClick={() => setShowLevels(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showLevels ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
              {showLevels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              SL · TP · EP
            </button>
          )}

          <DrawingToolbar
            active={activeTool}
            onChange={setActiveTool}
            onClearAll={() => setDrawings([])}
            drawingCount={drawings.length}
          />

          <button onClick={() => refetch()}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {/* Légende indicateurs */}
        {showIndicators && klines && klines.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <span className="flex items-center gap-1.5 text-xs"><span className="w-4 h-0.5 inline-block bg-amber-400" />EMA20</span>
            <span className="flex items-center gap-1.5 text-xs"><span className="w-4 h-0.5 inline-block bg-indigo-400" />EMA50</span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-4 h-0.5 inline-block bg-gray-500 border-dashed" />BB(20)</span>
            <span className="flex items-center gap-1.5 text-xs text-violet-400"><span className="w-4 h-0.5 inline-block bg-violet-400" />RSI(14)</span>
            {levels.length > 0 && showLevels && <>
              <span className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-4 h-0.5 inline-block bg-white/60" />Entry</span>
              <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-4 h-0.5 inline-block bg-red-400" />SL</span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-4 h-0.5 inline-block bg-emerald-400" />TP</span>
            </>}
          </div>
        )}

        {/* Chart principal */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {!klines || klines.length === 0 ? (
            <div className="h-96 flex items-center justify-center text-gray-600">
              {isFetching ? (
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
                  Chargement des données…
                </div>
              ) : <div className="text-center"><BarChart2 className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>Aucune donnée</p></div>}
            </div>
          ) : (
            <CandlestickChart
              data={klines}
              markers={markers}
              height={chartHeight}
              showVolume={true}
              activeTool={activeTool}
              drawings={drawings}
              onDrawingsChange={setDrawings}
              indicators={indicators}
              levels={showLevels ? levels : []}
              showRsi={showIndicators}
            />
          )}
        </div>

        {/* Tracés manuels */}
        {drawings.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 font-medium">Tracés ({drawings.length})</p>
            <div className="flex flex-wrap gap-2">
              {drawings.map(d => (
                <div key={d.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
                  style={{ borderColor: `${d.color}40`, background: `${d.color}10`, color: d.color }}>
                  <span className="capitalize">{d.type === 'hline' ? 'H-Line' : d.type === 'trendline' ? 'Trendline' : 'Zone'}</span>
                  {d.price && <span className="opacity-60">{d.price.toFixed(2)}</span>}
                  <button onClick={() => setDrawings(prev => prev.filter(x => x.id !== d.id))} className="ml-1 opacity-60 hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signaux récents */}
        {signals && signals.filter(s => s.asset?.symbol === symbol).length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 font-medium">Signaux récents — {symbol}</p>
            <div className="space-y-2">
              {signals.filter(s => s.asset?.symbol === symbol).slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SignalBadge signal={s.signal} />
                    <span className="text-gray-500 text-xs">{s.timeframe}</span>
                    <span className="text-gray-400 text-xs font-mono">{Math.round(s.confidence)}%</span>
                  </div>
                  <span className="text-gray-600 text-xs">
                    {new Date(s.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
