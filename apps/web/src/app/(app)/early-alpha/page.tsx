'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Rocket, Activity, AlertTriangle, TrendingUp, TrendingDown, Filter, ExternalLink } from 'lucide-react';

interface PresaleProject {
  id: string;
  name: string;
  symbol: string;
  chain: string;
  stage: string;
  listingType: string;
  platform: string;
  raiseUsd: number;
  goalUsd: number;
  fundingPct: number;
  price: number;
  website: string;
  asymmetricScore: number;
  riskScore: number;
  riskFlags: string[];
  opportunityFlags: string[];
  githubCommits30d: number;
  tvlMillions: number;
  socialBuzz: number;
  source: string;
  url: string;
  tags: string[];
  smartMoney?: {
    score: number;
    smart_wallets: number;
    deployer_wins: number;
    deployer_rugs: number;
    known_buyers?: string[];
  } | null;
}

interface OnChainAsym {
  assetSymbol: string;
  chain: string;
  overallSignal: string;
  whaleConcentration: number;
  holderGrowth24h: number;
  developerActivity: number;
  socialMentionVelocity: number;
  asymmetricScore: number;
  signalCount: number;
  topSignals: { type: string; severity: string; direction: string; message: string }[];
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

const signalColor = (s: string) => {
  if (s === 'STRONG_BULLISH') return 'text-emerald-400';
  if (s === 'BULLISH') return 'text-emerald-400';
  if (s === 'MILD_BULLISH') return 'text-yellow-400';
  if (s === 'BEARISH') return 'text-red-400';
  return 'text-gray-400';
};

export default function EarlyAlphaPage() {
  const [chain, setChain] = useState('');
  const [minRisk, setMinRisk] = useState('');
  const [maxRisk, setMaxRisk] = useState('');
  const [limit, setLimit] = useState(50);

  const { data: presales, isLoading: pLoading } = useQuery<{ data: PresaleProject[]; summary: string }>({
    queryKey: ['early-alpha-presales', chain, minRisk, maxRisk, limit],
    queryFn: async () => (await api.get(`/early-alpha/presales?chain=${chain}&minRisk=${minRisk}&maxRisk=${maxRisk}&limit=${limit}`)).data,
    staleTime: 300_000,
  });

  const { data: onchain, isLoading: oLoading } = useQuery<{ data: OnChainAsym[] }>({
    queryKey: ['early-alpha-onchain'],
    queryFn: async () => (await api.get('/early-alpha/onchain')).data,
    staleTime: 300_000,
  });

  const projects = presales?.data ?? [];
  const metrics = onchain?.data ?? [];

  return (
    <>
      <div className="space-y-8">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Rocket className="w-5 h-5 text-emerald-400" />Early Alpha
          </h2>
          <p className="text-gray-500 text-sm mt-0.5">
            Presales scanners et métriques on-chain asymétriques — données réelles (DEX, CryptoRank, ICOdrops, whale activity).
          </p>
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
                <option value="ETHEREUM">ETH</option>
                <option value="SOLANA">SOL</option>
                <option value="BSC">BSC</option>
                <option value="BASE">BASE</option>
                <option value="ARBITRUM">ARB</option>
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
              <input
                type="number"
                min={1}
                max={100}
                placeholder="limit"
                value={limit}
                onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white px-2 py-1.5"
              />
            </div>
          </div>

          {presales?.summary && <p className="text-xs text-gray-500">{presales.summary}</p>}

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-500">
              <div className="col-span-2">Projet</div>
              <div className="col-span-1">Chain</div>
              <div className="col-span-1">Type</div>
              <div className="col-span-2">Raised / Goal</div>
              <div className="col-span-2">Dev activity</div>
              <div className="col-span-2">Top risque</div>
              <div className="col-span-1">Score</div>
              <div className="col-span-1">Source</div>
            </div>

            {pLoading && <div className="px-4 py-10 text-center text-gray-600 text-sm">Chargement...</div>}
            {!pLoading && projects.length === 0 && <div className="px-4 py-12 text-center text-gray-500 text-sm">Aucun projet détecté.</div>}

            {projects.map((p) => (
              <div key={p.id} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-800 last:border-0 items-center text-sm">
                <div className="col-span-2">
                  <div className="text-white font-medium flex items-center gap-1">
                    {p.name}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="text-gray-500 text-xs flex items-center gap-1">
                    {p.symbol}
                    {p.smartMoney && (p.smartMoney.smart_wallets > 0 || p.smartMoney.deployer_wins > 0) && (
                      <span className="px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]"
                        title={`Smart money : ${p.smartMoney.smart_wallets > 0 ? `${p.smartMoney.smart_wallets} acheteur(s) précoce(s) déjà gagnant(s) sur d'autres tokens. ` : ''}${p.smartMoney.deployer_wins > 0 ? `Créateur : ${p.smartMoney.deployer_wins} token(s) gagnant(s) précédent(s).` : ''}`}>
                        🧠
                      </span>
                    )}
                    {p.smartMoney && p.smartMoney.deployer_rugs > 0 && (
                      <span className="px-1 py-0.5 rounded bg-red-500/15 text-red-400 text-[10px]"
                        title={`Le créateur de ce token est lié à ${p.smartMoney.deployer_rugs} token(s) ayant perdu ≥50% — vigilance`}>
                        ⚠ dev
                      </span>
                    )}
                  </div>
                </div>
                <div className="col-span-1 text-gray-300">{p.chain}</div>
                <div className="col-span-1 text-gray-300">{p.listingType}</div>
                <div className="col-span-2 text-gray-300">
                  {p.raiseUsd > 0 || p.goalUsd > 0 ? (
                    <>{formatUsd(p.raiseUsd)} / {formatUsd(p.goalUsd)}
                      {p.fundingPct > 0 && <span className="text-gray-500 text-xs"> ({p.fundingPct}%)</span>}
                    </>
                  ) : <span className="text-gray-600">—</span>}
                </div>
                <div className="col-span-2 text-gray-300">
                  {p.githubCommits30d > 0 ? `${p.githubCommits30d} commits/30j` : <span className="text-gray-600">—</span>}
                </div>
                <div className="col-span-2 text-xs text-orange-400/80 truncate" title={p.riskFlags?.join(' · ')}>
                  {p.riskFlags?.[0] ?? <span className="text-gray-600">—</span>}
                </div>
                <div className={`col-span-1 font-semibold ${asymColor(p.asymmetricScore)}`}>{p.asymmetricScore}</div>
                <div className="col-span-1 flex flex-wrap gap-1">
                  {(p.tags ?? []).slice(0, 2).map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800 text-gray-300">{t}</span>
                  ))}
                  <span className="text-[10px] text-gray-600">{p.source}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* On-chain asym metrics */}
        <section className="space-y-4">
          <h3 className="text-white font-medium flex items-center gap-2"><Activity className="w-4 h-4 text-gray-400" />Métriques on-chain asymétriques</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {oLoading && <div className="col-span-full text-center text-gray-600 text-sm py-8">Analyse on-chain en cours...</div>}
            {!oLoading && metrics.length === 0 && <div className="col-span-full text-center text-gray-500 text-sm py-8">Aucun signal détecté sur les projets candidats.</div>}

            {metrics.map((m) => (
              <div key={m.assetSymbol} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-semibold">{m.assetSymbol}</span>
                    <span className="text-gray-500 text-xs ml-2">{m.chain}</span>
                  </div>
                  <span className={`text-lg font-bold ${asymColor(m.asymmetricScore)}`}>{m.asymmetricScore}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>Signal global</span>
                    <span className={`font-medium ${signalColor(m.overallSignal)}`}>{m.overallSignal}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Whale concentration</span>
                    <span className="text-gray-200">{m.whaleConcentration > 0 ? `${m.whaleConcentration}%` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Holder growth 24h</span>
                    <span className={`flex items-center gap-1 ${m.holderGrowth24h > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                      {m.holderGrowth24h > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {m.holderGrowth24h > 0 ? `+${m.holderGrowth24h}` : '0'}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Dev activity / 30j</span>
                    <span className="text-gray-200">{m.developerActivity > 0 ? m.developerActivity : '—'}</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Mentions sociales</span>
                    <span className="text-gray-200">{m.socialMentionVelocity > 0 ? m.socialMentionVelocity : '—'}</span>
                  </div>
                </div>
                {m.topSignals?.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-gray-800">
                    {m.topSignals.map((s, i) => (
                      <div key={i} className={`text-xs flex items-start gap-1 ${s.direction === 'bullish' ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {s.message}
                      </div>
                    ))}
                  </div>
                )}
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
    </>
  );
}
