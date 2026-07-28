'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PatternStatsTable } from '@/components/patterns/PatternStatsTable';
import { PostTradeAnalysisCard } from '@/components/patterns/PostTradeAnalysisCard';
import { api } from '@/lib/api';
import { PatternStatsResponse, PostTradeAnalysis } from '@/types';
import { Activity, BarChart3, RefreshCw } from 'lucide-react';

const MARKETS = ['ALL', 'CRYPTO', 'FOREX', 'METALS', 'BRVM'];

export default function PatternsPage() {
  const [market, setMarket] = useState('ALL');

  const { data: stats, isLoading: statsLoading } = useQuery<PatternStatsResponse>({
    queryKey: ['pattern-stats'],
    queryFn: async () => (await api.get('/signals/pattern-stats')).data,
  });

  const { data: analysis, isLoading: analysisLoading } = useQuery<PostTradeAnalysis>({
    queryKey: ['post-trade-analysis', market],
    queryFn: async () => (await api.get(`/signals/post-trade-analysis?market=${market === 'ALL' ? '' : market}`)).data,
    enabled: !!stats,
  });

  return (
    <AppLayout title="Patterns & Feedback Loop">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="text-indigo-400" />
              Patterns & Feedback Loop
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Performance réalisée par pattern et calibration du scoring post-trade.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Marché :</span>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {MARKETS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {statsLoading || analysisLoading ? (
          <div className="space-y-4">
            <div className="h-32 rounded-xl bg-gray-900 animate-pulse" />
            <div className="h-64 rounded-xl bg-gray-900 animate-pulse" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity size={18} className="text-indigo-400" />
                Analyse post-trade ({stats?.total ?? 0} signaux résolus)
              </h2>
              {analysis ? (
                <PostTradeAnalysisCard analysis={analysis} />
              ) : (
                <div className="rounded-xl border border-gray-800 bg-gray-950 p-6 text-sm text-gray-500">
                  Aucun signal résolu disponible pour l’analyse.
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <RefreshCw size={18} className="text-indigo-400" />
                Statistiques par pattern
              </h2>
              <PatternStatsTable patterns={stats?.patterns ?? {}} />
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
