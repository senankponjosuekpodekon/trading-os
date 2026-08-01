'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AppLayout } from '@/components/layout/AppLayout';
import { OHLCBar, ChartMarker, Drawing, IndicatorSeries, PriceLevel, SmcZone } from '@/components/chart/CandlestickChart';
import { DrawingToolbar, DrawingTool } from '@/components/chart/DrawingToolbar';
import { Signal } from '@/types';
import { useTradingStore } from '@/store/trading.store';
import { api } from '@/lib/api';
import { RefreshCw, TrendingUp, TrendingDown, Minus, BarChart2, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const CandlestickChart = dynamic(
  () => import('@/components/chart/CandlestickChart').then(mod => mod.CandlestickChart),
  { ssr: false, loading: () => <div className="h-[500px] flex items-center justify-center text-gray-600">Chargement du graphique…</div> },
);

const SYMBOL_GROUPS = [
  { label: 'Crypto',   symbols: ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AVAX/USDT','XRP/USDT','LINK/USDT','ADA/USDT','DOGE/USDT','MATIC/USDT','PAXG/USDT'] },
  { label: 'Forex',    symbols: ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','USD/CAD','NZD/USD'] },
  { label: 'Matières', symbols: ['XAU/USD','XAG/USD','WTI/USD','BRENT/USD'] },
  { label: 'Deriv',    symbols: ['V75','V25','V10','V100','V50','BOOM1000','BOOM500','BOOM300','CRASH1000','CRASH500','CRASH300','JUMP75','JUMP25','JUMP50','JUMP10','JUMP100'] },
];
const ALL_SYMBOLS = SYMBOL_GROUPS.flatMap(g => g.symbols);
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

const SYM_BINANCE: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT', 'ETH/USDT': 'ETHUSDT', 'SOL/USDT': 'SOLUSDT',
  'BNB/USDT': 'BNBUSDT', 'AVAX/USDT': 'AVAXUSDT', 'XRP/USDT': 'XRPUSDT',
  'LINK/USDT': 'LINKUSDT', 'ADA/USDT': 'ADAUSDT', 'DOGE/USDT': 'DOGEUSDT',
  'MATIC/USDT': 'MATICUSDT', 'PAXG/USDT': 'PAXGUSDT',
};

const SYMBOL_TO_PRICE_KEY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SYM_BINANCE).map(([k, v]) => [k, v])),
  'EUR/USD': 'EUR/USD', 'GBP/USD': 'GBP/USD', 'USD/JPY': 'USD/JPY',
  'AUD/USD': 'AUD/USD', 'USD/CHF': 'USD/CHF', 'USD/CAD': 'USD/CAD', 'NZD/USD': 'NZD/USD',
  'XAU/USD': 'XAU/USD', 'XAG/USD': 'XAG/USD', 'WTI/USD': 'WTI/USD', 'BRENT/USD': 'BRENT/USD',
  'V10': 'V10', 'V25': 'V25', 'V50': 'V50', 'V75': 'V75', 'V100': 'V100',
  'BOOM1000': 'BOOM1000', 'BOOM500': 'BOOM500', 'BOOM300': 'BOOM300',
  'CRASH1000': 'CRASH1000', 'CRASH500': 'CRASH500', 'CRASH300': 'CRASH300',
  'JUMP10': 'JUMP10', 'JUMP25': 'JUMP25', 'JUMP50': 'JUMP50', 'JUMP75': 'JUMP75', 'JUMP100': 'JUMP100',
};


async function fetchKlines(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const { data } = await api.get('/indicators/klines', {
    params: { symbol, interval: timeframe, limit: 300 },
  });
  return (data.klines ?? []).map((k: any) => ({
    time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume ?? 0,
  }));
}

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

function calcBB(closes: number[], period = 20, k = 2) {
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

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine: number[] = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signal);
  const hist = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, hist };
}

function findPivots(data: OHLCBar[], left = 3, right = 3) {
  const highs: { index: number; time: number; price: number }[] = [];
  const lows: { index: number; time: number; price: number }[] = [];
  for (let i = left; i < data.length - right; i++) {
    const bar = data[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= left; j++) {
      if (data[i - j].high >= bar.high) isHigh = false;
      if (data[i - j].low <= bar.low) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (data[i + j].high >= bar.high) isHigh = false;
      if (data[i + j].low <= bar.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, time: bar.time as number, price: bar.high });
    if (isLow) lows.push({ index: i, time: bar.time as number, price: bar.low });
  }
  return { highs, lows };
}

function useStructureAnnotations(data: OHLCBar[] | undefined) {
  return useMemo<ChartMarker[]>(() => {
    if (!data || data.length < 10) return [];
    const { highs, lows } = findPivots(data);
    const markers: ChartMarker[] = [];
    for (let i = 1; i < highs.length; i++) {
      const prev = highs[i - 1].price;
      const cur = highs[i].price;
      const label = cur > prev ? 'HH' : 'LH';
      markers.push({
        time: highs[i].time,
        position: 'aboveBar',
        color: label === 'HH' ? '#34d399' : '#f87171',
        shape: 'arrowDown',
        text: label,
      });
    }
    for (let i = 1; i < lows.length; i++) {
      const prev = lows[i - 1].price;
      const cur = lows[i].price;
      const label = cur > prev ? 'HL' : 'LL';
      markers.push({
        time: lows[i].time,
        position: 'belowBar',
        color: label === 'LL' ? '#f87171' : '#34d399',
        shape: 'arrowUp',
        text: label,
      });
    }
    return markers;
  }, [data]);
}

function useLiquidityLevels(data: OHLCBar[] | undefined) {
  return useMemo<PriceLevel[]>(() => {
    if (!data || data.length < 20) return [];
    const tolerance = 0.001; // 0.1%
    const highClusters: { price: number; touches: number }[] = [];
    const lowClusters: { price: number; touches: number }[] = [];
    data.forEach(b => {
      const hMatch = highClusters.find(c => Math.abs(c.price - b.high) / c.price < tolerance);
      if (hMatch) { hMatch.touches++; hMatch.price = (hMatch.price + b.high) / 2; }
      else highClusters.push({ price: b.high, touches: 1 });

      const lMatch = lowClusters.find(c => Math.abs(c.price - b.low) / c.price < tolerance);
      if (lMatch) { lMatch.touches++; lMatch.price = (lMatch.price + b.low) / 2; }
      else lowClusters.push({ price: b.low, touches: 1 });
    });
    const levels: PriceLevel[] = [];
    highClusters.filter(c => c.touches >= 2).forEach((c, i) =>
      levels.push({ price: c.price, color: '#a78bfa', label: `EQH ${i + 1}`, style: 'dashed' })
    );
    lowClusters.filter(c => c.touches >= 2).forEach((c, i) =>
      levels.push({ price: c.price, color: '#f472b6', label: `EQL ${i + 1}`, style: 'dashed' })
    );
    return levels;
  }, [data]);
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === 'BUY')  return <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded"><TrendingUp className="w-3 h-3" />BUY</span>;
  if (signal === 'SELL') return <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded"><TrendingDown className="w-3 h-3" />SELL</span>;
  return <span className="flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-700 px-2 py-0.5 rounded"><Minus className="w-3 h-3" />NEUTRAL</span>;
}

interface ChartViewProps {
  initialSymbol?: string;
  initialTf?: string;
  mode: 'search' | 'dynamic';
}

export function ChartView({ initialSymbol, initialTf, mode }: ChartViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initSymbolFromSearch = mode === 'search' ? (searchParams.get('symbol') ?? 'BTC/USDT') : 'BTC/USDT';
  const initTfFromSearch = mode === 'search' ? (searchParams.get('tf') ?? '1h') : '1h';
  const defaultSymbol = ALL_SYMBOLS.includes(initialSymbol ?? '') ? initialSymbol! : ALL_SYMBOLS.includes(initSymbolFromSearch) ? initSymbolFromSearch : 'BTC/USDT';
  const defaultTf = TIMEFRAMES.includes(initialTf ?? '') ? initialTf! : TIMEFRAMES.includes(initTfFromSearch) ? initTfFromSearch : '1h';

  const [symbol,     setSymbol]     = useState(defaultSymbol);
  const [timeframe,  setTimeframe]  = useState(defaultTf);
  const [activeTool, setActiveTool] = useState<DrawingTool>('pointer');
  const [drawings,   setDrawings]   = useState<Drawing[]>([]);
  const [chartHeight, setChartHeight] = useState(500);
  const [showIndicators, setShowIndicators] = useState(true);
  const [showLevels,     setShowLevels]     = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showMacd,      setShowMacd]      = useState(false);
  const [showSmc,       setShowSmc]       = useState(false);
  const [showMtf,       setShowMtf]       = useState(false);
  const [activeGroup, setActiveGroup] = useState(
    SYMBOL_GROUPS.find(g => g.symbols.includes(symbol))?.label ?? SYMBOL_GROUPS[0].label
  );

  const prices  = useTradingStore(s => s.prices);

  useEffect(() => {
    const update = () => setChartHeight(window.innerWidth < 768 ? 320 : 520);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const updateUrl = useCallback((s: string, tf: string) => {
    if (mode === 'dynamic') {
      router.replace(`/chart/${encodeURIComponent(s)}?tf=${tf}`, { scroll: false });
    } else {
      router.replace(`/chart?symbol=${encodeURIComponent(s)}&tf=${tf}`, { scroll: false });
    }
  }, [router, mode]);

  const changeSymbol = useCallback((s: string) => {
    setSymbol(s);
    setActiveGroup(SYMBOL_GROUPS.find(g => g.symbols.includes(s))?.label ?? SYMBOL_GROUPS[0].label);
    updateUrl(s, timeframe);
  }, [timeframe, updateUrl]);

  const changeTf = useCallback((tf: string) => {
    setTimeframe(tf);
    updateUrl(symbol, tf);
  }, [symbol, updateUrl]);

  const { data: klines, isFetching, refetch } = useQuery<OHLCBar[]>({
    queryKey: ['klines', symbol, timeframe],
    queryFn:  () => fetchKlines(symbol, timeframe),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Multi-TF preview: determine higher timeframe
  const TF_ORDER = ['5m', '15m', '1h', '4h', '1d'];
  const htfIndex = Math.min(TF_ORDER.indexOf(timeframe) + 1, TF_ORDER.length - 1);
  const htf = TF_ORDER[htfIndex] !== timeframe ? TF_ORDER[htfIndex] : TF_ORDER[Math.min(htfIndex + 1, TF_ORDER.length - 1)];

  const { data: htfKlines } = useQuery<OHLCBar[]>({
    queryKey: ['klines', symbol, htf],
    queryFn:  () => fetchKlines(symbol, htf),
    staleTime: 120_000,
    refetchInterval: 120_000,
    enabled: showMtf,
  });

  const htfIndicators: IndicatorSeries = useMemo(() => {
    if (!htfKlines || htfKlines.length < 50) return {};
    const times  = htfKlines.map(b => b.time as number);
    const closes = htfKlines.map(b => b.close);
    const ema20v = calcEMA(closes, 20);
    const ema50v = calcEMA(closes, 50);
    return {
      ema20: times.map((t, i) => ({ time: t, value: ema20v[i] })),
      ema50: times.map((t, i) => ({ time: t, value: ema50v[i] })),
    };
  }, [htfKlines]);

  const signals = useTradingStore(s => s.signals) as Signal[];

  const signalMarkers: ChartMarker[] = useMemo(() => {
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

  const structureMarkers = useStructureAnnotations(klines);
  const liquidityLevels = useLiquidityLevels(klines);

  const indicators: IndicatorSeries = useMemo(() => {
    if (!klines || klines.length < 50) return {};
    const times  = klines.map(b => b.time as number);
    const closes = klines.map(b => b.close);
    const result: IndicatorSeries = {};

    if (showIndicators) {
      const ema20v = calcEMA(closes, 20);
      const ema50v = calcEMA(closes, 50);
      const bb     = calcBB(closes, 20);
      const rsiV   = calcRSI(closes, 14);
      result.ema20   = times.map((t, i) => ({ time: t, value: ema20v[i] }));
      result.ema50   = times.map((t, i) => ({ time: t, value: ema50v[i] }));
      result.bbUpper = times.map((t, i) => ({ time: t, value: bb.upper[i] })).filter(p => !isNaN(p.value));
      result.bbLower = times.map((t, i) => ({ time: t, value: bb.lower[i] })).filter(p => !isNaN(p.value));
      result.rsi     = times.map((t, i) => ({ time: t, value: rsiV[i] })).filter(p => !isNaN(p.value));
    }

    if (showMacd) {
      const macd = calcMACD(closes, 12, 26, 9);
      result.macd       = times.map((t, i) => ({ time: t, value: macd.macdLine[i] })).filter(p => !isNaN(p.value));
      result.macdSignal = times.map((t, i) => ({ time: t, value: macd.signalLine[i] })).filter(p => !isNaN(p.value));
      result.macdHist   = times.map((t, i) => ({ time: t, value: macd.hist[i] })).filter(p => !isNaN(p.value));
    }

    return result;
  }, [klines, showIndicators, showMacd]);

  const latestSignal = signals?.find(s => s.asset?.symbol === symbol);
  const signalLevels: PriceLevel[] = useMemo(() => {
    if (!latestSignal) return [];
    const out: PriceLevel[] = [];
    if (latestSignal.entryPrice)  out.push({ price: parseFloat(String(latestSignal.entryPrice)),  color: '#ffffff', label: 'Entry', style: 'dashed' });
    if (latestSignal.stopLoss)    out.push({ price: parseFloat(String(latestSignal.stopLoss)),    color: '#f87171', label: 'SL',    style: 'solid' });
    if (latestSignal.takeProfit1) out.push({ price: parseFloat(String(latestSignal.takeProfit1)), color: '#34d399', label: 'TP1',   style: 'solid' });
    if (latestSignal.takeProfit2) out.push({ price: parseFloat(String(latestSignal.takeProfit2)), color: '#6ee7b7', label: 'TP2',   style: 'dashed' });
    return out;
  }, [latestSignal]);

  const smcZones: SmcZone[] = useMemo(() => {
    if (!showSmc || !latestSignal?.metadata?.smc) return [];
    const smc = latestSignal.metadata.smc;
    const zones: SmcZone[] = [];
    // FVG zones
    const fvg = smc.fvg ?? {};
    (fvg.near_bullish_fvg ? [fvg.near_bullish_fvg] : []).forEach(z =>
      zones.push({ type: 'fvg', direction: 'bullish', top: z.top, bottom: z.bottom, mid: z.mid, label: 'Bull FVG' })
    );
    (fvg.near_bearish_fvg ? [fvg.near_bearish_fvg] : []).forEach(z =>
      zones.push({ type: 'fvg', direction: 'bearish', top: z.top, bottom: z.bottom, mid: z.mid, label: 'Bear FVG' })
    );
    // OB zones
    const ob = smc.ob ?? {};
    (ob.near_bullish_ob ? [ob.near_bullish_ob] : []).forEach(z =>
      zones.push({ type: 'ob', direction: 'bullish', top: z.top, bottom: z.bottom, mid: z.mid, label: 'Bull OB' })
    );
    (ob.near_bearish_ob ? [ob.near_bearish_ob] : []).forEach(z =>
      zones.push({ type: 'ob', direction: 'bearish', top: z.top, bottom: z.bottom, mid: z.mid, label: 'Bear OB' })
    );
    return zones;
  }, [latestSignal, showSmc]);

  const scenarioMarkers: ChartMarker[] = useMemo(() => {
    if (!latestSignal || !klines || klines.length === 0) return [];
    const lastTime = klines[klines.length - 1].time as number;
    return signalLevels.map(l => ({
      time: lastTime,
      position: l.label === 'SL' ? 'aboveBar' : 'belowBar',
      color: l.color,
      shape: 'circle',
      text: l.label,
    } as ChartMarker));
  }, [latestSignal, klines, signalLevels]);

  const allMarkers = useMemo(() => {
    const base = [...signalMarkers];
    if (showAnnotations) base.push(...structureMarkers);
    base.push(...scenarioMarkers);
    return base;
  }, [signalMarkers, structureMarkers, scenarioMarkers, showAnnotations]);

  const allLevels = useMemo(() => {
    const base = showLevels ? signalLevels : [];
    if (showAnnotations) base.push(...liquidityLevels);
    return base;
  }, [signalLevels, liquidityLevels, showLevels, showAnnotations]);

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
        <div className="flex items-center gap-3">
          <Link href="/signals" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />Signaux
          </Link>
          <span className="text-gray-700">›</span>
          <span className="text-sm font-medium text-gray-300">{symbol.replace('/USDT','').replace('/USD','')}</span>
          <span className="text-xs text-gray-600">{timeframe}</span>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2">
          <div className="flex gap-1">
            {SYMBOL_GROUPS.map(g => (
              <button key={g.label} onClick={() => setActiveGroup(g.label)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${activeGroup === g.label ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-500 hover:text-gray-300'}`}>
                {g.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {currentGroup.symbols.map(s => (
              <button key={s} onClick={() => changeSymbol(s)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${symbol === s ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'}`}>
                {s.replace('/USDT','').replace('/USD','')}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => changeTf(tf)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${timeframe === tf ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
                {tf}
              </button>
            ))}
          </div>

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

          {latestSignal && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg">
              <SignalBadge signal={latestSignal.signal} />
              <span className="text-xs text-gray-500">{Math.round(latestSignal.confidence)}%</span>
              <span className="text-xs text-gray-600">{latestSignal.timeframe}</span>
              {latestSignal.metadata?.ml_regime && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-sky-400/30 bg-sky-500/10 text-sky-200 text-[10px] font-mono uppercase">
                  Regime {latestSignal.metadata.ml_regime}
                </span>
              )}
            </div>
          )}

          <button onClick={() => setShowIndicators(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showIndicators ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {showIndicators ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            EMA · BB
          </button>

          {signalLevels.length > 0 && (
            <button onClick={() => setShowLevels(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showLevels ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
              {showLevels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              SL · TP · EP
            </button>
          )}

          <button onClick={() => setShowAnnotations(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showAnnotations ? 'bg-violet-500/10 border-violet-500/30 text-violet-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {showAnnotations ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Structure · Liq
          </button>

          <button onClick={() => setShowMacd(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showMacd ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {showMacd ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            MACD
          </button>

          {latestSignal?.metadata?.smc && (
            <button onClick={() => setShowSmc(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showSmc ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
              {showSmc ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              FVG · OB
            </button>
          )}

          <button onClick={() => setShowMtf(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${showMtf ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`}>
            {showMtf ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            MTF · {htf}
          </button>

          <DrawingToolbar active={activeTool} onChange={setActiveTool} onClearAll={() => setDrawings([])} drawingCount={drawings.length} />

          <button onClick={() => refetch()}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {showIndicators && klines && klines.length > 0 && (
          <div className="flex items-center gap-3 px-1 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs"><span className="w-4 h-0.5 inline-block bg-amber-400" />EMA20</span>
            <span className="flex items-center gap-1.5 text-xs"><span className="w-4 h-0.5 inline-block bg-indigo-400" />EMA50</span>
            <span className="flex items-center gap-1.5 text-xs text-gray-500"><span className="w-4 h-0.5 inline-block bg-gray-500 border-dashed" />BB(20)</span>
            <span className="flex items-center gap-1.5 text-xs text-violet-400"><span className="w-4 h-0.5 inline-block bg-violet-400" />RSI(14)</span>
            {showMacd && <>
              <span className="flex items-center gap-1.5 text-xs text-blue-400"><span className="w-4 h-0.5 inline-block bg-blue-400" />MACD</span>
              <span className="flex items-center gap-1.5 text-xs text-amber-400"><span className="w-4 h-0.5 inline-block bg-amber-400" />Signal</span>
            </>}
            {showSmc && smcZones.length > 0 && <>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-4 h-0.5 inline-block bg-emerald-400 border-dashed" />FVG</span>
              <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-4 h-0.5 inline-block bg-red-400 border-dashed" />OB</span>
            </>}
            {allLevels.length > 0 && <>
              <span className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-4 h-0.5 inline-block bg-white/60" />Entry</span>
              <span className="flex items-center gap-1.5 text-xs text-red-400"><span className="w-4 h-0.5 inline-block bg-red-400" />SL</span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-4 h-0.5 inline-block bg-emerald-400" />TP</span>
              <span className="flex items-center gap-1.5 text-xs text-violet-400"><span className="w-4 h-0.5 inline-block bg-violet-400" />EQH</span>
              <span className="flex items-center gap-1.5 text-xs text-pink-400"><span className="w-4 h-0.5 inline-block bg-pink-400" />EQL</span>
            </>}
          </div>
        )}

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
              markers={allMarkers}
              height={chartHeight}
              showVolume={true}
              activeTool={activeTool}
              drawings={drawings}
              onDrawingsChange={setDrawings}
              indicators={indicators}
              levels={allLevels}
              showRsi={showIndicators}
              showMacd={showMacd}
              smcZones={smcZones}
            />
          )}
        </div>

        {/* Multi-TF preview */}
        {showMtf && htfKlines && htfKlines.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
              <span className="text-xs font-medium text-cyan-400">Multi-TF · {htf}</span>
              <span className="text-xs text-gray-600">Confluence {symbol.replace('/USDT','').replace('/USD','')}</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-3 h-0.5 inline-block bg-amber-400" />EMA20</span>
                <span className="flex items-center gap-1 text-[10px] text-gray-500"><span className="w-3 h-0.5 inline-block bg-indigo-400" />EMA50</span>
              </div>
            </div>
            <CandlestickChart
              data={htfKlines}
              height={200}
              showVolume={false}
              indicators={htfIndicators}
              showRsi={false}
              showMacd={false}
            />
          </div>
        )}

        {drawings.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 font-medium">Tracés ({drawings.length})</p>
            <div className="flex flex-wrap gap-2">
              {drawings.map(d => (
                <div key={d.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
                  style={{ borderColor: `${d.color}40`, background: `${d.color}10`, color: d.color }}>
                  <span className="capitalize">{d.type === 'hline' ? 'H-Line' : d.type === 'trendline' ? 'Trendline' : d.type === 'fib' ? 'Fibonacci' : 'Zone'}</span>
                  {d.price && <span className="opacity-60">{d.price.toFixed(2)}</span>}
                  <button onClick={() => setDrawings(prev => prev.filter(x => x.id !== d.id))} className="ml-1 opacity-60 hover:opacity-100">
                    <Minus className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
                    {s.metadata?.ml_regime && (
                      <span className="text-[10px] font-mono text-sky-200 px-1.5 py-0.5 rounded border border-sky-400/30 bg-sky-500/10 uppercase">
                        {s.metadata.ml_regime}
                      </span>
                    )}
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
