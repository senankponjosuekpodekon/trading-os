'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Globe, TrendingUp, TrendingDown, RefreshCw, BarChart3 } from 'lucide-react';

interface AfricaQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  exchange?: string;
}

export default function AfricaPage() {
  const [market, setMarket] = useState('jse');

  const { data: quotes, isLoading } = useQuery({
    queryKey: ['africa-quotes'],
    queryFn: async () => (await api.get('/africa/quotes')).data,
    staleTime: 300_000,
  });

  const { data: movers } = useQuery({
    queryKey: ['africa-top-movers'],
    queryFn: async () => (await api.get('/africa/top-movers')).data,
    staleTime: 300_000,
  });

  const { data: scan, refetch: refetchScan, isLoading: scanLoading } = useQuery({
    queryKey: ['africa-scan', market],
    queryFn: async () => (await api.post('/africa/scan', { market })).data,
    staleTime: 600_000,
    enabled: false,
  });

  const quoteList: AfricaQuote[] = quotes?.results || quotes || [];
  const scanResults: AfricaQuote[] = scan?.results || [];

  return (
    <AppLayout title="African Markets">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="w-6 h-6 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold text-white">African Markets</h1>
              <p className="text-sm text-gray-400">JSE, NGX, NSE, GSE and BRVM quotes</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 bg-gray-900 border border-gray-800 rounded-xl">
          <span className="text-sm text-gray-500">Exchange:</span>
          {['jse', 'ngx', 'nse', 'gse', 'brvm'].map((m) => (
            <button
              key={m}
              onClick={() => { setMarket(m); refetchScan(); }}
              className={`px-3 py-1 rounded text-xs font-medium transition ${
                market === m ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-gray-500 text-sm">Loading quotes…</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs">Symbols</p>
            <p className="text-2xl font-bold text-white">{quoteList.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs">Gainers</p>
            <p className="text-2xl font-bold text-emerald-400">{quoteList.filter((q) => q.change_pct > 0).length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs">Losers</p>
            <p className="text-2xl font-bold text-red-400">{quoteList.filter((q) => q.change_pct < 0).length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-500 text-xs">Data source</p>
            <p className="text-2xl font-bold text-white">{quotes?.source || 'Live'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Quotes</h3>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900 z-10">
                  <tr className="border-b border-gray-800">
                    {['Symbol', 'Name', 'Price', 'Change', 'Volume'].map((h) => <th key={h} className="px-4 py-2 text-left text-gray-500 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {quoteList.slice(0, 50).map((q: AfricaQuote) => (
                    <tr key={q.symbol} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2 font-bold text-white">{q.symbol}</td>
                      <td className="px-4 py-2 text-gray-400 truncate max-w-32">{q.name}</td>
                      <td className="px-4 py-2 text-white font-mono">{q.price.toLocaleString()}</td>
                      <td className={`px-4 py-2 font-mono ${q.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2 text-gray-400 font-mono">{q.volume.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Top Movers
            </h3>
            <div className="space-y-2">
              {(movers?.top_gainers || []).slice(0, 5).map((q: AfricaQuote) => (
                <div key={q.symbol} className="flex items-center justify-between p-2 bg-gray-800/30 rounded">
                  <div>
                    <p className="text-white text-sm font-medium">{q.symbol}</p>
                    <p className="text-gray-500 text-xs">{q.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-emerald-400 text-sm font-mono">+{q.change_pct.toFixed(2)}%</p>
                  </div>
                </div>
              ))}
              {(movers?.top_losers || []).slice(0, 5).map((q: AfricaQuote) => (
                <div key={q.symbol} className="flex items-center justify-between p-2 bg-gray-800/30 rounded">
                  <div>
                    <p className="text-white text-sm font-medium">{q.symbol}</p>
                    <p className="text-gray-500 text-xs">{q.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-red-400 text-sm font-mono">{q.change_pct.toFixed(2)}%</p>
                  </div>
                </div>
              ))}
              {(!movers || (!movers.top_gainers?.length && !movers.top_losers?.length)) && (
                <p className="text-gray-500 text-sm">No top movers data.</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-400" /> Scan: {market.toUpperCase()}
          </h3>
          <button
            onClick={() => refetchScan()}
            disabled={scanLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white rounded-lg text-sm"
          >
            {scanLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Run scan
          </button>
          {scanResults.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {scanResults.map((r: AfricaQuote) => (
                <div key={r.symbol} className="p-2 bg-gray-800/30 rounded text-xs">
                  <p className="text-white font-medium">{r.symbol}</p>
                  <p className="text-gray-400">{r.price.toLocaleString()} · {r.change_pct.toFixed(2)}%</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
