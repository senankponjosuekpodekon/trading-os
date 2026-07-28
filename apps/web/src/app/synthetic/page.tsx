'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AppLayout } from '@/components/layout/AppLayout';
import { SyntheticRegimeCard, SyntheticAnalysis } from '@/components/synthetic/SyntheticRegimeCard';
import { Activity, BarChart3 } from 'lucide-react';

const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8000';

const GROUPS: Record<string, { label: string; color: string; symbols: string[] }> = {
  volatility: {
    label: 'Volatility Indices',
    color: 'blue',
    symbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'],
  },
  boom_crash: {
    label: 'Boom & Crash',
    color: 'yellow',
    symbols: ['BOOM300', 'BOOM500', 'BOOM1000', 'CRASH300', 'CRASH500', 'CRASH1000'],
  },
  jump: {
    label: 'Jump Indices',
    color: 'purple',
    symbols: ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
  },
  step: {
    label: 'Step Index',
    color: 'emerald',
    symbols: ['STPRNG'],
  },
};

const COLOR_MAP: Record<string, { border: string; text: string; bg: string }> = {
  blue:     { border: 'border-blue-400/20', text: 'text-blue-400', bg: 'bg-blue-400/10' },
  yellow:   { border: 'border-yellow-400/20', text: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  purple:   { border: 'border-purple-400/20', text: 'text-purple-400', bg: 'bg-purple-400/10' },
  emerald:  { border: 'border-emerald-400/20', text: 'text-emerald-400', bg: 'bg-emerald-400/10' },
};

export default function SyntheticPage() {
  const allSymbols = useMemo(() => Object.values(GROUPS).flatMap(g => g.symbols), []);

  const { data: results, isLoading } = useQuery<SyntheticAnalysis[]>({
    queryKey: ['synthetic-analysis', allSymbols],
    queryFn: async () => {
      const res = await Promise.all(
        allSymbols.map(sym => axios.get(`${ENGINE}/synthetic/analyze/${sym}`).then(r => r.data).catch(() => null)),
      );
      return res.filter(Boolean) as SyntheticAnalysis[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const bySymbol = useMemo(() => {
    const map = new Map<string, SyntheticAnalysis>();
    results?.forEach(r => map.set(r.symbol, r));
    return map;
  }, [results]);

  return (
    <AppLayout title="Synthetic Markets">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />Synthetic Markets
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Statistiques Deriv — pas de SMC / on-chain ici</p>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-48 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && Object.entries(GROUPS).map(([key, group]) => (
          <div key={key}>
            <h3 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${COLOR_MAP[group.color].text}`}>
              <BarChart3 className="w-4 h-4" />{group.label}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.symbols.map(sym => {
                const r = bySymbol.get(sym);
                if (!r) return (
                  <div key={sym} className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-gray-600 text-sm">
                    {sym} — données indisponibles
                  </div>
                );
                return <SyntheticRegimeCard key={sym} analysis={r} color={COLOR_MAP[group.color]} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  );
}

