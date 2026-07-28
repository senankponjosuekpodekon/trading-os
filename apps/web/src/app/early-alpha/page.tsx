'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { api } from '@/lib/api';
import { Rocket, Activity, AlertTriangle, TrendingUp, TrendingDown, Filter } from 'lucide-react';

interface PresaleProject {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  stage: string;
  raiseUsd: number;
  fdvUsd: number;
  price: number;
  vesting: string;
  riskScore: number;
  tags: string[];
}

interface OnChainAsym {
  assetSymbol: string;
  whaleConcentration: number;
  exchangeInflow24h: number;
  exchangeOutflow24h: number;
  netFlow24h: number;
  developerActivity: number;
  ageDays: number;
  socialMentionVelocity: number;
  asymmetricScore: number;
}

const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const riskColor = (score: number) => {
  if (score >= 70) return 'text-red-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-emerald-400';
};

const asymColor = (score: number) => {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-gray-400';
};

export default function EarlyAlphaPage() {
  const [chain, setChain] = useState('');
  const [minRisk, setMinRisk] = useState('');
  const [maxRisk, setMaxRisk] = useState('');

  const { data: presales, isLoading: pLoading } = useQuery<{ data: PresaleProject[] }>({
    queryKey: ['early-alpha-presales', chain, minRisk, maxRisk],
    queryFn: async () => (await api.get(`/early-alpha/presales?chain=${chain}&minRisk=${minRisk}&maxRisk=${maxRisk}`)).data,
  });

  const { data: onchain, isLoading: oLoading } = useQuery<{ data: OnChainAsym[] }>({
    queryKey: ['early-alpha-onchain'],
    queryFn: async () => (await api.get('/early-alpha/onchain')).data,
  });

  const projects = presales?.data ?? [];
  const metrics = onchain?.data ?? [];

  return (
    <AppLayout title="Early Alpha">
      <div className="space-y-8">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Rocket className="w-5 h-5 text-emerald-400" />Early Alpha
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">Presales scanners et métriques on-chain asymétriques.</p>
        </div>

        {/* Presales section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-medium flex items-center gap-2"><Filter className="w-4 h-4 text-gray-400" />Presales</h3>
            <div className="flex gap-2">
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg text-sm text-white px-2 py-1.5"
              >
                <option value="">Toutes chains</option>
                <option value="ETH">ETH</option>
                <option value="SOL">SOL</option>
                <option value="ARB">ARB</option>
                <option value="BSC">BSC</option>
              </select>
              <input
                type="number"
                placeholder="risk min"
                value={minRisk}
                onChange={(e) => setMinRisk(e.target.value)}
                className="w-20 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white px-2 py-1.5"
              />
              <input
                type="number"
                placeholder="risk max"
                value={maxRisk}
                onChange={(e) => setMaxRisk(e.target.value)}
                className="w-20 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white px-2 py-1.5"
              />
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
              <div className="col-span-2">Projet</div>
              <div className="col-span-1">Chain</div>
              <div className="col-span-1">Stage</div>
              <div className="col-span-2">Raise</div>
              <div className="col-span-2">FDV</div>
              <div className="col-span-2">Vesting</div>
              <div className="col-span-1">Risk</div>
              <div className="col-span-1">Tags</div>
            </div>

            {pLoading && <div className="px-4 py-10 text-center text-gray-600 text-sm">Chargement...</div>}
            {!pLoading && projects.length === 0 && <div className="px-4 py-12 text-center text-gray-500 text-sm">Aucun projet.</div>}

            {projects.map((p) => (
              <div key={p.id} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-800 last:border-0 items-center text-sm">
                <div className="col-span-2">
                  <div className="text-white font-medium">{p.name}</div>
                  <div className="text-gray-500 text-xs">{p.symbol}</div>
                </div>
                <div className="col-span-1 text-gray-300">{p.chain}</div>
                <div className="col-span-1 text-gray-300 capitalize">{p.stage}</div>
                <div className="col-span-2 text-gray-300">{formatUsd(p.raiseUsd)}</div>
                <div className="col-span-2 text-gray-300">{formatUsd(p.fdvUsd)}</div>
                <div className="col-span-2 text-gray-400 text-xs truncate" title={p.vesting}>{p.vesting}</div>
                <div className={`col-span-1 font-semibold ${riskColor(p.riskScore)}`}>{p.riskScore}</div>
                <div className="col-span-1 flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* On-chain asym metrics */}
        <section className="space-y-4">
          <h3 className="text-white font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-gray-400" />Métriques on-chain asymétriques</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {oLoading && <div className="col-span-full text-center text-gray-600 text-sm py-8">Chargement...</div>}
            {!oLoading && metrics.length === 0 && <div className="col-span-full text-center text-gray-500 text-sm py-8">Aucune métrique.</div>}

            {metrics.map((m) => (
              <div key={m.assetSymbol} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-white font-semibold">{m.assetSymbol}</span>
                  <span className={`text-lg font-bold ${asymColor(m.asymmetricScore)}`}>{m.asymmetricScore}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Whale concentration</span>
                    <span className="text-gray-200">{m.whaleConcentration}%</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Net exchange flow 24h</span>
                    <span className={`flex items-center gap-1 ${m.netFlow24h >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {m.netFlow24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {formatUsd(Math.abs(m.netFlow24h))}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Dev activity / sem</span>
                    <span className="text-gray-200">{m.developerActivity}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Age</span>
                    <span className="text-gray-200">{m.ageDays}j</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Mentions/h</span>
                    <span className="text-gray-200">{m.socialMentionVelocity}</span>
                  </div>
                </div>
                {m.asymmetricScore >= 70 && (
                  <div className="flex items-center gap-1 text-xs text-yellow-400">
                    <AlertTriangle className="w-3 h-3" /> Signal d’asymétrie élevé
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
