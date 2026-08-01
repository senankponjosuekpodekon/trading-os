'use client';
import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, Activity, AlertCircle, BarChart2, CheckSquare, Square, Wifi, WifiOff } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useTradingStore } from '@/store/trading.store';
import { api } from '@/lib/api';

interface ScalpResult {
  symbol: string; label?: string; category?: string;
  signal: string; confidence: number; score: number; reasons: string;
  last_price?: number; source: string;
  indicators: { close: number; ema8: number; ema21: number; rsi: number; bb_upper: number; bb_lower: number; bb_mid: number; };
}

interface ScalpResponse {
  action: string;
  trade?: { symbol: string; contract_type: string; stake: number; duration: number; };
  analysis: ScalpResult;
  source: string;
  note?: string;
}

interface MultiAnalyzeResponse {
  count: number;
  results: ScalpResult[];
}

const SYMBOL_GROUPS: Record<string, { label: string; color: string; symbols: { id: string; name: string }[] }> = {
  volatility: {
    label: 'Volatility Indices', color: 'blue',
    symbols: [
      { id: 'R_10',  name: 'V10'  }, { id: 'R_25', name: 'V25' },
      { id: 'R_50',  name: 'V50'  }, { id: 'R_75', name: 'V75' },
      { id: 'R_100', name: 'V100' },
    ],
  },
  boom_crash: {
    label: 'Boom & Crash', color: 'yellow',
    symbols: [
      { id: 'BOOM300',   name: 'Boom 300'   }, { id: 'BOOM500',   name: 'Boom 500'   }, { id: 'BOOM1000',  name: 'Boom 1000'  },
      { id: 'CRASH300',  name: 'Crash 300'  }, { id: 'CRASH500',  name: 'Crash 500'  }, { id: 'CRASH1000', name: 'Crash 1000' },
    ],
  },
  jump: {
    label: 'Jump Indices', color: 'purple',
    symbols: [
      { id: 'JD10', name: 'Jump 10' }, { id: 'JD25', name: 'Jump 25' },
      { id: 'JD50', name: 'Jump 50' }, { id: 'JD75', name: 'Jump 75' },
      { id: 'JD100', name: 'Jump 100' },
    ],
  },
  step: {
    label: 'Step Index', color: 'emerald',
    symbols: [{ id: 'STPRNG', name: 'Step Index' }],
  },
};

const COLOR_MAP: Record<string, string> = {
  blue: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  yellow: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  purple: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  emerald: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
};


function SignalChip({ signal, size = 'sm' }: { signal: string; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'text-lg gap-1.5' : 'text-xs gap-1';
  if (signal === 'CALL') return <span className={`flex items-center font-bold text-emerald-400 ${cls}`}><TrendingUp className={size === 'lg' ? 'w-5 h-5' : 'w-3 h-3'} />CALL ↑</span>;
  if (signal === 'PUT')  return <span className={`flex items-center font-bold text-red-400 ${cls}`}><TrendingDown className={size === 'lg' ? 'w-5 h-5' : 'w-3 h-3'} />PUT ↓</span>;
  return <span className={`flex items-center font-bold text-gray-500 ${cls}`}><Minus className={size === 'lg' ? 'w-5 h-5' : 'w-3 h-3'} />WAIT</span>;
}

const MARKET_TICKERS = [
  { key: 'BTCUSDT', label: 'BTC' },
  { key: 'ETHUSDT', label: 'ETH' },
  { key: 'EURUSDT', label: 'EUR/USD' },
  { key: 'PAXGUSDT', label: 'Gold' },
];

export default function DerivPage() {
  const prices    = useTradingStore(s => s.prices);
  const connected = useTradingStore(s => s.wsConnected);
  const [stake, setStake]         = useState(1);
  const [duration, setDuration]   = useState(5);
  const [result, setResult]       = useState<ScalpResponse | null>(null);
  const [selectedSyms, setSelectedSyms] = useState<string[]>(['R_75', 'BOOM1000', 'CRASH1000']);
  const [activeTab, setActiveTab] = useState<'multi' | 'scalp'>('multi');

  const toggleSym = (id: string) =>
    setSelectedSyms(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  const { data: health } = useQuery({
    queryKey: ['deriv-health'],
    queryFn:  async () => (await api.get('/deriv/health')).data,
    refetchInterval: 30_000,
  });

  const multiScan = useMutation({
    mutationFn: async () => (await api.post('/deriv/multi-analyze', {
      symbols: selectedSyms, count: 100,
    })).data as MultiAnalyzeResponse,
  });

  const scalp = useMutation({
    mutationFn: async () => (await api.post('/deriv/scalp', {
      symbol: selectedSyms[0] ?? 'R_75', stake, duration, bars: 100,
    })).data as ScalpResponse,
    onSuccess: (data) => setResult(data),
  });

  const scanResults = multiScan.data?.results ?? [];

  const callCount  = scanResults.filter(r => r.signal === 'CALL').length;
  const putCount   = scanResults.filter(r => r.signal === 'PUT').length;
  const waitCount  = scanResults.filter(r => r.signal === 'WAIT').length;

  return (
    <AppLayout title="Deriv Indices">
      <div className="space-y-4">

        {/* Prix live marchés de référence */}
        <div className="flex flex-wrap items-center gap-2">
          {MARKET_TICKERS.map(({ key, label }) => {
            const price = prices[key];
            return (
              <div key={key} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg">
                <span className="text-xs text-gray-500 font-medium">{label}</span>
                <span className="text-sm font-mono font-semibold text-white">
                  {price ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
              </div>
            );
          })}
          <div className="flex items-center gap-1.5 px-2 text-xs ml-auto" title={connected ? 'Flux live actif' : 'Déconnecté'}>
            {connected
              ? <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">LIVE</span></>
              : <><WifiOff className="w-3.5 h-3.5 text-gray-600" /><span className="text-gray-600">OFF</span></>}
          </div>
        </div>

        {/* Status bar */}
        <div className={`flex items-center gap-3 p-3 rounded-xl border text-sm ${
          health === undefined
            ? 'bg-gray-800 border-gray-700 text-gray-500'
            : health?.api_live
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
        }`}>
          <Activity className="w-4 h-4 shrink-0" />
          {health === undefined ? (
            <span className="font-medium animate-pulse">Vérification de l'API Deriv…</span>
          ) : (
            <span className="font-medium">{health?.api_live ? '⬤ API Deriv connectée' : '◎ Mode démo (API inaccessible)'}</span>
          )}
          {!health?.token_configured && (
            <span className="ml-auto text-xs opacity-70">DERIV_API_TOKEN manquant — paper trade uniquement</span>
          )}
        </div>

        {/* Onglets */}
        <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
          {(['multi', 'scalp'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === t ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white'
              }`}>
              {t === 'multi' ? <><BarChart2 className="w-3.5 h-3.5 inline mr-1.5" />Multi-scan</> : <><Zap className="w-3.5 h-3.5 inline mr-1.5" />Scalp</>}
            </button>
          ))}
        </div>

        {/* Sélecteur de symboles */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium mb-3">Sélection des indices ({selectedSyms.length})</p>
          <div className="space-y-3">
            {Object.entries(SYMBOL_GROUPS).map(([key, grp]) => (
              <div key={key}>
                <p className={`text-xs font-medium mb-1.5 ${COLOR_MAP[grp.color].split(' ')[0]}`}>{grp.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {grp.symbols.map(s => {
                    const on = selectedSyms.includes(s.id);
                    return (
                      <button key={s.id} onClick={() => toggleSym(s.id)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                          on ? `${COLOR_MAP[grp.color]}` : 'border-gray-700 text-gray-500 hover:text-gray-300'
                        }`}>
                        {on ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Onglet Multi-scan */}
        {activeTab === 'multi' && (
          <>
            <button onClick={() => multiScan.mutate()} disabled={multiScan.isPending || selectedSyms.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors">
              {multiScan.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" />Scan en cours…</>
                : <><BarChart2 className="w-4 h-4" />Analyser {selectedSyms.length} indice{selectedSyms.length > 1 ? 's' : ''}</>}
            </button>

            {scanResults.length > 0 && (
              <>
                {/* Résumé */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'CALL ↑', count: callCount,  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
                    { label: 'PUT ↓',  count: putCount,   color: 'text-red-400 bg-red-400/10 border-red-400/20' },
                    { label: 'WAIT',   count: waitCount,  color: 'text-gray-400 bg-gray-800 border-gray-700' },
                  ].map(s => (
                    <div key={s.label} className={`border rounded-xl p-3 text-center ${s.color}`}>
                      <p className="text-2xl font-bold">{s.count}</p>
                      <p className="text-xs mt-0.5 opacity-70">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Résultats par catégorie */}
                {Object.entries(SYMBOL_GROUPS).map(([cat, grp]) => {
                  const catResults = scanResults.filter(r => r.category === cat);
                  if (!catResults.length) return null;
                  return (
                    <div key={cat} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                      <div className={`px-4 py-2.5 border-b border-gray-800 flex items-center gap-2 ${COLOR_MAP[grp.color].split(' ')[0]}`}>
                        <span className="text-xs font-semibold">{grp.label}</span>
                        <span className="text-xs opacity-50">{catResults.length} indices</span>
                      </div>
                      <div className="divide-y divide-gray-800/50">
                        {catResults.map(r => (
                          <div key={r.symbol} className="flex items-center gap-3 px-4 py-3">
                            <div className="w-20 shrink-0">
                              <p className="text-xs font-mono font-semibold text-white">{r.symbol}</p>
                              <p className="text-xs text-gray-600">{r.label}</p>
                            </div>
                            <SignalChip signal={r.signal} />
                            <div className="flex-1 mx-2">
                              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${
                                  r.signal === 'CALL' ? 'bg-emerald-500' :
                                  r.signal === 'PUT'  ? 'bg-red-500' : 'bg-gray-600'
                                }`} style={{ width: `${r.confidence}%` }} />
                              </div>
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">{r.confidence}%</span>
                            {r.last_price !== undefined && (
                              <span className="text-xs font-mono text-gray-500 w-24 text-right">{r.last_price.toLocaleString()}</span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${r.source === 'live' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-gray-700 text-gray-500'}`}>
                              {r.source}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {!multiScan.data && !multiScan.isPending && (
              <div className="text-center py-10 text-gray-600 text-sm">
                Sélectionnez des indices et cliquez sur Analyser
              </div>
            )}
          </>
        )}

        {/* Onglet Scalp */}
        {activeTab === 'scalp' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 max-w-md">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-yellow-400" />
              <h2 className="text-white font-semibold">Scalp — {selectedSyms[0] ?? 'R_75'}</h2>
            </div>

            <div className="space-y-4 mb-5">
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">Mise (USD)</label>
                <div className="flex gap-2">
                  {[0.5, 1, 2, 5].map(v => (
                    <button key={v} onClick={() => setStake(v)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${stake === v ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                      ${v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1.5">Durée (minutes)</label>
                <div className="flex gap-2">
                  {[1, 3, 5, 10].map(v => (
                    <button key={v} onClick={() => setDuration(v)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${duration === v ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                      {v}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button onClick={() => scalp.mutate()} disabled={scalp.isPending}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors">
              {scalp.isPending ? <><RefreshCw className="w-4 h-4 animate-spin" />Analyse…</> : <><Zap className="w-4 h-4" />Analyser & Scalper</>}
            </button>

            {!health?.token_configured && (
              <div className="flex items-start gap-2 mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-400">Mode paper — ajoutez DERIV_API_TOKEN pour des trades réels.</p>
              </div>
            )}

            {result && (
              <div className={`mt-4 p-4 rounded-xl border ${
                result.action === 'NONE' ? 'bg-gray-800/50 border-gray-700' :
                result.analysis?.signal === 'CALL' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'
              }`}>
                {result.action === 'NONE' ? (
                  <p className="text-gray-400 text-sm">⏸ Signal trop faible — attendre</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <SignalChip signal={result.trade?.contract_type ?? result.analysis?.signal} size="lg" />
                      <span className="text-xs text-gray-500">{result.action === 'PAPER' ? '📄 Paper' : result.action === 'PLACED' ? '✅ Placé' : result.action}</span>
                    </div>
                    {result.trade && (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {[
                          { label: 'Mise',      value: `$${result.trade.stake}` },
                          { label: 'Durée',     value: `${result.trade.duration}min` },
                          { label: 'Confiance', value: `${result.analysis?.confidence}%` },
                        ].map(s => (
                          <div key={s.label} className="bg-gray-800/50 rounded p-2 text-center">
                            <p className="text-xs text-gray-500 mb-0.5">{s.label}</p>
                            <p className="text-white text-xs font-semibold">{s.value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-2">{result.analysis?.reasons}</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
