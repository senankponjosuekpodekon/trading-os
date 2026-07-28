'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { SignalCard } from '@/components/signals/SignalCard';
import { api } from '@/lib/api';
import { Signal } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useTradingStore } from '@/store/trading.store';
import {
  Search, RefreshCw, Zap, TrendingUp, TrendingDown, Minus, Activity
} from 'lucide-react';

const TIMEFRAMES = ['all', '15m', '1h', '4h', '1d'];
const DIRECTIONS = ['all', 'BUY', 'SELL', 'NEUTRAL'];
const ASSETS = ['all', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'EUR/USD', 'XAU/USD'];

export default function ScannerPage() {
  const { toast } = useToast();
  const prices = useTradingStore(s => s.prices);
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState('all');
  const [direction, setDirection] = useState('all');
  const [asset, setAsset] = useState('all');
  const [minConf, setMinConf] = useState(50);

  const { data: signals, isLoading, refetch } = useQuery<Signal[]>({
    queryKey: ['signals', 'scanner'],
    queryFn: async () => (await api.get('/signals?limit=50')).data.data,
  });

  const scan = useMutation({
    mutationFn: async () => (await api.post('/signals/scan', { symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'EUR/USD', 'XAU/USD'] })).data,
    onSuccess: () => {
      refetch();
      toast('Scan terminé', { type: 'success' });
    },
    onError: () => toast('Erreur lors du scan', { type: 'error' }),
  });

  const filtered = useMemo(() => {
    if (!signals) return [];
    return signals
      .filter(s => {
        if (s.confidence < minConf) return false;
        if (direction !== 'all' && s.signal !== direction) return false;
        if (timeframe !== 'all' && s.timeframe !== timeframe) return false;
        if (asset !== 'all' && s.asset?.symbol !== asset) return false;
        if (query && !s.asset?.symbol.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => computeOpportunityScore(b) - computeOpportunityScore(a));
  }, [signals, minConf, direction, timeframe, asset, query]);

function computeOpportunityScore(s: Signal): number {
  const conf = s.confidence ?? 50;
  const rr = s.riskReward ? parseFloat(String(s.riskReward)) : 2;
  const mtf = s.metadata?.mtf_context ?? {};
  const mtfBonus = mtf.confluence === 'FULL' ? 1.25 : mtf.confluence === 'PARTIAL' ? 1 : 0.85;
  return Math.round(Math.min(100, conf * Math.min(rr, 5) * mtfBonus / 2));
}

  const counts = useMemo(() => {
    const buy = filtered.filter(s => s.signal === 'BUY').length;
    const sell = filtered.filter(s => s.signal === 'SELL').length;
    const neutral = filtered.filter(s => s.signal === 'NEUTRAL').length;
    return { buy, sell, neutral };
  }, [filtered]);

  return (
    <AppLayout title="Scanner">
      <div className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Search className="w-5 h-5 text-emerald-400" />Scanner
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Filtrer et lancer des scans sur plusieurs marchés</p>
          </div>
          <button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {scan.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Lancer un scan
          </button>
        </div>

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
            <Select label="Actif" value={asset} onChange={setAsset} options={ASSETS} />
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

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <CountBadge icon={<TrendingUp className="w-3 h-3" />} label="BUY" count={counts.buy} color="text-emerald-400 bg-emerald-400/10 border-emerald-400/20" />
            <CountBadge icon={<TrendingDown className="w-3 h-3" />} label="SELL" count={counts.sell} color="text-red-400 bg-red-400/10 border-red-400/20" />
            <CountBadge icon={<Minus className="w-3 h-3" />} label="NEUTRAL" count={counts.neutral} color="text-gray-400 bg-gray-800 border-gray-700" />
            <span className="ml-auto text-gray-500">{filtered.length} résultat(s)</span>
          </div>
        </div>

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
            <button onClick={() => scan.mutate()} disabled={scan.isPending} className="mt-4 text-emerald-400 text-sm hover:underline">
              Lancer un scan maintenant
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(s => <SignalCard key={s.id} signal={s} prices={prices} />)}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
      >
        {options.map(o => <option key={o} value={o}>{o === 'all' ? 'Tous' : o}</option>)}
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
