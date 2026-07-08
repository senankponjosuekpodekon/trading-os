'use client';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AppLayout } from '@/components/layout/AppLayout';
import { CandlestickChart, OHLCBar, ChartMarker, Drawing } from '@/components/chart/CandlestickChart';
import { DrawingToolbar, DrawingTool } from '@/components/chart/DrawingToolbar';
import { api } from '@/lib/api';
import { Signal } from '@/types';
import { RefreshCw, TrendingUp, TrendingDown, Minus, X } from 'lucide-react';

const SYMBOLS    = [
  'BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT',
  'AVAX/USDT','XRP/USDT','LINK/USDT','ADA/USDT',
  'EUR/USDT','PAXG/USDT',
];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'];

const SYM_BINANCE: Record<string, string> = {
  'BTC/USDT':  'BTCUSDT',  'ETH/USDT':  'ETHUSDT',
  'SOL/USDT':  'SOLUSDT',  'BNB/USDT':  'BNBUSDT',
  'AVAX/USDT': 'AVAXUSDT', 'XRP/USDT':  'XRPUSDT',
  'LINK/USDT': 'LINKUSDT', 'ADA/USDT':  'ADAUSDT',
  'EUR/USDT':  'EURUSDT',  'PAXG/USDT': 'PAXGUSDT',
};

async function fetchKlines(symbol: string, timeframe: string): Promise<OHLCBar[]> {
  const binSym = SYM_BINANCE[symbol] ?? 'BTCUSDT';
  const url = `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${timeframe}&limit=300`;
  const { data } = await axios.get(url);
  return data.map((k: any[]) => ({
    time:   Math.floor(k[0] / 1000),
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === 'BUY')  return <span className="flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded"><TrendingUp className="w-3 h-3" />BUY</span>;
  if (signal === 'SELL') return <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded"><TrendingDown className="w-3 h-3" />SELL</span>;
  return <span className="flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-700 px-2 py-0.5 rounded"><Minus className="w-3 h-3" />NEUTRAL</span>;
}

export default function ChartPage() {
  const [symbol,    setSymbol]    = useState('BTC/USDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [activeTool, setActiveTool] = useState<DrawingTool>('pointer');
  const [drawings,   setDrawings]   = useState<Drawing[]>([]);

  // Klines Binance
  const { data: klines, isFetching, refetch } = useQuery<OHLCBar[]>({
    queryKey: ['klines', symbol, timeframe],
    queryFn:  () => fetchKlines(symbol, timeframe),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // Signaux enregistrés pour cet actif
  const { data: signals } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn:  async () => (await api.get('/signals?limit=100')).data,
    staleTime: 30_000,
  });

  // Filtrer les signaux pour le symbole courant et construire les markers
  const markers: ChartMarker[] = useMemo(() => {
    if (!signals || !klines || klines.length === 0) return [];
    const symSignals = signals.filter(s => s.asset?.symbol === symbol);
    return symSignals
      .map(s => {
        const ts = Math.floor(new Date(s.createdAt).getTime() / 1000);
        // Trouver la bougie la plus proche
        const bar = klines.reduce((prev, cur) =>
          Math.abs((cur.time as number) - ts) < Math.abs((prev.time as number) - ts) ? cur : prev
        );
        return {
          time:     bar.time,
          position: s.signal === 'BUY' ? 'belowBar' : 'aboveBar',
          color:    s.signal === 'BUY' ? '#34d399' : '#f87171',
          shape:    s.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
          text:     `${s.signal} ${Math.round(s.confidence)}%`,
        } as ChartMarker;
      })
      .filter(Boolean);
  }, [signals, klines, symbol]);

  // Dernière bougie
  const lastBar = klines?.[klines.length - 1];
  const prevBar = klines?.[klines.length - 2];
  const pctChg  = lastBar && prevBar
    ? ((lastBar.close - prevBar.close) / prevBar.close * 100).toFixed(2)
    : null;
  const isUp = lastBar && prevBar ? lastBar.close >= prevBar.close : null;

  // Signal actif le plus récent pour ce symbole
  const latestSignal = signals?.find(s => s.asset?.symbol === symbol);

  return (
    <AppLayout title="Graphique">
      <div className="space-y-4">

        {/* Contrôles */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Sélecteur symbole */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {SYMBOLS.map(s => (
              <button key={s} onClick={() => setSymbol(s)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${symbol === s ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
                {s.replace('/USDT', '')}
              </button>
            ))}
          </div>

          {/* Sélecteur timeframe */}
          <div className="flex bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {TIMEFRAMES.map(tf => (
              <button key={tf} onClick={() => setTimeframe(tf)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${timeframe === tf ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'}`}>
                {tf}
              </button>
            ))}
          </div>

          {/* Prix live */}
          {lastBar && (
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-900 border border-gray-800 rounded-lg">
              <span className="text-sm text-gray-400">{symbol}</span>
              <span className="text-base font-mono font-bold text-white">
                ${lastBar.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {pctChg && (
                <span className={`text-xs font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? '+' : ''}{pctChg}%
                </span>
              )}
            </div>
          )}

          {/* Signal actif */}
          {latestSignal && (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg">
              <SignalBadge signal={latestSignal.signal} />
              <span className="text-xs text-gray-500">{Math.round(latestSignal.confidence)}% conf.</span>
              <span className="text-xs text-gray-600">{latestSignal.timeframe}</span>
            </div>
          )}

          <DrawingToolbar
            active={activeTool}
            onChange={setActiveTool}
            onClearAll={() => setDrawings([])}
            drawingCount={drawings.length}
          />

          <button onClick={() => refetch()}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {/* Chart principal */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {!klines || klines.length === 0 ? (
            <div className="h-96 flex items-center justify-center text-gray-600">
              {isFetching ? (
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin" />
                  Chargement des données…
                </div>
              ) : 'Aucune donnée'}
            </div>
          ) : (
            <CandlestickChart
              data={klines}
              markers={markers}
              height={500}
              showVolume={true}
              activeTool={activeTool}
              drawings={drawings}
              onDrawingsChange={setDrawings}
            />
          )}
        </div>

        {/* Liste des tracés */}
        {drawings.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 font-medium">Tracés ({drawings.length})</p>
            <div className="flex flex-wrap gap-2">
              {drawings.map(d => (
                <div key={d.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs"
                  style={{ borderColor: `${d.color}40`, background: `${d.color}10`, color: d.color }}>
                  <span className="capitalize">{d.type === 'hline' ? 'H-Line' : d.type === 'trendline' ? 'Trendline' : 'Zone'}</span>
                  {d.price && <span className="opacity-60">{d.price.toFixed(2)}</span>}
                  <button onClick={() => setDrawings(prev => prev.filter(x => x.id !== d.id))}
                    className="ml-1 opacity-60 hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Niveaux clés */}
        {latestSignal && (latestSignal.entryPrice || latestSignal.stopLoss || latestSignal.takeProfit1) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Entry', value: latestSignal.entryPrice, color: 'text-white' },
              { label: 'Stop Loss', value: latestSignal.stopLoss, color: 'text-red-400' },
              { label: 'TP1', value: latestSignal.takeProfit1, color: 'text-emerald-400' },
              { label: 'TP2', value: latestSignal.takeProfit2, color: 'text-emerald-300' },
            ].filter(l => l.value).map(l => (
              <div key={l.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{l.label}</p>
                <p className={`text-base font-mono font-bold ${l.color}`}>
                  ${parseFloat(String(l.value)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Signaux récents pour cet actif */}
        {signals && signals.filter(s => s.asset?.symbol === symbol).length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 font-medium">Signaux récents — {symbol}</p>
            <div className="space-y-2">
              {signals.filter(s => s.asset?.symbol === symbol).slice(0, 5).map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <SignalBadge signal={s.signal} />
                    <span className="text-gray-500 text-xs">{s.timeframe}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-xs font-mono">{Math.round(s.confidence)}% conf.</span>
                    <span className="text-gray-600 text-xs">
                      {new Date(s.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
