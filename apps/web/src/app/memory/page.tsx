'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSkeleton } from '@/components/ui/PageSkeleton';
import { api } from '@/lib/api';
import { Brain, Search, TrendingUp, TrendingDown, Target, Calendar, Gauge, Activity } from 'lucide-react';

interface Neighbour {
  id: string;
  symbol: string;
  timeframe: string;
  signalType: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  scoreTotal: number;
  regime: string;
  outcome: string;
  createdAt: string;
  similarity: number;
}

const FEATURE_INPUTS = [
  { key: 'confidence', label: 'Confidence', default: 70 },
  { key: 'scoreTrend', label: 'Score Trend', default: 60 },
  { key: 'scorePA', label: 'Score PA', default: 60 },
  { key: 'scoreSR', label: 'Score S/R', default: 60 },
  { key: 'scorePatterns', label: 'Score Patterns', default: 60 },
  { key: 'scoreRegime', label: 'Score Régime', default: 60 },
  { key: 'scoreSMC', label: 'Score SMC', default: 60 },
  { key: 'scoreMTF', label: 'Score MTF', default: 60 },
  { key: 'scoreSentiment', label: 'Score Sentiment', default: 60 },
  { key: 'scoreTotal', label: 'Score Total', default: 60 },
  { key: 'riskReward', label: 'R/R', default: 2 },
  { key: 'adx', label: 'ADX', default: 30 },
];

function OutcomeBadge({ outcome }: { outcome: string }) {
  const color = outcome.startsWith('WIN')
    ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
    : outcome === 'LOSS_SL'
    ? 'bg-red-400/10 text-red-400 border-red-400/20'
    : 'bg-gray-700 text-gray-400 border-gray-600';
  return <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${color}`}>{outcome}</span>;
}

export default function MemoryPage() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [market, setMarket] = useState('');
  const [features, setFeatures] = useState<Record<string, number>>(() =>
    Object.fromEntries(FEATURE_INPUTS.map(f => [f.key, f.default]))
  );

  const { mutate, data, isPending } = useMutation<{ neighbours: Neighbour[] }>({
    mutationFn: async () =>
      (await api.post('/signals/memory/similar', {
        symbol: symbol || undefined,
        market: market || undefined,
        ...features,
        top: 10,
      })).data,
  });

  return (
    <AppLayout title="Market Memory">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-emerald-400" />
            Market Memory
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Trouve les situations historiques les plus proches pour calibrer l’intuition.</p>
        </div>

        {/* Search form */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Symbole</label>
              <input
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Market (optionnel)</label>
              <select
                value={market}
                onChange={e => setMarket(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                <option value="">Auto (symbole)</option>
                <option value="CRYPTO">CRYPTO</option>
                <option value="FOREX">FOREX</option>
                <option value="METALS">METALS</option>
                <option value="BRVM">BRVM</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {FEATURE_INPUTS.map(({ key, label, default: d }) => (
              <div key={key}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input
                  type="number"
                  value={features[key]}
                  onChange={e => setFeatures(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                  className="w-full bg-gray-950 border border-gray-800 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => mutate()}
              disabled={isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              {isPending ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Recherche…</>
              ) : (
                <><Search className="w-4 h-4" />Chercher les analogues</>
              )}
            </button>
          </div>
        </div>

        {/* Results */}
        {isPending && <PageSkeleton statCards={3} tableRows={0} />}
        {data && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Top {data.neighbours.length} situations similaires
              </h3>
            </div>
            {data.neighbours.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">Aucune situation résolue trouvée dans la mémoire.</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.neighbours.map(n => (
                <div key={n.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{n.symbol}</span>
                      <span className="text-xs text-gray-500">{n.timeframe}</span>
                      {n.signalType === 'BUY' ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      ) : n.signalType === 'SELL' ? (
                        <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                      ) : (
                        <Target className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </div>
                    <OutcomeBadge outcome={n.outcome} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-gray-950 rounded p-2 text-center">
                      <p className="text-[10px] text-gray-500">Similarité</p>
                      <p className="text-sm font-mono font-semibold text-white">{n.similarity}%</p>
                    </div>
                    <div className="bg-gray-950 rounded p-2 text-center">
                      <p className="text-[10px] text-gray-500">Conf</p>
                      <p className="text-sm font-mono font-semibold text-white">{Math.round(n.confidence)}%</p>
                    </div>
                    <div className="bg-gray-950 rounded p-2 text-center">
                      <p className="text-[10px] text-gray-500">Score</p>
                      <p className="text-sm font-mono font-semibold text-white">{Math.round(n.scoreTotal)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Gauge className="w-3 h-3" /> {n.regime ?? '—'}</span>
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(n.createdAt).toLocaleDateString('fr-FR')}</span>
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
