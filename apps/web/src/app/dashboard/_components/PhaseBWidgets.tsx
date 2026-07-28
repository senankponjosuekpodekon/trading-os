'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { Coins, MessageSquare, Globe, Cpu, ThumbsUp } from 'lucide-react';

function Panel({ title, icon, children }: { title: React.ReactNode; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

interface TokenomicsMetric {
  assetSymbol: string;
  marketCap?: number;
  supply?: number;
  holders?: number;
  volume24h?: number;
}

interface SocialMetric {
  source: string;
  symbol: string;
  sentimentScore: number;
  mentionCount: number;
  trending?: boolean;
}

interface BrvmStock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
}

interface SyntheticAsset {
  name: string;
  underlying: string;
  price: number;
  volatility: number;
  indexName?: string;
}

interface MlLeaderboardRow {
  userId: string;
  _count?: { userId: number };
  _avg?: { grade: number };
  feedbackCount?: number;
  averageGrade?: number;
}

function TokenomicsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['phase-b', 'tokenomics'],
    queryFn: async () => {
      const res = await api.get('/phase-b/tokenomics');
      return res.data.data as TokenomicsMetric[];
    },
  });

  return (
    <Panel title="Tokenomics" icon={<Coins className="w-4 h-4 text-yellow-400" />}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-gray-500">Aucune métrique disponible</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 3).map((t) => (
            <div key={t.assetSymbol} className="flex justify-between text-sm">
              <span className="text-white font-medium">{t.assetSymbol}</span>
              <span className="text-gray-400">
                Cap: {t.marketCap ? `$${(t.marketCap / 1e6).toFixed(1)}M` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SocialWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['phase-b', 'social'],
    queryFn: async () => {
      const res = await api.get('/phase-b/social');
      return res.data.data as SocialMetric[];
    },
  });

  return (
    <Panel title="Social Sentiment" icon={<MessageSquare className="w-4 h-4 text-blue-400" />}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-gray-500">Aucune donnée</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 3).map((s) => (
            <div key={`${s.source}-${s.symbol}`} className="flex justify-between text-sm">
              <span className="text-white">{s.symbol}</span>
              <span className={s.sentimentScore >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {s.sentimentScore.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function BrvmWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['phase-b', 'brvm'],
    queryFn: async () => {
      const res = await api.get('/phase-b/brvm');
      return res.data.data as BrvmStock[];
    },
  });

  return (
    <Panel title="BRVM" icon={<Globe className="w-4 h-4 text-yellow-400" />}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-gray-500">Aucune donnée</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 3).map((b) => (
            <div key={b.symbol} className="flex justify-between text-sm">
              <span className="text-white">{b.symbol}</span>
              <span className={b.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {b.changePct >= 0 ? '+' : ''}{b.changePct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function SyntheticWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['phase-b', 'synthetic'],
    queryFn: async () => {
      const res = await api.get('/phase-b/synthetic');
      return res.data.data as SyntheticAsset[];
    },
  });

  return (
    <Panel title="Synthétiques" icon={<Cpu className="w-4 h-4 text-violet-400" />}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-gray-500">Aucune donnée</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 3).map((s) => (
            <div key={s.name} className="flex justify-between text-sm">
              <span className="text-white">{s.name}</span>
              <span className="text-gray-400">{s.underlying}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MlFeedbackWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['phase-b', 'ml-feedback-leaderboard'],
    queryFn: async () => {
      const res = await api.get('/phase-b/ml-feedback/leaderboard');
      return res.data.data as MlLeaderboardRow[];
    },
  });

  return (
    <Panel title="ML Feedback Leaderboard" icon={<ThumbsUp className="w-4 h-4 text-emerald-400" />}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !data || data.length === 0 ? (
        <p className="text-xs text-gray-500">Aucun feedback</p>
      ) : (
        <div className="space-y-2">
          {data.slice(0, 3).map((row, i) => (
            <div key={row.userId ?? i} className="flex justify-between text-sm">
              <span className="text-white">{row.userId ?? i + 1}</span>
              <span className="text-gray-400">
                {row.feedbackCount ?? row._count?.userId ?? 0} avis
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function PhaseBWidgets() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
      <TokenomicsWidget />
      <SocialWidget />
      <BrvmWidget />
      <SyntheticWidget />
      <MlFeedbackWidget />
    </div>
  );
}
