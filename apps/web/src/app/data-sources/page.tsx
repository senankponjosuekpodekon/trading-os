'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Database, LineChart, Shield, Globe, Search, RefreshCw } from 'lucide-react';

export default function DataSourcesPage() {
  const [massiveTicker, setMassiveTicker] = useState('X:BTCUSD');
  const [massiveFrom, setMassiveFrom] = useState('2024-01-01');
  const [massiveTo, setMassiveTo] = useState('2024-12-31');

  const [poocoinLp, setPoocoinLp] = useState('0xb27F7e1D34a4...');
  const [poocoinInterval, setPoocoinInterval] = useState('15m');

  const { data: massiveTickerData, isLoading: m1 } = useQuery({
    queryKey: ['massive-ticker', massiveTicker],
    queryFn: async () => (await api.get(`/massive/ticker/${encodeURIComponent(massiveTicker)}`)).data,
    enabled: !!massiveTicker,
  });

  const { data: massiveOhlcv, isLoading: m2, refetch: refetchOhlcv } = useQuery({
    queryKey: ['massive-ohlcv', massiveTicker, massiveFrom, massiveTo],
    queryFn: async () =>
      (await api.get(`/massive/ohlcv/${encodeURIComponent(massiveTicker)}`, {
        params: { from_date: massiveFrom, to_date: massiveTo, multiplier: 1, timespan: 'day', limit: 100 },
      })).data,
    enabled: !!massiveTicker && !!massiveFrom && !!massiveTo,
  });

  const { data: poocoinCandles, isLoading: p1, refetch: refetchPoo } = useQuery({
    queryKey: ['poocoin-candles', poocoinLp, poocoinInterval],
    queryFn: async () =>
      (await api.get('/poocoin/candles-bsc', {
        params: { lpAddress: poocoinLp, interval: poocoinInterval, limit: 100 },
      })).data,
    enabled: !!poocoinLp,
  });

  return (
    <AppLayout title="Data Sources">
      <div className="p-6 space-y-8">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" /> Data Sources
          </h1>
          <p className="text-sm text-gray-400 mt-1">Explore Massive and PooCoin raw data.</p>
        </div>

        {/* Massive */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-400" /> Massive
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              value={massiveTicker}
              onChange={(e) => setMassiveTicker(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="X:BTCUSD"
            />
            <input
              type="date"
              value={massiveFrom}
              onChange={(e) => setMassiveFrom(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
            />
            <input
              type="date"
              value={massiveTo}
              onChange={(e) => setMassiveTo(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
            />
            <button
              onClick={() => refetchOhlcv()}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-lg text-sm"
            >
              <Search className="w-4 h-4" /> Fetch OHLCV
            </button>
          </div>

          {m1 && <p className="text-gray-500 text-sm">Loading ticker…</p>}
          {massiveTickerData && (
            <pre className="text-xs text-gray-400 bg-gray-950 p-3 rounded-lg overflow-auto max-h-40">
              {JSON.stringify(massiveTickerData, null, 2)}
            </pre>
          )}

          {m2 && <p className="text-gray-500 text-sm">Loading OHLCV…</p>}
          {massiveOhlcv?.results && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/50">
                  <tr>
                    {['Time', 'Open', 'High', 'Low', 'Close', 'Volume'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {massiveOhlcv.results.slice(0, 20).map((bar: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-400 font-mono">{new Date(bar.t).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.o}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.h}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.l}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.c}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.v?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PooCoin */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <LineChart className="w-4 h-4 text-yellow-400" /> PooCoin (BSC)
          </h2>
          <div className="flex flex-wrap gap-3">
            <input
              value={poocoinLp}
              onChange={(e) => setPoocoinLp(e.target.value)}
              className="flex-1 min-w-[250px] bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
              placeholder="LP address (0x...):"
            />
            <select
              value={poocoinInterval}
              onChange={(e) => setPoocoinInterval(e.target.value)}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white"
            >
              {['5m', '15m', '1h', '4h', '1d'].map(i => <option key={i}>{i}</option>)}
            </select>
            <button
              onClick={() => refetchPoo()}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-white rounded-lg text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Fetch Candles
            </button>
          </div>

          {p1 && <p className="text-gray-500 text-sm">Loading candles…</p>}
          {poocoinCandles && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/50">
                  <tr>
                    {['Time', 'Open', 'High', 'Low', 'Close', 'Volume'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(poocoinCandles.candles || poocoinCandles || []).slice(0, 20).map((bar: any, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-400 font-mono">{new Date(bar.time || bar.t).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.open || bar.o}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.high || bar.h}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.low || bar.l}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{bar.close || bar.c}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{(bar.volume || bar.v)?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
