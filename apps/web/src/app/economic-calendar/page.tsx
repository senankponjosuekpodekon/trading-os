'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { api } from '@/lib/api';
import { Calendar, Clock, Globe } from 'lucide-react';

interface EconomicEvent {
  date: string;
  time: string;
  currency: string;
  impact: 'High' | 'Medium' | 'Low';
  title: string;
  forecast: string;
  previous: string;
  category?: 'FOMC' | 'NFP' | 'CPI' | 'BRVM' | 'Other';
}

function ImpactBadge({ impact }: { impact: string }) {
  const map: Record<string, string> = {
    High: 'bg-red-400/10 text-red-400 border-red-400/20',
    Medium: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    Low: 'bg-gray-700 text-gray-400 border-gray-600',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${map[impact] ?? map.Low}`}>
      {impact}
    </span>
  );
}

const categoryColors: Record<string, string> = {
  FOMC: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  NFP: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CPI: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  BRVM: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  Other: 'bg-gray-700 text-gray-400 border-gray-600',
};

export default function EconomicCalendarPage() {
  const [filter, setFilter] = useState<'all' | 'High' | 'Medium'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'FOMC' | 'NFP' | 'CPI' | 'BRVM' | 'Other'>('all');
  const { data: events, isLoading } = useQuery<EconomicEvent[]>({
    queryKey: ['economic-calendar'],
    queryFn: async () => (await api.get('/market-data/economic-calendar')).data,
    staleTime: 300_000,
  });

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter(e => {
      const matchImpact = filter === 'all' || e.impact === filter;
      const matchCategory = categoryFilter === 'all' || e.category === categoryFilter;
      return matchImpact && matchCategory;
    });
  }, [events, filter, categoryFilter]);

  const counts = useMemo(() => {
    if (!events) return { high: 0, medium: 0 };
    return {
      high: events.filter(e => e.impact === 'High').length,
      medium: events.filter(e => e.impact === 'Medium').length,
    };
  }, [events]);

  if (isLoading) {
    return (
      <AppLayout title="Calendrier économique">
        <PageSkeleton statCards={3} tableRows={6} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Calendrier économique">
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              Calendrier économique
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">Evénements macro à haut impact : FOMC, NFP, CPI, PCE...</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'High', 'Medium'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                  filter === f
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'
                }`}
              >
                {f === 'all' ? 'Tous' : f === 'High' ? `High (${counts.high})` : `Medium (${counts.medium})`}
              </button>
            ))}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="bg-gray-900 border border-gray-700 rounded-lg text-xs text-white px-2 py-1.5"
            >
              <option value="all">Toutes catégories</option>
              <option value="FOMC">FOMC</option>
              <option value="NFP">NFP</option>
              <option value="CPI">CPI</option>
              <option value="BRVM">BRVM</option>
              <option value="Other">Autre</option>
            </select>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
            <div className="col-span-3 flex items-center gap-1"><Clock className="w-3 h-3" /> Date / Heure</div>
            <div className="col-span-2 flex items-center gap-1"><Globe className="w-3 h-3" /> Devise</div>
            <div className="col-span-3">Evénement</div>
            <div className="col-span-1 text-center">Impact</div>
            <div className="col-span-1 text-right">Prévu</div>
            <div className="col-span-1 text-right">Précédent</div>
          </div>
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-gray-500 text-sm">Aucun événement ne correspond au filtre.</div>
          )}
          <div className="divide-y divide-gray-800">
            {filtered.map((e, i) => (
              <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 text-xs items-center hover:bg-gray-800/30 transition-colors">
                <div className="col-span-3 text-gray-300">
                  <span className="font-mono">{new Date(`${e.date}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                  <span className="text-gray-600 ml-2">{e.time}</span>
                </div>
                <div className="col-span-2 text-white font-medium">{e.currency}</div>
                <div className="col-span-3 text-gray-300 flex items-center gap-1.5">
                  {e.title}
                  {e.category && e.category !== 'Other' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${categoryColors[e.category]}`}>{e.category}</span>
                  )}
                </div>
                <div className="col-span-1 text-center"><ImpactBadge impact={e.impact} /></div>
                <div className="col-span-1 text-right text-gray-400 font-mono">{e.forecast}</div>
                <div className="col-span-1 text-right text-gray-500 font-mono">{e.previous}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
