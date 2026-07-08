'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, Globe } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import axios from 'axios';

const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8000';

interface BrvmQuote {
  symbol: string; name: string; price: number;
  change: number; change_pct: number; volume: number;
  signal?: string; confidence?: number; reasons?: string;
}

function Pct({ v }: { v: number }) {
  const c = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-500';
  return <span className={`font-mono text-sm font-semibold ${c}`}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

export default function BrvmPage() {
  const qc = useQueryClient();

  const { data: scan, isLoading, refetch } = useQuery({
    queryKey: ['brvm-scan'],
    queryFn: async () => (await axios.post(`${ENGINE}/brvm/scan`, {})).data,
    refetchInterval: 5 * 60_000,
  });

  const { data: movers } = useQuery({
    queryKey: ['brvm-movers'],
    queryFn: async () => (await axios.get(`${ENGINE}/brvm/top-movers`)).data,
    refetchInterval: 5 * 60_000,
  });

  const results: BrvmQuote[] = scan?.results ?? [];
  const buys  = results.filter(r => r.signal === 'BUY');
  const sells = results.filter(r => r.signal === 'SELL');

  return (
    <AppLayout title="BRVM">
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-white font-semibold">Bourse Régionale des Valeurs Mobilières</h2>
              <p className="text-gray-500 text-xs">UEMOA — cotations en XOF
                {scan && <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${scan.source === 'live' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  {scan.source === 'live' ? '⬤ Live' : '◎ Demo'}
                </span>}
              </p>
            </div>
          </div>
          <button onClick={() => refetch()} disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Actualiser
          </button>
        </div>

        {/* Statistiques */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Titres suivis',   value: results.length },
            { label: 'Signaux BUY',     value: buys.length,  color: 'text-emerald-400' },
            { label: 'Signaux SELL',    value: sells.length, color: 'text-red-400' },
            { label: 'Source données',  value: scan?.source === 'live' ? 'Live' : 'Demo' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color ?? 'text-white'}`}>{s.value ?? '…'}</p>
            </div>
          ))}
        </div>

        {/* Top movers */}
        {movers && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />Top hausses
              </h3>
              <div className="space-y-2">
                {movers.top_gainers?.slice(0, 5).map((q: BrvmQuote) => (
                  <div key={q.symbol} className="flex items-center justify-between">
                    <div><p className="text-white text-sm font-medium">{q.symbol}</p><p className="text-gray-500 text-xs">{q.name}</p></div>
                    <div className="text-right">
                      <p className="text-white text-sm font-mono">{q.price.toLocaleString()} XOF</p>
                      <Pct v={q.change_pct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5" />Top baisses
              </h3>
              <div className="space-y-2">
                {movers.top_losers?.slice(0, 5).reverse().map((q: BrvmQuote) => (
                  <div key={q.symbol} className="flex items-center justify-between">
                    <div><p className="text-white text-sm font-medium">{q.symbol}</p><p className="text-gray-500 text-xs">{q.name}</p></div>
                    <div className="text-right">
                      <p className="text-white text-sm font-mono">{q.price.toLocaleString()} XOF</p>
                      <Pct v={q.change_pct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tableau complet */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/50">
                {['Symbole', 'Nom', 'Prix (XOF)', 'Variation', 'Volume', 'Signal', 'Raisons'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600">
                  <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Chargement BRVM…
                </td></tr>
              )}
              {results.map(q => (
                <tr key={q.symbol} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-bold text-white">{q.symbol}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-32 truncate">{q.name}</td>
                  <td className="px-4 py-3 font-mono text-white">{q.price.toLocaleString()}</td>
                  <td className="px-4 py-3"><Pct v={q.change_pct} /></td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{q.volume.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {q.signal === 'BUY'  && <span className="flex items-center gap-1 text-emerald-400 text-xs font-bold"><TrendingUp className="w-3 h-3"/>BUY</span>}
                    {q.signal === 'SELL' && <span className="flex items-center gap-1 text-red-400 text-xs font-bold"><TrendingDown className="w-3 h-3"/>SELL</span>}
                    {q.signal === 'WATCH' && <span className="flex items-center gap-1 text-gray-500 text-xs"><Minus className="w-3 h-3"/>WATCH</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-48 truncate" title={q.reasons}>{q.reasons ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
